import type { Assessment } from "./assessment.js";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import type { Scores, Verdict } from "./verdict.js";

/**
 * Rozprawa jako ciag zdarzen. Stan nie jest nigdzie zapisywany — to wynik zlozenia zdarzen
 * (event sourcing), wiec rozprawe da sie odtworzyc krok po kroku, np. w powtorce na scenie.
 * evolve() pilnuje kolejnosci: zdarzenie nie na swoim miejscu to blad, nie cicha zmiana stanu.
 */
export const MAX_DEBATE_ROUNDS = 3;

export type TrialEvent =
  | {
      readonly type: "TrialFiled";
      readonly trialId: string;
      readonly cvText: string;
      readonly jobOffer: string;
      readonly debateRounds: number;
    }
  | { readonly type: "AssessmentSubmitted"; readonly assessment: Assessment }
  | { readonly type: "ProsecutionDelivered"; readonly speech: string }
  | {
      readonly type: "StatementMade";
      readonly round: number;
      readonly criticId: CriticId;
      readonly statement: string;
      readonly revisedScore: number | null;
    }
  | { readonly type: "VerdictAnnounced"; readonly justification: string }
  | { readonly type: "TrialAborted"; readonly reason: string };

export type Phase = "assessing" | "prosecution" | "debate" | "deliberation" | "closed" | "aborted";

export interface Statement {
  readonly round: number;
  readonly criticId: CriticId;
  readonly statement: string;
  readonly revisedScore: number | null;
}

export interface TrialState {
  readonly trialId: string;
  readonly cvText: string;
  readonly jobOffer: string;
  readonly debateRounds: number;
  readonly phase: Phase;
  /** Oceny w kolejnosci zlozenia; kazdy krytyk najwyzej raz. */
  readonly assessments: readonly Assessment[];
  readonly prosecution: string | null;
  readonly round: number;
  readonly statements: readonly Statement[];
  readonly verdict: Verdict | null;
  readonly justification: string | null;
  readonly abortReason: string | null;
}

export class TrialRuleError extends Error {
  override readonly name = "TrialRuleError";
}

const fail = (message: string): never => {
  throw new TrialRuleError(message);
};

export function fileTrial(event: TrialEvent): TrialState {
  if (event.type !== "TrialFiled") {
    return fail(`Rozprawa musi zaczac sie od TrialFiled, a nie ${event.type}`);
  }
  const { trialId, cvText, jobOffer, debateRounds } = event;
  if (!Number.isInteger(debateRounds) || debateRounds < 0 || debateRounds > MAX_DEBATE_ROUNDS) {
    return fail(`Liczba rund debaty musi byc od 0 do ${String(MAX_DEBATE_ROUNDS)}`);
  }
  return {
    trialId,
    cvText,
    jobOffer,
    debateRounds,
    phase: "assessing",
    assessments: [],
    prosecution: null,
    round: 0,
    statements: [],
    verdict: null,
    justification: null,
    abortReason: null,
  };
}

export function evolve(state: TrialState, event: TrialEvent): TrialState {
  switch (event.type) {
    case "TrialFiled":
      return fail("Rozprawa juz zostala wniesiona");
    case "AssessmentSubmitted":
      return submitAssessment(state, event.assessment);
    case "TrialAborted":
    case "ProsecutionDelivered":
    case "StatementMade":
    case "VerdictAnnounced":
      return fail(`${event.type}: jeszcze nieobslugiwane`);
  }
}

export function replay(events: readonly TrialEvent[]): TrialState {
  const [first, ...rest] = events;
  if (first === undefined) {
    return fail("Brak zdarzen rozprawy");
  }
  return rest.reduce(evolve, fileTrial(first));
}

function requirePhase(state: TrialState, phase: Phase, action: string): void {
  if (state.phase !== phase) {
    fail(`${action} mozliwe w fazie ${phase}, a rozprawa jest w fazie ${state.phase}`);
  }
}

function submitAssessment(state: TrialState, assessment: Assessment): TrialState {
  requirePhase(state, "assessing", "Ocena");
  const id = assessment.criticId;
  if (state.assessments.some((a) => a.criticId === id)) {
    return fail(`Krytyk ${id} juz zlozyl ocene`);
  }
  const assessments = [...state.assessments, assessment];
  // Id sa unikalne i z zamknietej listy, wiec komplet = tyle ocen, ilu krytykow.
  const allIn = assessments.length === CRITIC_IDS.length;
  return { ...state, assessments, phase: allIn ? "prosecution" : "assessing" };
}

// Rzutowanie jest bezpieczne od fazy prosecution: wtedy kazdy krytyk ma dokladnie jedna ocene.
// Wczesniej wynik jest niepelny — dlatego funkcje wolamy tylko po zebraniu ocen.
type PartialScores = Partial<Record<CriticId, number>>;

/** Oceny z niezaleznej rundy, zanim ktokolwiek uslyszal innych. */
export function initialScores(state: TrialState): Scores {
  return Object.fromEntries(state.assessments.map((a) => [a.criticId, a.score])) as PartialScores as Scores;
}
