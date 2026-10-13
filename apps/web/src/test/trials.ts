import { type Assessment, announceVerdict, CRITIC_IDS, type CriticId, replay, type TrialEvent, toPublicEvent } from "@trybunal/domain";
import { apply, type Court, emptyCourt } from "../trial/court.js";
import type { Envelope } from "../trial/envelope.js";

/** Rozprawy do testow, zbudowane regulami domeny — zawsze poprawne. */
export const CV = "Java, Spring Boot. Pisalem testy.";

export const assessment = (criticId: CriticId, score: number, extra: Partial<Assessment> = {}): Assessment => ({
  criticId,
  score,
  summary: "ok",
  strengths: [],
  concerns: [],
  rewrites: [],
  ...extra,
});

export type Extras = Partial<Record<CriticId, Partial<Assessment>>>;

/** Pelna rozprawa z domeny: oceny, mowa, rundy debaty z wybranymi zmianami zdania, werdykt. */
export function trial(scores: readonly number[], revisions: readonly (number | null)[][], aborted = false, extras: Extras = {}): TrialEvent[] {
  const events: TrialEvent[] = [
    { type: "TrialFiled", trialId: "t-1", cvText: CV, jobOffer: "Junior Java", debateRounds: revisions.length },
    ...CRITIC_IDS.map((id, i): TrialEvent => ({ type: "AssessmentSubmitted", assessment: assessment(id, scores[i] ?? 5, extras[id]) })),
    { type: "ProsecutionDelivered", speech: "Odrzucic" },
    ...revisions.flatMap((round, r) =>
      CRITIC_IDS.map((criticId, i): TrialEvent => ({ type: "StatementMade", round: r + 1, criticId, statement: "...", revisedScore: round[i] ?? null })),
    ),
  ];
  return [...events, aborted ? { type: "TrialAborted", reason: "budzet" } : announceVerdict(replay(events), "Uzasadnienie")];
}

export const envelopes = (events: readonly TrialEvent[], cost = 0): Envelope[] =>
  events.map((e, i) => ({ seq: i + 1, occurredAt: "2026-10-13T10:00:00.000Z", event: toPublicEvent(e), calls: cost > 0 ? [{ costNanoUsd: cost }] : [] }));

export const fold = (list: readonly Envelope[], from: Court = emptyCourt) => list.reduce(apply, from);
