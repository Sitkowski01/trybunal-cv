import { evolvePublic, filePublicTrial, type Phase, type TrialState, TrialRuleError } from "@trybunal/domain";
import type { Envelope } from "./envelope.js";

/**
 * Sala rozpraw widziana z przegladarki: stan rozprawy z domeny (evolvePublic — te same reguly
 * co na serwerze, bez sprawdzania cytatow, bo tekst CV nie opuszcza serwera) plus to, co wie
 * tylko klient: stan polaczenia, koszt i numer ostatniego zdarzenia.
 */

/** Stan polaczenia ze strumieniem; "interrupted": serwer zakonczyl strumien bez werdyktu. */
export type StreamStatus = "connecting" | "live" | "finished" | "interrupted" | "lost";

export interface Court {
  readonly status: StreamStatus;
  /** null: wniesienie jeszcze nie przyszlo. */
  readonly trial: TrialState | null;
  /** Faza, w ktorej rozprawe przerwano — os faz pokazuje, dokad doszla. */
  readonly abortedIn: Phase | null;
  readonly costNanoUsd: number;
  /** Numer ostatniego zlozonego zdarzenia — starsze i powtorzone (wznowienie) pomijamy. */
  readonly lastSeq: number;
  /** Zdarzenie niezgodne z regulami rozprawy: dalej nie sledzimy, zeby nie pokazac bzdury. */
  readonly fault: string | null;
}

export const emptyCourt: Court = { status: "connecting", trial: null, abortedIn: null, costNanoUsd: 0, lastSeq: 0, fault: null };

export function apply(court: Court, envelope: Envelope): Court {
  if (envelope.seq <= court.lastSeq || court.fault !== null) return court;
  let trial: TrialState;
  try {
    trial = court.trial === null ? filePublicTrial(envelope.event) : evolvePublic(court.trial, envelope.event);
  } catch (error) {
    if (!(error instanceof TrialRuleError)) throw error;
    return { ...court, status: "lost", fault: `Serwer przysłał zdarzenie niezgodne z przebiegiem rozprawy: ${error.message}` };
  }
  const cost = envelope.calls.reduce((sum, call) => sum + call.costNanoUsd, 0);
  return {
    ...court,
    trial,
    status: isOver(trial.phase) ? "finished" : "live",
    abortedIn: trial.phase === "aborted" ? (court.trial?.phase ?? null) : null,
    costNanoUsd: court.costNanoUsd + cost,
    lastSeq: envelope.seq,
  };
}

/** Serwer zamknal strumien zdarzeniem "end"; bez zdarzenia konczacego to przerwanie. */
export const ended = (court: Court): Court => (court.status === "finished" || court.status === "lost" ? court : { ...court, status: "interrupted" });

export const isOver = (phase: Phase) => phase === "closed" || phase === "aborted";

export const phaseOf = (court: Court): Phase | null => court.trial?.phase ?? null;
