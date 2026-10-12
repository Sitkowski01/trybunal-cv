import { CRITIC_IDS, type CriticId, jurors } from "./critics.js";

/**
 * Narada sedziego. Decyzje podejmuje regula, nie model: ten sam zestaw ocen zawsze daje ten
 * sam werdykt, wiec da sie go przetestowac i odtworzyc z dziennika. Model sedziego dostaje
 * gotowy werdykt i pisze tylko uzasadnienie.
 */
export const INVITE_THRESHOLD = 6;
/** Ponizej tej oceny ATS odrzuca CV, zanim zobaczy je czlowiek — srednia nic tu nie pomoze. */
export const ATS_GATE = 4;
/** Rozrzut ocen przysieglych, od ktorego CV uznajemy za niejednoznaczne. */
export const DISPUTE_SPREAD = 4;

export type Scores = Readonly<Record<CriticId, number>>;

export interface MindChange {
  readonly criticId: CriticId;
  readonly from: number;
  readonly to: number;
}

export interface Verdict {
  readonly decision: "invite" | "reject";
  /** Srednia przysieglych; prokurator oskarza, ale nie glosuje. */
  readonly juryAverage: number;
  readonly atsGateFailed: boolean;
  readonly spread: number;
  readonly disputed: boolean;
  readonly harshest: readonly CriticId[];
  readonly mildest: readonly CriticId[];
  readonly mindChanges: readonly MindChange[];
}

export function deliberate(initial: Scores, final: Scores): Verdict {
  const jury = jurors().map((c) => c.id);
  const juryScores = jury.map((id) => final[id]);
  const juryAverage = juryScores.reduce((sum, s) => sum + s, 0) / jury.length;
  const highest = Math.max(...juryScores);
  const lowest = Math.min(...juryScores);
  const spread = highest - lowest;
  const atsGateFailed = final.ats < ATS_GATE;

  return {
    decision: !atsGateFailed && juryAverage >= INVITE_THRESHOLD ? "invite" : "reject",
    juryAverage,
    atsGateFailed,
    spread,
    disputed: spread >= DISPUTE_SPREAD,
    harshest: jury.filter((id) => final[id] === lowest),
    mildest: jury.filter((id) => final[id] === highest),
    mindChanges: CRITIC_IDS.filter((id) => initial[id] !== final[id]).map((id) => ({
      criticId: id,
      from: initial[id],
      to: final[id],
    })),
  };
}
