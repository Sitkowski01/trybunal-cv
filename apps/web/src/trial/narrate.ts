import { CRITIC_LABELS } from "../labels.js";
import type { Court } from "./court.js";
import { seats, speaker } from "./seats.js";

/** Jedno zdanie o tym, co dzieje sie na sali — ogloszone tez czytnikowi ekranu. */
export function narrate(court: Court): string {
  if (court.status === "lost") return "Utracono połączenie z rozprawą.";
  if (court.status === "interrupted") return "Rozprawa urwała się bez werdyktu (np. restart serwera).";
  const trial = court.trial;
  if (trial === null) return "Łączenie z salą rozpraw…";
  switch (trial.phase) {
    case "assessing":
      return `Krytycy czytają akta: ${String(trial.assessments.length)} z ${String(seats(court).length)} ocen.`;
    case "prosecution":
      return "Prokurator przygotowuje mowę oskarżenia.";
    case "debate": {
      const now = speaker(court);
      const who = now === null ? "" : ` — mówi ${CRITIC_LABELS[now].name}`;
      return `Debata, runda ${String(trial.round)} z ${String(trial.debateRounds)}${who}.`;
    }
    case "deliberation":
      return "Sędzia się naradza.";
    case "closed":
      return "Werdykt ogłoszony.";
    case "aborted":
      return `Rozprawa przerwana: ${trial.abortReason ?? ""}`;
  }
}
