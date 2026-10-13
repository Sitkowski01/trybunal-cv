import { type Assessment, findInventedQuotes, ScoreSchema } from "./assessment.js";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import { MAX_DEBATE_ROUNDS, type PublicTrialEvent, type TrialEvent } from "./events.js";
import { deliberate, RULE_VERSION, type Scores, type Verdict } from "./verdict.js";

/**
 * Rozprawa jako ciag zdarzen. Stan nie jest nigdzie zapisywany — to wynik zlozenia zdarzen
 * (event sourcing), wiec rozprawe da sie odtworzyc krok po kroku, np. w powtorce na scenie.
 * evolve() pilnuje kolejnosci: zdarzenie nie na swoim miejscu to blad, nie cicha zmiana stanu.
 * Ksztalt zdarzen sprawdza TrialEventSchema (events.ts), tu sprawdzamy reguly rozprawy.
 */
export type { TrialEvent } from "./events.js";
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
  return step(state, event, true);
}

/**
 * Rozprawa widziana z zewnatrz (przegladarka, scena): zdarzenia bez tekstu CV. Te same reguly
 * kolejnosci i faz co evolve, tylko bez sprawdzania cytatow — nie ma z czym ich porownac,
 * a serwer sprawdzil je przed zapisem do dziennika.
 */
export function filePublicTrial(event: PublicTrialEvent): TrialState {
  if (event.type !== "TrialFiled") {
    return fail(`Rozprawa musi zaczac sie od TrialFiled, a nie ${event.type}`);
  }
  return fileTrial({ type: "TrialFiled", trialId: event.trialId, cvText: "", jobOffer: "", debateRounds: event.debateRounds });
}

export function evolvePublic(state: TrialState, event: PublicTrialEvent): TrialState {
  if (event.type === "TrialFiled") return fail("Rozprawa juz zostala wniesiona");
  return step(state, event, false);
}

function step(state: TrialState, event: TrialEvent, checkQuotes: boolean): TrialState {
  if (state.phase === "closed" || state.phase === "aborted") {
    return fail(`Rozprawa jest zakonczona (${state.phase}), odrzucono ${event.type}`);
  }
  switch (event.type) {
    case "TrialFiled":
      return fail("Rozprawa juz zostala wniesiona");
    case "TrialAborted":
      return { ...state, phase: "aborted", abortReason: event.reason };
    case "AssessmentSubmitted":
      return submitAssessment(state, event.assessment, checkQuotes);
    case "ProsecutionDelivered":
      return deliverProsecution(state, event.speech);
    case "StatementMade":
      return makeStatement(state, event);
    case "VerdictAnnounced":
      return closeWithVerdict(state, event.verdict, event.justification);
    default:
      // Typ wyklucza ten przypadek, ale zdarzenia przyjda tez z bazy, gdzie typ niczego nie gwarantuje.
      return fail(`Nieznane zdarzenie: ${String((event as { type: unknown }).type)}`);
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
    return fail(`${action} mozliwe w fazie ${phase}, a rozprawa jest w fazie ${state.phase}`);
  }
}

function submitAssessment(state: TrialState, assessment: Assessment, checkQuotes: boolean): TrialState {
  requirePhase(state, "assessing", "Ocena");
  const id = assessment.criticId;
  if (state.assessments.some((a) => a.criticId === id)) {
    return fail(`Krytyk ${id} juz zlozyl ocene`);
  }
  const invented = checkQuotes ? findInventedQuotes(assessment, state.cvText) : [];
  if (invented.length > 0) {
    return fail(`Krytyk ${id} cytuje cos, czego nie ma w CV: ${invented.join(" | ")}`);
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
  if (event.revisedScore !== null && !ScoreSchema.safeParse(event.revisedScore).success) {
    return fail(`Nowa ocena ${String(event.revisedScore)} poza skala 1-10`);
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

/** Werdykt, ktory wynika z ocen — orkiestracja daje go modelowi sedziego do uzasadnienia. */
export function pendingVerdict(state: TrialState): Verdict {
  requirePhase(state, "deliberation", "Werdykt");
  return deliberate(initialScores(state), currentScores(state));
}

/** Jedyna droga do zdarzenia werdyktu: decyzja z reguly, uzasadnienie od sedziego. */
export function announceVerdict(state: TrialState, justification: string): TrialEvent {
  return { type: "VerdictAnnounced", ruleVersion: RULE_VERSION, verdict: pendingVerdict(state), justification };
}

// Zdarzenie to fakt: przy odtwarzaniu bierzemy zapisany werdykt, a nie liczymy go od nowa
// biezaca regula, ktora mogla sie od tego czasu zmienic.
function closeWithVerdict(state: TrialState, verdict: Verdict, justification: string): TrialState {
  requirePhase(state, "deliberation", "Werdykt");
  return { ...state, verdict, justification, phase: "closed" };
}

type PartialScores = Partial<Record<CriticId, number>>;

/** Oceny z niezaleznej rundy, zanim ktokolwiek uslyszal innych. Dostepne po zebraniu wszystkich. */
export function initialScores(state: TrialState): Scores {
  if (state.assessments.length < CRITIC_IDS.length) {
    return fail("Oceny nie sa jeszcze kompletne");
  }
  // Bezpieczne: wyzej sprawdzone, ze kazdy krytyk ma dokladnie jedna ocene.
  return Object.fromEntries(state.assessments.map((a) => [a.criticId, a.score])) as PartialScores as Scores;
}

/** Oceny po debacie: ocena poczatkowa nadpisana ostatnia zmiana zdania danego krytyka. */
export function currentScores(state: TrialState): Scores {
  const revisions = state.statements.flatMap((s) => (s.revisedScore === null ? [] : [[s.criticId, s.revisedScore]]));
  return { ...initialScores(state), ...(Object.fromEntries(revisions) as PartialScores) };
}
