import { CRITIC_IDS, replay, type TrialEvent } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import type { CallRecord } from "./ask.js";
import { costSummary, narrate } from "./narration.js";

const filed: TrialEvent = { type: "TrialFiled", trialId: "t-1", cvText: "CV z Java", jobOffer: "o", debateRounds: 2 };
const assessed: TrialEvent[] = CRITIC_IDS.map((criticId) => ({
  type: "AssessmentSubmitted",
  assessment: { criticId, score: 7, summary: "solidnie", strengths: [], concerns: [], rewrites: [] },
}));

/** Narracja zdarzenia po zastosowaniu go do rozprawy. */
const line = (history: TrialEvent[], event: TrialEvent) => narrate(event, replay([...history, event]));

describe("narrate", () => {
  it("opisuje kazda faze rozprawy jedna linia", () => {
    expect(narrate(filed, replay([filed]))).toBe("[wniesienie] rozprawa t-1, rund debaty: 2");
    expect(line([filed], assessed[1] as TrialEvent)).toBe("[ocena] HR screener: 7/10 — solidnie");
    const prosecution: TrialEvent = { type: "ProsecutionDelivered", speech: "Odrzucic" };
    expect(line([filed, ...assessed], prosecution)).toBe("[oskarzenie] Odrzucic");
    const history = [filed, ...assessed, prosecution];
    expect(line(history, { type: "StatementMade", round: 1, criticId: "ats", statement: "Tak", revisedScore: null })).toBe(
      "[debata 1] Bot ATS: Tak",
    );
    expect(line(history, { type: "StatementMade", round: 1, criticId: "ats", statement: "Nie", revisedScore: 3 })).toBe(
      "[debata 1] Bot ATS: Nie (nowa ocena: 3)",
    );
  });

  it("werdykt: decyzja, srednia i uzasadnienie", () => {
    const base = [{ ...filed, debateRounds: 0 }, ...assessed, { type: "ProsecutionDelivered", speech: "x" } as TrialEvent];
    const verdict = (decision: "invite" | "reject"): TrialEvent => ({
      type: "VerdictAnnounced",
      ruleVersion: 1,
      verdict: { decision, juryAverage: 7, atsGateFailed: false, spread: 0, disputed: false, harshest: [], mildest: [], mindChanges: [] },
      justification: "Bo tak",
    });
    expect(line(base, verdict("invite"))).toBe("[werdykt] ZAPROSIC NA ROZMOWE (srednia 7) — Bo tak");
    expect(line(base, verdict("reject"))).toBe("[werdykt] ODRZUCIC (srednia 7) — Bo tak");
  });

  it("przerwanie: powod i ile ocen zdazylo przyjsc", () => {
    expect(line([filed, ...assessed.slice(0, 3)], { type: "TrialAborted", reason: "Budzet" })).toBe(
      "[przerwano] Budzet (zebrane oceny: 3/5)",
    );
  });
});

describe("costSummary", () => {
  const call = (outcome: CallRecord["outcome"], costNanoUsd: number, costKnown = true): CallRecord => ({
    label: "a",
    attempt: 1,
    model: "claude-sonnet-5-5",
    outcome,
    usage: null,
    costNanoUsd,
    costKnown,
    durationMs: 1,
  });

  it("sumuje koszt wszystkich prob i liczy nieudane", () => {
    expect(costSummary([call("ok", 1_000_000), call("invalid", 500_000), call("transport", 0)])).toBe(
      "Koszt: $0.0015 za 3 wywolan (nieudanych: 2)",
    );
  });

  it("mowi wprost, gdy czesci kosztow nie znamy", () => {
    expect(costSummary([call("ok", 100_000), call("transport", 0, false)])).toBe(
      "Koszt: $0.0001 za 2 wywolan (nieudanych: 1, koszt 1 nieznany — budzet liczy je jako najdrozsze)",
    );
  });

  it("bez wywolan: zero", () => {
    expect(costSummary([])).toBe("Koszt: $0.0000 za 0 wywolan (nieudanych: 0)");
  });
});
