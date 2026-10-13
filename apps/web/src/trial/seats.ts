import { type Assessment, CRITIC_IDS, type CriticId, nextSpeaker, type Statement } from "@trybunal/domain";
import type { Court } from "./court.js";

/** Widok sali przy stole: kto ocenil, na ile, co powiedzial i kto teraz mowi. */
export interface Seat {
  readonly criticId: CriticId;
  readonly assessment: Assessment | null;
  /** Ocena po ostatniej zmianie zdania; null, dopoki krytyk nie zlozyl oceny. */
  readonly score: number | null;
  readonly statements: readonly Statement[];
}

/** Miejsca przy stole w kolejnosci z domeny: ocena, zmiany zdania, wypowiedzi. */
export function seats(court: Court): readonly Seat[] {
  const trial = court.trial;
  return CRITIC_IDS.map((criticId) => {
    const assessment = trial?.assessments.find((a) => a.criticId === criticId) ?? null;
    const statements = trial?.statements.filter((s) => s.criticId === criticId) ?? [];
    const revised = statements.findLast((s) => s.revisedScore !== null)?.revisedScore;
    return { criticId, assessment, statements, score: revised ?? assessment?.score ?? null };
  });
}

/** Kto mowi w debacie (regula z domeny). */
export const speaker = (court: Court): CriticId | null => (court.trial === null ? null : nextSpeaker(court.trial));
