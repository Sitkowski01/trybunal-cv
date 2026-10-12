import { criticById, type TrialEvent, type TrialState } from "@trybunal/domain";
import { formatUsd } from "@trybunal/llm";
import type { CallRecord } from "./ask.js";

/** Jedna linia przebiegu rozprawy do konsoli — to samo, co pozniej pokaze scena. */
export function narrate(event: TrialEvent, state: TrialState): string {
  switch (event.type) {
    case "TrialFiled":
      return `[wniesienie] rozprawa ${event.trialId}, rund debaty: ${String(event.debateRounds)}`;
    case "AssessmentSubmitted": {
      const { criticId, score, summary } = event.assessment;
      return `[ocena] ${criticById(criticId).name}: ${String(score)}/10 — ${summary}`;
    }
    case "ProsecutionDelivered":
      return `[oskarzenie] ${event.speech}`;
    case "StatementMade": {
      const change = event.revisedScore === null ? "" : ` (nowa ocena: ${String(event.revisedScore)})`;
      return `[debata ${String(event.round)}] ${criticById(event.criticId).name}: ${event.statement}${change}`;
    }
    case "VerdictAnnounced": {
      const decision = event.verdict.decision === "invite" ? "ZAPROSIC NA ROZMOWE" : "ODRZUCIC";
      return `[werdykt] ${decision} (srednia ${String(event.verdict.juryAverage)}) — ${event.justification}`;
    }
    case "TrialAborted":
      return `[przerwano] ${event.reason} (zebrane oceny: ${String(state.assessments.length)}/5)`;
  }
}

/** Podsumowanie kosztu: ile wywolan, ile prob nieudanych, ile dolarow. */
export function costSummary(calls: readonly CallRecord[]): string {
  const total = calls.reduce((sum, c) => sum + c.costNanoUsd, 0);
  const failed = calls.filter((c) => c.outcome !== "ok").length;
  const unknown = calls.filter((c) => !c.costKnown).length;
  const note = unknown === 0 ? "" : `, koszt ${String(unknown)} nieznany — budzet liczy je jako najdrozsze`;
  return `Koszt: ${formatUsd(total)} za ${String(calls.length)} wywolan (nieudanych: ${String(failed)}${note})`;
}
