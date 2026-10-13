import type { PublicTrialEvent } from "@trybunal/domain";
import { BadEnvelopeError, type Envelope, parseEnvelope } from "../trial/envelope.js";

/**
 * Strumien zdarzen rozprawy przez EventSource. Przegladarka sama wznawia zerwane polaczenie
 * z naglowkiem Last-Event-ID, a serwer konczy strumien zdarzeniem "end" — bez niego
 * EventSource laczylby sie w nieskonczonosc.
 */

/** Nazwy zdarzen SSE. Rekord zamiast tablicy: nowy typ zdarzenia bez wpisu tu nie skompiluje sie. */
const EVENT_TYPES: Record<PublicTrialEvent["type"], true> = {
  TrialFiled: true,
  AssessmentSubmitted: true,
  ProsecutionDelivered: true,
  StatementMade: true,
  VerdictAnnounced: true,
  TrialAborted: true,
};

/** Tyle z EventSource, ile uzywamy — w testach podstawiamy atrape. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export const CLOSED = 2;

export interface StreamHandlers {
  /** Polaczenie otwarte — takze po wznowieniu. */
  readonly onOpen: () => void;
  readonly onEnvelope: (envelope: Envelope) => void;
  readonly onEnd: (reason: "finished" | "interrupted") => void;
  /** "lost": serwer odmowil albo polaczenie padlo na dobre; "reconnecting": przegladarka probuje dalej. */
  readonly onTrouble: (kind: "lost" | "reconnecting" | "bad-data", message: string) => void;
}

/** Otwiera strumien; zwraca funkcje zamykajaca (do sprzatania w efekcie Reacta). */
export function openTrialStream(url: string, handlers: StreamHandlers, factory: EventSourceFactory): () => void {
  const source = factory(url);
  let open = true;
  const close = () => {
    open = false;
    source.close();
  };

  for (const type of Object.keys(EVENT_TYPES)) {
    source.addEventListener(type, (message) => {
      if (!open) return;
      try {
        handlers.onEnvelope(parseEnvelope(message.data));
      } catch (error) {
        if (!(error instanceof BadEnvelopeError)) throw error;
        close();
        handlers.onTrouble("bad-data", error.message);
      }
    });
  }
  source.addEventListener("open", () => {
    if (open) handlers.onOpen();
  });
  source.addEventListener("end", (message) => {
    if (!open) return;
    close();
    handlers.onEnd(endReason(message.data));
  });
  source.addEventListener("error", () => {
    if (!open) return;
    if (source.readyState === CLOSED) {
      close();
      handlers.onTrouble("lost", "Nie mozna polaczyc sie z rozprawa: nie istnieje, zostala zapomniana albo serwer nie odpowiada.");
    } else {
      handlers.onTrouble("reconnecting", "Polaczenie zerwane, wznawiam...");
    }
  });
  return close;
}

function endReason(data: string): "finished" | "interrupted" {
  try {
    return (JSON.parse(data) as { reason?: unknown }).reason === "finished" ? "finished" : "interrupted";
  } catch {
    return "interrupted";
  }
}
