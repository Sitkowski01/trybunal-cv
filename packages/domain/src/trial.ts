import type { Assessment } from "./assessment.js";
import type { CriticId } from "./critics.js";
import type { Verdict } from "./verdict.js";

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
