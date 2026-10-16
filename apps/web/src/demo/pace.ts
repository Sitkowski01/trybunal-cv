import type { PublicTrialEvent } from "@trybunal/domain";

/**
 * Tempo odtwarzania nagrania. Prawdziwe odstepy miedzy zdarzeniami to czas odpowiedzi modelu
 * (pieciu krytykow naraz, potem dlugie czekanie na sedziego) — na ekranie liczy sie co innego:
 * czy widz zdazy przeczytac dymek. Przerwa po zdarzeniu zalezy wiec od dlugosci jego tekstu.
 */
export const FIRST_EVENT_MS = 300;
/** Krytycy czytaja akta — scena pokazuje to, zanim przyjdzie pierwsza ocena. */
export const READING_FILES_MS = 2500;
export const AFTER_ASSESSMENT_MS = 1200;
export const MS_PER_CHAR = 35;
export const MIN_SPEECH_MS = 2000;
export const MAX_SPEECH_MS = 7000;

const reading = (text: string) => Math.min(MAX_SPEECH_MS, Math.max(MIN_SPEECH_MS, text.length * MS_PER_CHAR));

/** Ile czekac po tym zdarzeniu na nastepne (przy tempie 1). */
export function pauseAfter(event: PublicTrialEvent): number {
  switch (event.type) {
    case "TrialFiled":
      return READING_FILES_MS;
    case "AssessmentSubmitted":
      return AFTER_ASSESSMENT_MS;
    case "ProsecutionDelivered":
      return reading(event.speech);
    case "StatementMade":
      return reading(event.statement);
    case "VerdictAnnounced":
    case "TrialAborted":
      return 0;
  }
}
