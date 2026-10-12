import type { CriticId } from "@trybunal/domain";
import { BudgetedLlmClient, FakeLlmClient, type FakeScript } from "@trybunal/llm";
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
});
