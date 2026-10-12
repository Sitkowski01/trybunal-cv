import {
  FAKE_USAGE,
  IncompleteOutputError,
  InvalidOutputError,
  type LlmClient,
  type LlmResult,
  LlmTransportError,
  type StructuredRequest,
} from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ask, backoffMs, type CallRecord, MAX_OUTPUT_TOKENS, MAX_WAIT_MS, StepFailedError } from "./ask.js";

const Answer = z.object({ score: z.number() });
const request: StructuredRequest<z.infer<typeof Answer>> = {
  label: "assessment:hr",
  model: "claude-sonnet-5-5",
  maxTokens: 100,
  rules: "r",
  documents: [],
  instructions: "i",
  task: "t",
  schema: Answer,
};
const ok = (score: number): LlmResult<unknown> => ({
  data: { score },
  model: "claude-sonnet-5-5",
  usage: FAKE_USAGE,
  costNanoUsd: 7,
  requestId: "msg",
  durationMs: 30,
});
const invalid = (raw: string) => new InvalidOutputError(["score: zle"], raw, "claude-sonnet-5-5", FAKE_USAGE);
const incomplete = (reason: string) => new IncompleteOutputError(reason, "claude-sonnet-5-5", FAKE_USAGE);

/** Klient odtwarzajacy po kolei: wynik albo blad; zapisuje zapytania. */
function scripted(...steps: (LlmResult<unknown> | Error)[]) {
  const requests: StructuredRequest<unknown>[] = [];
  const llm: LlmClient = {
    generate<T>(req: StructuredRequest<T>) {
      requests.push(req);
      const step = steps.shift();
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step as LlmResult<T>);
    },
  };
  return { llm, requests };
}

function run(llm: LlmClient, validate?: (d: { score: number }) => string[]) {
  const calls: CallRecord[] = [];
  const sleeps: number[] = [];
  const options = {
    maxAttempts: 3,
    sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()),
    record: (c: CallRecord) => calls.push(c),
    ...(validate === undefined ? {} : { validate }),
  };
  return { result: ask(llm, request, options), calls, sleeps };
}

describe("ask", () => {
  it("przyjmuje poprawna odpowiedz i zapisuje probe z kosztem i czasem", async () => {
    const { result, calls } = run(scripted(ok(7)).llm);
    expect(await result).toEqual({ score: 7 });
    expect(calls).toEqual([
      { label: "assessment:hr", attempt: 1, model: "claude-sonnet-5-5", outcome: "ok", usage: FAKE_USAGE, costNanoUsd: 7, costKnown: true, durationMs: 30 },
    ]);
  });

  it("po odpowiedzi spoza schematu ponawia z ta odpowiedzia i lista problemow", async () => {
    const { llm, requests } = scripted(invalid('{"score":"x"}'), ok(5));
    const { result, calls } = run(llm);
    expect(await result).toEqual({ score: 5 });
    expect(requests[1]?.retry).toEqual({ previousOutput: '{"score":"x"}', problems: ["score: zle"] });
    expect(calls.map((c) => [c.attempt, c.outcome, c.costNanoUsd])).toEqual([
      [1, "invalid", invalid("").costNanoUsd],
      [2, "ok", 7],
    ]);
  });

  it("odpowiedz lamiaca regule spoza schematu (np. zmyslony cytat) wraca z uwagami i jest 'rejected'", async () => {
    const { llm, requests } = scripted(ok(42), ok(4));
    const { result, calls } = run(llm, (d) => (d.score > 10 ? ["cytat spoza CV"] : []));
    expect(await result).toEqual({ score: 4 });
    expect(calls.map((c) => c.outcome)).toEqual(["rejected", "ok"]);
    expect(requests[1]?.retry).toEqual({ previousOutput: '{"score":42}', problems: ["cytat spoza CV"] });
  });

  it("po limicie tokenow ponawia z dwa razy wiekszym limitem", async () => {
    const { llm, requests } = scripted(incomplete("max_tokens"), incomplete("max_tokens"), ok(1));
    await run(llm).result;
    expect(requests.map((r) => r.maxTokens)).toEqual([100, 200, 400]);
  });

  it("limit tokenow rosnie najwyzej do sufitu, a na suficie nie ponawia", async () => {
    const big = { ...request, maxTokens: 12_000 };
    const { llm, requests } = scripted(incomplete("max_tokens"), incomplete("max_tokens"), ok(1));
    const options = { maxAttempts: 3, sleep: () => Promise.resolve(), record: () => undefined };
    await expect(ask(llm, big, options)).rejects.toMatchObject({ stopReason: "max_tokens" });
    expect(requests.map((r) => r.maxTokens)).toEqual([12_000, MAX_OUTPUT_TOKENS]);
  });

  it("odmowy modelu nie ponawia", async () => {
    const { llm, requests } = scripted(incomplete("refusal"), ok(1));
    const { result, calls } = run(llm);
    await expect(result).rejects.toMatchObject({ stopReason: "refusal" });
    expect(requests).toHaveLength(1);
    expect(calls[0]?.outcome).toBe("incomplete");
  });

  it("przy przeciazeniu API czeka tyle, ile kaze retry-after, a bez niego wykladniczo", async () => {
    const busy = (after: number | null) => new LlmTransportError("429", true, false, 429, after);
    const { result, sleeps, calls } = run(scripted(busy(7000), busy(null), ok(2)).llm);
    expect(await result).toEqual({ score: 2 });
    expect(sleeps).toEqual([7000, backoffMs(2)]);
    expect(calls.map((c) => [c.outcome, c.costNanoUsd, c.costKnown])).toEqual([
      ["transport", 0, true],
      ["transport", 0, true],
      ["ok", 7, true],
    ]);
  });

  it("czeka najwyzej MAX_WAIT_MS, nawet gdy API kaze dluzej", async () => {
    const { result, sleeps } = run(scripted(new LlmTransportError("429", true, false, 429, 600_000), ok(1)).llm);
    await result;
    expect(sleeps).toEqual([MAX_WAIT_MS]);
  });

  it("brak odpowiedzi, ktory mogl kosztowac (timeout), ma koszt nieznany", async () => {
    const { result, calls } = run(scripted(new LlmTransportError("timeout", true, true), ok(1)).llm);
    await result;
    expect(calls[0]).toMatchObject({ outcome: "transport", usage: null, costKnown: false });
  });

  it("anulowanie przed proba: nic nie idzie do modelu, a czekanie dostaje sygnal", async () => {
    const controller = new AbortController();
    const { llm, requests } = scripted(new LlmTransportError("429", true, false, 429), ok(1));
    const waits: (AbortSignal | undefined)[] = [];
    const options = {
      maxAttempts: 3,
      signal: controller.signal,
      sleep: (_: number, signal?: AbortSignal) => {
        waits.push(signal);
        controller.abort(new Error("anulowano"));
        return Promise.resolve();
      },
      record: () => undefined,
    };
    await expect(ask(llm, request, options)).rejects.toThrow("anulowano");
    expect(requests).toHaveLength(1);
    expect(waits).toEqual([controller.signal]);
  });

  it("bledu transportu, ktorego nie warto ponawiac, nie ponawia", async () => {
    const { llm, requests } = scripted(new LlmTransportError("401", false, false, 401), ok(1));
    await expect(run(llm).result).rejects.toThrow("401");
    expect(requests).toHaveLength(1);
  });

  it("nieznany blad (np. budzet) przepuszcza od razu i nie zapisuje proby", async () => {
    const { result, calls } = run(scripted(new Error("budzet"), ok(1)).llm);
    await expect(result).rejects.toThrow("budzet");
    expect(calls).toEqual([]);
  });

  it("po wyczerpaniu prob konczy StepFailedError z ostatnim problemem, bez czekania na koniec", async () => {
    const busy = new LlmTransportError("przeciazenie", true, false, 529);
    const { result, sleeps } = run(scripted(invalid("a"), invalid("b"), busy).llm);
    const error: unknown = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepFailedError);
    expect(error).toMatchObject({ name: "StepFailedError", label: "assessment:hr", attempts: 3, lastProblem: "przeciazenie" });
    expect((error as Error).message).toBe("assessment:hr: brak poprawnej odpowiedzi po 3 probach (przeciazenie)");
    expect(sleeps).toEqual([]);
  });

  it("problem z walidacji tez trafia do bledu koncowego", async () => {
    const { result } = run(scripted(ok(42), ok(42), ok(42)).llm, () => ["a", "b"]);
    await expect(result).rejects.toMatchObject({ lastProblem: "a; b" });
  });
});

describe("backoffMs", () => {
  it("1 s, 2 s, 4 s", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([1000, 2000, 4000]);
  });
});

describe("ask — konfiguracja bez prob", () => {
  it("zero prob to od razu StepFailedError, bez pytania modelu", async () => {
    const { llm, requests } = scripted(ok(1));
    const options = { maxAttempts: 0, sleep: () => Promise.resolve(), record: () => undefined };
    await expect(ask(llm, request, options)).rejects.toThrow("brak poprawnej odpowiedzi po 0 probach (nie bylo zadnej proby)");
    expect(requests).toEqual([]);
  });
});
