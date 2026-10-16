import type { CriticId } from "@trybunal/domain";
import type { EvalCase } from "../dataset.js";
import type { TrialOutcome } from "../outcome.js";

export const evalCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: "c1",
  cv: "cvs/c1.md",
  offer: "offers/o1.md",
  expected: "invite",
  tags: ["mocne"],
  note: "test",
  cvText: "Jan. Java, Spring Boot, PostgreSQL.",
  offerText: "Wymagania:\n- Java\n- Spring Boot\n- PostgreSQL",
  ...over,
});

const scores = (value: number): Record<CriticId, number> => ({ ats: value, hr: value, techLead: value, hiringManager: value, prosecutor: value });

/** Zakonczona rozprawa; decyzja i srednia ustawiane razem, reszta neutralna. */
export const outcome = (over: Partial<TrialOutcome> = {}): TrialOutcome => ({
  caseId: "c1",
  variant: "v1",
  repeat: 0,
  expected: "invite",
  tags: ["mocne"],
  decision: "invite",
  abortReason: null,
  juryAverage: 7,
  initialScores: scores(7),
  finalScores: scores(7),
  costNanoUsd: 1000,
  attempts: 12,
  failedAttempts: 0,
  inputTokens: 100,
  outputTokens: 50,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ...over,
});

export const aborted = (over: Partial<TrialOutcome> = {}): TrialOutcome =>
  outcome({ decision: null, juryAverage: null, initialScores: null, finalScores: null, abortReason: "budzet", ...over });
