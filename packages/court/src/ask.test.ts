import {
  FAKE_USAGE,
  IncompleteOutputError,
  InvalidOutputError,
  type LlmClient,
  type LlmResult,
  type StructuredRequest,
} from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ask, type CallRecord, StepFailedError } from "./ask.js";

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
    expect(calls).toEqual([{ label: "assessment:hr", attempt: 1, model: "claude-sonnet-5-5", outcome: "ok", costNanoUsd: 7, durationMs: 30 }]);
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

  it("odpowiedz lamiaca regule spoza schematu (np. zmyslony cytat) tez wraca z uwagami", async () => {
    const { llm, requests } = scripted(ok(42), ok(4));
    const { result } = run(llm, (d) => (d.score > 10 ? ["cytat spoza CV"] : []));
    expect(await result).toEqual({ score: 4 });
    expect(requests[1]?.retry).toEqual({ previousOutput: '{"score":42}', problems: ["cytat spoza CV"] });
  });

  it("po limicie tokenow ponawia z dwa razy wiekszym limitem", async () => {
    const { llm, requests } = scripted(incomplete("max_tokens"), incomplete("max_tokens"), ok(1));
    await run(llm).result;
    expect(requests.map((r) => r.maxTokens)).toEqual([100, 200, 400]);
  });

  it("odmowy modelu nie ponawia", async () => {
    const { llm, requests } = scripted(incomplete("refusal"), ok(1));
    const { result, calls } = run(llm);
    await expect(result).rejects.toMatchObject({ stopReason: "refusal" });
    expect(requests).toHaveLength(1);
    expect(calls[0]?.outcome).toBe("incomplete");
  });

  it("nieznany blad (np. budzet) przepuszcza od razu i nie zapisuje proby", async () => {
    const { result, calls } = run(scripted(new Error("budzet"), ok(1)).llm);
    await expect(result).rejects.toThrow("budzet");
    expect(calls).toEqual([]);
  });

  it("po wyczerpaniu prob konczy StepFailedError z ostatnim problemem", async () => {
    const { result } = run(scripted(invalid("a"), invalid("b"), invalid("c")).llm);
    const error: unknown = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepFailedError);
    expect(error).toMatchObject({ name: "StepFailedError", label: "assessment:hr", attempts: 3 });
    expect((error as Error).message).toMatch(/^assessment:hr: brak poprawnej odpowiedzi po 3 probach \(Odpowiedz modelu nie spelnia/);
  });

  it("problem z walidacji tez trafia do bledu koncowego", async () => {
    const { result } = run(scripted(ok(42), ok(42), ok(42)).llm, () => ["a", "b"]);
    await expect(result).rejects.toMatchObject({ lastProblem: "a; b" });
  });
});
