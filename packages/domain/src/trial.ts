import type { Assessment } from "./assessment.js";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import { deliberate, type Scores, type Verdict } from "./verdict.js";

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
  if (state.phase === "closed" || state.phase === "aborted") {
    return fail(`Rozprawa jest zakonczona (${state.phase}), odrzucono ${event.type}`);
  }
  switch (event.type) {
    case "TrialFiled":
      return fail("Rozprawa juz zostala wniesiona");
    case "TrialAborted":
      return { ...state, phase: "aborted", abortReason: event.reason };
    case "AssessmentSubmitted":
      return submitAssessment(state, event.assessment);
    case "ProsecutionDelivered":
      return deliverProsecution(state, event.speech);
    case "StatementMade":
      return makeStatement(state, event);
    case "VerdictAnnounced":
      return announceVerdict(state, event.justification);
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

function deliverProsecution(state: TrialState, speech: string): TrialState {
  requirePhase(state, "prosecution", "Mowa oskarzenia");
  const debate = state.debateRounds > 0;
  return { ...state, prosecution: speech, phase: debate ? "debate" : "deliberation", round: debate ? 1 : 0 };
}

/** Kto mowi teraz w debacie: kazda runda to wszyscy krytycy w kolejnosci miejsc przy stole. */
export function nextSpeaker(state: TrialState): CriticId | null {
  if (state.phase !== "debate") {
    return null;
  }
  const spokenThisRound = state.statements.filter((s) => s.round === state.round).length;
  return CRITIC_IDS[spokenThisRound] ?? null;
}

function makeStatement(state: TrialState, event: Extract<TrialEvent, { type: "StatementMade" }>): TrialState {
  requirePhase(state, "debate", "Wypowiedz");
  const expected = nextSpeaker(state);
  if (event.round !== state.round || event.criticId !== expected) {
    return fail(`Teraz mowi ${String(expected)} w rundzie ${String(state.round)}`);
  }
  const { round, criticId, statement, revisedScore } = event;
  const statements = [...state.statements, { round, criticId, statement, revisedScore }];
  const roundOver = criticId === CRITIC_IDS[CRITIC_IDS.length - 1];
  const debateOver = roundOver && state.round === state.debateRounds;
  return {
    ...state,
    statements,
    round: roundOver && !debateOver ? state.round + 1 : state.round,
    phase: debateOver ? "deliberation" : "debate",
  };
}

function announceVerdict(state: TrialState, justification: string): TrialState {
  requirePhase(state, "deliberation", "Werdykt");
  const verdict = deliberate(initialScores(state), currentScores(state));
  return { ...state, verdict, justification, phase: "closed" };
}

// Rzutowanie jest bezpieczne od fazy prosecution: wtedy kazdy krytyk ma dokladnie jedna ocene.
// Wczesniej wynik jest niepelny — dlatego funkcje wolamy tylko po zebraniu ocen.
type PartialScores = Partial<Record<CriticId, number>>;

/** Oceny z niezaleznej rundy, zanim ktokolwiek uslyszal innych. */
export function initialScores(state: TrialState): Scores {
  return Object.fromEntries(state.assessments.map((a) => [a.criticId, a.score])) as PartialScores as Scores;
}

/** Oceny po debacie: ocena poczatkowa nadpisana ostatnia zmiana zdania danego krytyka. */
export function currentScores(state: TrialState): Scores {
  const revisions = state.statements.flatMap((s) => (s.revisedScore === null ? [] : [[s.criticId, s.revisedScore]]));
  return { ...initialScores(state), ...(Object.fromEntries(revisions) as PartialScores) };
}
