import { CRITIC_LABELS } from "../labels.js";
import type { Court } from "./court.js";
import { seats } from "./seats.js";

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
      // Ten, czyja wypowiedz jest w dymku i na koncu protokolu; przed pierwsza — mowa oskarzenia.
      const last = trial.statements.at(-1);
      if (last === undefined) return "Prokurator wygłasza mowę oskarżenia.";
      return `Debata, runda ${String(last.round)} z ${String(trial.debateRounds)} — mówi ${CRITIC_LABELS[last.criticId].name}.`;
    }
    case "deliberation":
      return "Sędzia się naradza.";
    case "closed":
      return "Werdykt ogłoszony.";
    case "aborted":
      return `Rozprawa przerwana: ${trial.abortReason ?? ""}`;
  }
}
