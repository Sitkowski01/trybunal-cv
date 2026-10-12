import { CRITIC_IDS, type CriticId } from "@trybunal/domain";
import {
  BudgetedLlmClient,
  FAKE_USAGE,
  FakeLlmClient,
  type FakeScript,
  IncompleteOutputError,
  type LlmClient,
  type LlmResult,
  type StructuredRequest,
} from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { runTrial, type TrialInput } from "./runner.js";

const input: TrialInput = { trialId: "t-1", cvText: "Jan. Java, Spring. Ekspert React.", jobOffer: "Junior Java", debateRounds: 1 };
const criticOf = (label: string) => label.split(":").at(-1) as CriticId;

/** Rozprawa bez niespodzianek; oceny po krytyku, debata bez zmian zdania. */
const scores: Record<CriticId, number> = { ats: 7, hr: 6, techLead: 5, hiringManager: 7, prosecutor: 2 };
const happy: FakeScript = (req) => {
  if (req.label.startsWith("assessment:")) {
    const quote = criticOf(req.label) === "techLead" ? [{ quote: "Ekspert React", issue: "bez projektu", severity: "high" }] : [];
    return { score: scores[criticOf(req.label)], summary: "ok", strengths: [], concerns: quote, rewrites: [] };
  }
  if (req.label === "prosecution") return { speech: "Odrzucic" };
  if (req.label.startsWith("statement:")) return { statement: "Podtrzymuje", revisedScore: null };
  return { justification: "Zapraszamy" };
};

/** Klient, w ktorym kazda odpowiedz czeka na recznie wywolane resolve; reaguje na anulowanie. */
function manual() {
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  const started: string[] = [];
  const llm: LlmClient = {
    generate<T>(req: StructuredRequest<T>, signal?: AbortSignal) {
      started.push(req.label);
      return new Promise<LlmResult<T>>((resolve, reject) => {
        signal?.addEventListener("abort", () => { reject(new Error(`anulowano ${req.label}`)); });
        const data = happy(req, 0) as T;
        pending.set(req.label, {
          resolve: () => { resolve({ data, model: req.model, usage: FAKE_USAGE, costNanoUsd: 1, requestId: null, durationMs: 1 }); },
          reject,
        });
      });
    },
  };
  /** Pozwala wykonac sie wszystkiemu, co czeka w kolejce zdarzen. */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const settle = async (label: string, error?: unknown) => {
    await flush();
    const p = pending.get(label);
    if (error === undefined) p?.resolve();
    else p?.reject(error);
    await flush();
  };
  return { llm, started, settle, flush };
}

describe("runTrial — rownoleglosc", () => {
  it("najpierw sam pierwszy krytyk (cache), potem czterech naraz", async () => {
    const { llm, started, settle, flush } = manual();
    const run = runTrial(input, { llm });
    await flush();
    expect(started).toEqual(["assessment:ats"]);
    await settle("assessment:ats");
    expect(started).toEqual(CRITIC_IDS.map((id) => `assessment:${id}`));
    for (const id of ["prosecutor", "hr", "hiringManager", "techLead"]) await settle(`assessment:${id}`);
    // Dalej nie idziemy: odmowa prokuratora konczy rozprawe, zeby test nie czekal.
    await settle("prosecution", new IncompleteOutputError("refusal", "claude-sonnet-5-5", FAKE_USAGE));
    const submitted = (await run).events.filter((e) => e.type === "AssessmentSubmitted");
    // Zdarzenia w kolejnosci odpowiedzi, nie miejsc przy stole.
    expect(submitted.map((e) => (e).assessment.criticId)).toEqual([
      "ats",
      "prosecutor",
      "hr",
      "hiringManager",
      "techLead",
    ]);
  });

  it("gdy jeden krytyk zawiedzie, pozostali sa anulowani i nikt nie dopisuje sie po przerwaniu", async () => {
    const { llm, settle } = manual();
    const run = runTrial(input, { llm });
    await settle("assessment:ats");
    await settle("assessment:hr");
    // Zawodzi ostatni przy stole, gdy Tech Lead i Hiring Manager jeszcze czekaja — powodem ma byc odmowa, nie ich anulowanie.
    await settle("assessment:prosecutor", new IncompleteOutputError("refusal", "claude-sonnet-5-5", FAKE_USAGE));
    const result = await run;
    expect(result.state).toMatchObject({ phase: "aborted", abortReason: "Odpowiedz modelu przerwana: refusal" });
    expect(result.events.filter((e) => e.type === "AssessmentSubmitted")).toHaveLength(2);
  });
});

describe("runTrial — przerwania", () => {
  it("zmyslony cytat wraca do krytyka z uwaga i po poprawce rozprawa idzie dalej", async () => {
    const lying: FakeScript = (req, i) =>
      req.label === "assessment:hr" && req.retry === undefined
        ? { score: 6, summary: "ok", strengths: [], concerns: [{ quote: "10 lat w Google", issue: "x", severity: "low" }], rewrites: [] }
        : happy(req, i);
    const llm = new FakeLlmClient(lying);
    const run = await runTrial(input, { llm });
    expect(run.state.phase).toBe("prosecution");
    expect(llm.calls.find((c) => c.label === "assessment:hr" && c.retry !== undefined)?.retry?.problems).toEqual([
      'Cytat "10 lat w Google" nie wystepuje doslownie w CV',
    ]);
  });

  it("przekroczony budzet konczy rozprawe z powodem", async () => {
    const llm = new BudgetedLlmClient(new FakeLlmClient(happy), 1);
    const run = await runTrial(input, { llm });
    expect(run.state.phase).toBe("aborted");
    expect(run.state.abortReason).toMatch(/^Budzet \$0\.0001: wydano/);
  });

  it("anulowanie z zewnatrz konczy rozprawe jako anulowana", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = await runTrial(input, { llm: new FakeLlmClient(happy), signal: controller.signal });
    expect(run.state).toMatchObject({ phase: "aborted", abortReason: "Rozprawa anulowana" });
  });

  it("anulowanie w trakcie ocen rownoleglych tez konczy rozprawe jako anulowana", async () => {
    const controller = new AbortController();
    const { llm, settle } = manual();
    const run = runTrial(input, { llm, signal: controller.signal });
    await settle("assessment:ats");
    controller.abort();
    expect((await run).state.abortReason).toBe("Rozprawa anulowana");
  });
});
