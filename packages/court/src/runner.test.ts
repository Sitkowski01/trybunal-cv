import { CRITIC_IDS, type CriticId, replay, TrialEventSchema } from "@trybunal/domain";
import {
  BudgetedLlmClient,
  FAKE_USAGE,
  FakeLlmClient,
  type FakeScript,
  IncompleteOutputError,
  type LlmClient,
  LlmTransportError,
  type LlmResult,
  type StructuredRequest,
} from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { type PromptSet, RULES } from "./prompts.js";
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

describe("runTrial — przebieg", () => {
  it("prowadzi rozprawe do werdyktu; dziennik odtwarza ten sam stan", async () => {
    const run = await runTrial(input, { llm: new FakeLlmClient(happy) });
    expect(run.state).toMatchObject({ phase: "closed", justification: "Zapraszamy", verdict: { decision: "invite", juryAverage: 6.25 } });
    expect(run.events.map((e) => e.type)).toEqual([
      "TrialFiled",
      ...Array<string>(5).fill("AssessmentSubmitted"),
      "ProsecutionDelivered",
      ...Array<string>(5).fill("StatementMade"),
      "VerdictAnnounced",
    ]);
    expect(replay(run.events)).toEqual(run.state);
    expect(run.events.every((e) => TrialEventSchema.safeParse(e).success)).toBe(true);
  });

  it("kazde wywolanie ma etykiete fazy, model z konfiguracji i trafia do rejestru", async () => {
    const llm = new FakeLlmClient(happy);
    const run = await runTrial({ ...input, debateRounds: 2 }, { llm });
    const labels = llm.calls.map((c) => c.label);
    expect(labels.slice(5, 7)).toEqual(["prosecution", "statement:1:ats"]);
    expect(labels.filter((l) => l.startsWith("statement:2:"))).toEqual(CRITIC_IDS.map((id) => `statement:2:${id}`));
    expect(labels.at(-1)).toBe("justification");
    expect(llm.calls.find((c) => c.label === "assessment:ats")?.model).toBe(DEFAULT_CONFIG.models.assessment.ats);
    // Limit oceny osobno dla krytyka, jak model.
    expect(llm.calls.find((c) => c.label === "assessment:ats")?.maxTokens).toBe(DEFAULT_CONFIG.maxTokens.assessment.ats);
    expect(llm.calls.find((c) => c.label === "assessment:hr")?.maxTokens).toBe(DEFAULT_CONFIG.maxTokens.assessment.hr);
    expect(llm.calls.at(-1)?.model).toBe("claude-opus-5-5");
    expect(run.calls).toHaveLength(llm.calls.length);
    expect(run.calls.every((c) => c.outcome === "ok" && c.attempt === 1)).toBe(true);
  });

  it("bez myslenia ocenia tylko krytyk z konfiguracji; domyslnie nikt (ewaluacja 17.10)", async () => {
    const llm = new FakeLlmClient(happy);
    await runTrial(input, { llm, config: { ...DEFAULT_CONFIG, assessmentWithoutThinking: ["ats"] } });
    expect(llm.calls.filter((c) => c.thinking === "off").map((c) => c.label)).toEqual(["assessment:ats"]);
    expect(DEFAULT_CONFIG.assessmentWithoutThinking).toEqual([]);

    const all = new FakeLlmClient(happy);
    await runTrial(input, { llm: all });
    expect(all.calls.some((c) => c.thinking !== undefined)).toBe(false);
  });

  it("kazde zapytanie niesie wspolne zasady i dokumenty — ten sam poczatek do cache", async () => {
    const llm = new FakeLlmClient(happy);
    await runTrial(input, { llm });
    for (const call of llm.calls) {
      expect(call.rules).toBe(RULES);
      expect(call.documents).toEqual([
        { name: "cv", text: input.cvText },
        { name: "oferta", text: input.jobOffer },
      ]);
    }
  });

  it("inna wersja promptow trafia do kazdego zapytania w swojej fazie", async () => {
    const llm = new FakeLlmClient(happy);
    const prompts: PromptSet = {
      version: "test",
      rules: "R",
      instructionsFor: (critic) => `I:${critic.id}`,
      judgeInstructions: "J",
      assessmentTask: "A",
      prosecutionTask: (state) => `P:${String(state.assessments.length)}`,
      debateTask: (state, id) => `D:${String(state.round)}:${id}`,
      judgeTask: (_, verdict) => `W:${verdict.decision}`,
    };
    await runTrial(input, { llm, prompts });
    const byLabel = new Map(llm.calls.map((c) => [c.label, c]));
    expect(llm.calls.every((c) => c.rules === "R")).toBe(true);
    expect(byLabel.get("assessment:hr")).toMatchObject({ instructions: "I:hr", task: "A" });
    expect(byLabel.get("prosecution")).toMatchObject({ instructions: "I:prosecutor", task: "P:5" });
    expect(byLabel.get("statement:1:ats")).toMatchObject({ instructions: "I:ats", task: "D:1:ats" });
    expect(byLabel.get("justification")).toMatchObject({ instructions: "J", task: "W:invite" });
  });

  it("zmiana zdania w debacie trafia do werdyktu", async () => {
    const turning: FakeScript = (req, i) =>
      req.label === "statement:1:hr" ? { statement: "Zmieniam", revisedScore: 2 } : happy(req, i);
    const run = await runTrial(input, { llm: new FakeLlmClient(turning) });
    expect(run.state.verdict).toMatchObject({ decision: "reject", mindChanges: [{ criticId: "hr", from: 6, to: 2 }] });
  });

  it("onEvent dostaje kazde zdarzenie razem ze stanem po nim", async () => {
    const seen: [string, string][] = [];
    await runTrial(input, { llm: new FakeLlmClient(happy), onEvent: (e, s) => seen.push([e.type, s.phase]) });
    expect(seen[0]).toEqual(["TrialFiled", "assessing"]);
    expect(seen[5]).toEqual(["AssessmentSubmitted", "prosecution"]);
    expect(seen.at(-1)).toEqual(["VerdictAnnounced", "closed"]);
  });

  it("onEvent dostaje proby, ktore wyprodukowaly zdarzenie — kazda dokladnie raz", async () => {
    const lying: FakeScript = (req, i) =>
      req.label === "assessment:hr" && req.retry === undefined
        ? { score: 6, summary: "ok", strengths: [], concerns: [{ quote: "10 lat w Google", issue: "x", severity: "low" }], rewrites: [] }
        : happy(req, i);
    const seen: [string, string[]][] = [];
    const run = await runTrial(input, {
      llm: new FakeLlmClient(lying),
      onEvent: (e, _s, calls) => seen.push([e.type, calls.map((c) => `${c.label}#${String(c.attempt)}`)]),
    });
    expect(seen[0]).toEqual(["TrialFiled", []]);
    // Odrzucona proba HR tez kosztowala — idzie do zdarzenia jego oceny.
    expect(seen[1]).toEqual(["AssessmentSubmitted", ["assessment:hr#1", "assessment:hr#2"]]);
    expect(seen.find(([t]) => t === "ProsecutionDelivered")?.[1]).toEqual(["prosecution#1"]);
    expect(seen.find(([t]) => t === "StatementMade")?.[1]).toEqual(["statement:1:ats#1"]);
    expect(seen.at(-1)).toEqual(["VerdictAnnounced", ["justification#1"]]);
    expect(seen.flatMap(([, c]) => c)).toHaveLength(run.calls.length);
  });

  it("wniesienie zgloszone synchronicznie, zanim runTrial odda obietnice", () => {
    const seen: string[] = [];
    const run = runTrial(input, { llm: new FakeLlmClient(happy), onEvent: (e) => seen.push(e.type) });
    expect(seen).toEqual(["TrialFiled"]);
    return run;
  });

  it("wyjatek obserwatora (np. zerwany strumien) nie przerywa rozprawy i trafia do onObserverError", async () => {
    const errors: unknown[] = [];
    const run = await runTrial(input, {
      llm: new FakeLlmClient(happy),
      onEvent: () => {
        throw new Error("klient SSE sie rozlaczyl");
      },
      onObserverError: (e) => errors.push(e),
    });
    expect(run.state.phase).toBe("closed");
    expect(errors).toHaveLength(run.events.length);
  });

  it("bez debaty: po oskarzeniu od razu werdykt", async () => {
    const llm = new FakeLlmClient(happy);
    const run = await runTrial({ ...input, debateRounds: 0 }, { llm });
    expect(run.state.phase).toBe("closed");
    expect(llm.calls.some((c) => c.label.startsWith("statement:"))).toBe(false);
  });

  it("niepoprawne wejscie to blad wywolujacego, zanim ktokolwiek zapyta model", async () => {
    const llm = new FakeLlmClient(happy);
    await expect(runTrial({ ...input, cvText: " " }, { llm })).rejects.toThrow();
    expect(llm.calls).toEqual([]);
  });
});

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
  it("najpierw sam lider cache (HR na Sonnecie, nie ATS na Haiku), potem czterech naraz", async () => {
    const { llm, started, settle, flush } = manual();
    const run = runTrial(input, { llm });
    await flush();
    expect(started).toEqual(["assessment:hr"]);
    await settle("assessment:hr");
    expect(started).toEqual(["hr", "ats", "techLead", "hiringManager", "prosecutor"].map((id) => `assessment:${id}`));
    for (const id of ["prosecutor", "ats", "hiringManager", "techLead"]) await settle(`assessment:${id}`);
    // Dalej nie idziemy: odmowa prokuratora konczy rozprawe, zeby test nie czekal.
    await settle("prosecution", new IncompleteOutputError("refusal", "claude-sonnet-5-5", FAKE_USAGE));
    const submitted = (await run).events.filter((e) => e.type === "AssessmentSubmitted");
    // Zdarzenia w kolejnosci odpowiedzi, nie miejsc przy stole.
    expect(submitted.map((e) => e.assessment.criticId)).toEqual(["hr", "prosecutor", "ats", "hiringManager", "techLead"]);
  });

  it("gdy jeden krytyk zawiedzie, pozostali sa anulowani i nikt nie dopisuje sie po przerwaniu", async () => {
    const { llm, settle } = manual();
    const run = runTrial(input, { llm });
    await settle("assessment:hr");
    await settle("assessment:ats");
    // Zawodzi ostatni przy stole, gdy Tech Lead i Hiring Manager jeszcze czekaja — powodem ma byc odmowa, nie ich anulowanie.
    await settle("assessment:prosecutor", new IncompleteOutputError("refusal", "claude-sonnet-5-5", FAKE_USAGE));
    const result = await run;
    expect(result.state).toMatchObject({ phase: "aborted", abortReason: "Odpowiedz modelu przerwana: refusal" });
    expect(result.events.filter((e) => e.type === "AssessmentSubmitted")).toHaveLength(2);
  });

  it("przerwanie dostaje wszystkie nieprzypisane proby, rowniez krytykow anulowanych w polowie", async () => {
    const { llm: base, settle } = manual();
    // Jak adapter Claude: anulowane zapytanie moglo juz kosztowac, wiec trafia do rejestru.
    const llm: LlmClient = {
      generate: (req, signal) =>
        base.generate(req, signal).catch(() => Promise.reject(new LlmTransportError("anulowano", false, true))),
    };
    const aborted: string[] = [];
    const run = runTrial(input, {
      llm,
      onEvent: (e, _s, calls) => {
        if (e.type === "TrialAborted") aborted.push(...calls.map((c) => c.label));
      },
    });
    await settle("assessment:hr");
    await settle("assessment:prosecutor", new IncompleteOutputError("refusal", "claude-sonnet-5-5", FAKE_USAGE));
    await run;
    expect(aborted.sort()).toEqual(["assessment:ats", "assessment:hiringManager", "assessment:prosecutor", "assessment:techLead"]);
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
    expect(run.state.phase).toBe("closed");
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
    await settle("assessment:hr");
    controller.abort();
    expect((await run).state.abortReason).toBe("Rozprawa anulowana");
  });
});
