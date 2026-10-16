import { DEFAULT_CONFIG, PROMPTS, type PromptSet } from "@trybunal/court";
import { FakeLlmClient, type LlmClient, raw } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { heuristicLlm, heuristicScript } from "./heuristic.js";
import type { TrialOutcome } from "./outcome.js";
import { type EvalPlan, jobKey, planJobs, runEvals } from "./run.js";
import { evalCase } from "./test/fixtures.js";

const v2: PromptSet = { ...PROMPTS, version: "v2", rules: "inne zasady" };
const plan: EvalPlan = {
  cases: [evalCase({ id: "a" }), evalCase({ id: "b", cvText: "Lubię gotować.", expected: "reject" })],
  variants: [PROMPTS, v2],
  repeats: 2,
  debateRounds: 0,
};
const keys = (outcomes: readonly TrialOutcome[]) => outcomes.map((o) => `${o.variant}/${o.caseId}/${String(o.repeat)}`);

describe("planJobs", () => {
  it("najpierw pierwsze powtorzenie calego zbioru we wszystkich wariantach, potem kolejne", () => {
    expect(planJobs(plan).map(jobKey)).toEqual(["v1/a/0", "v2/a/0", "v1/b/0", "v2/b/0", "v1/a/1", "v2/a/1", "v1/b/1", "v2/b/1"]);
  });
});

describe("runEvals", () => {
  it("kazda rozprawa z promptami swojego wariantu i swoim klientem; wynik zapisany od razu", async () => {
    const clients: FakeLlmClient[] = [];
    const saved: TrialOutcome[] = [];
    const outcomes = await runEvals(plan, {
      llmFor: () => {
        const llm = heuristicLlm();
        clients.push(llm);
        return llm;
      },
      concurrency: 1,
      onOutcome: (o) => {
        saved.push(o);
      },
    });
    expect(keys(outcomes)).toEqual(planJobs(plan).map(jobKey));
    expect(saved).toEqual(outcomes);
    expect(clients).toHaveLength(8);
    expect(clients[1]?.calls.every((c) => c.rules === "inne zasady")).toBe(true);
    expect(clients[0]?.calls[0]?.documents[0]?.text).toBe(plan.cases[0]?.cvText);
    expect(outcomes.map((o) => o.decision)).toEqual(["invite", "invite", "reject", "reject", "invite", "invite", "reject", "reject"]);
  });

  it("pomija przebiegi juz zapisane i przekazuje konfiguracje sadu", async () => {
    const models: string[] = [];
    const config = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, justification: "claude-haiku-5-5" as const } };
    const outcomes = await runEvals(plan, {
      llmFor: () => ({
        generate: (request, signal) => {
          models.push(request.model);
          return heuristicLlm().generate(request, signal);
        },
      }),
      config,
      concurrency: 3,
      done: new Set(["v1/a/0", "v2/a/0", "v1/b/0", "v2/b/0", "v1/a/1"]),
      onOutcome: () => undefined,
    });
    expect(keys(outcomes).sort()).toEqual(["v1/b/1", "v2/a/1", "v2/b/1"]);
    expect(models.filter((m) => m === "claude-haiku-5-5").length).toBeGreaterThanOrEqual(6);
    expect(models).not.toContain("claude-opus-5-5");
  });

  it("rozprawy ida rownolegle do limitu", async () => {
    let running = 0;
    let peak = 0;
    const slow: LlmClient = {
      generate: async (request, signal) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return heuristicLlm().generate(request, signal);
      },
    };
    const single = { ...plan, variants: [PROMPTS] };
    await runEvals({ ...single, repeats: 3 }, { llmFor: () => slow, concurrency: 2, onOutcome: () => undefined });
    // Kazda rozprawa pyta do czterech krytykow naraz; dwie rozprawy -> wiecej niz cztery zapytania.
    expect(peak).toBeGreaterThan(4);
    peak = 0;
    await runEvals({ ...single, repeats: 1 }, { llmFor: () => slow, concurrency: 0, onOutcome: () => undefined });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("przerwana rozprawa z powodu promptow (zla odpowiedz) jest zapisana jako wynik", async () => {
    const broken = new FakeLlmClient((req, i) => (req.label === "prosecution" ? raw("zle") : heuristicScript(req, i)));
    const outcomes = await runEvals({ ...plan, repeats: 1, variants: [PROMPTS], cases: [evalCase()] }, { llmFor: () => broken, concurrency: 1, onOutcome: () => undefined });
    expect(outcomes).toMatchObject([{ decision: null }]);
  });

  it("zatrzymanie (budzet przebiegu): rozprawa przerwana przez nie nie trafia do wynikow, kolejne nie ruszaja", async () => {
    let halted = false;
    let started = 0;
    const llmFor = () => {
      started++;
      return new FakeLlmClient((req, i) => {
        if (started === 2 && req.label === "prosecution") {
          halted = true;
          throw new Error("budzet przebiegu");
        }
        return heuristicScript(req, i);
      });
    };
    const saved: TrialOutcome[] = [];
    const outcomes = await runEvals(plan, { llmFor, concurrency: 1, halted: () => halted, onOutcome: (o) => void saved.push(o) });
    expect(keys(outcomes)).toEqual(["v1/a/0"]);
    expect(saved).toHaveLength(1);
    expect(started).toBe(2);
  });

  it("nieoczekiwany blad (zapis wyniku) zatrzymuje wszystkich pracownikow i wychodzi na zewnatrz", async () => {
    let started = 0;
    const llmFor = () => {
      started++;
      return heuristicLlm();
    };
    let saves = 0;
    const onOutcome = () => {
      saves++;
      if (saves === 1) throw new Error("dysk pelny");
    };
    await expect(runEvals(plan, { llmFor, concurrency: 2, onOutcome })).rejects.toThrow("dysk pelny");
    // Dwie rozprawy szly naraz; po bledzie nikt nie zaczyna nowej.
    expect(started).toBe(2);
    expect(saves).toBe(2);
  });

  it("Ctrl+C: anulowany sygnal nie zaczyna rozpraw", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcomes = await runEvals(plan, { llmFor: heuristicLlm, concurrency: 2, signal: controller.signal, onOutcome: () => undefined });
    expect(outcomes).toEqual([]);
  });

  it("Ctrl+C w trakcie: przerwana rozprawa nie jest zapisana", async () => {
    const controller = new AbortController();
    const llmFor = () =>
      new FakeLlmClient((req, i) => {
        if (req.label === "prosecution") controller.abort();
        return heuristicScript(req, i);
      });
    const outcomes = await runEvals(plan, { llmFor, concurrency: 1, signal: controller.signal, onOutcome: () => undefined });
    expect(outcomes).toEqual([]);
  });
});
