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

/** Przerwy przed ponownym otwarciem strumienia zamknietego przez przegladarke (np. 502 przy restarcie). */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
const RECONNECTING = "Połączenie zerwane, wznawiam…";

/**
 * Otwiera strumien; zwraca funkcje zamykajaca (do sprzatania w efekcie Reacta). Nowe EventSource
 * nie wysyla Last-Event-ID, wiec po ponownym otwarciu numer ostatniego zdarzenia idzie w ?after=.
 */
export function openTrialStream(url: string, handlers: StreamHandlers, factory: EventSourceFactory): () => void {
  let open = true;
  let lastSeq: number | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: EventSourceLike;
  const close = () => {
    open = false;
    clearTimeout(timer);
    source.close();
  };

  const connect = () => {
    const current = factory(lastSeq === null ? url : `${url}${url.includes("?") ? "&" : "?"}after=${String(lastSeq)}`);
    source = current;
    const listen = (type: string, listener: (message: MessageEvent<string>) => void) => {
      current.addEventListener(type, (message) => {
        if (open && source === current) listener(message);
      });
    };
    for (const type of Object.keys(EVENT_TYPES)) {
      listen(type, (message) => {
        let envelope: Envelope;
        try {
          envelope = parseEnvelope(message.data);
        } catch (error) {
          if (!(error instanceof BadEnvelopeError)) throw error;
          close();
          handlers.onTrouble("bad-data", error.message);
          return;
        }
        lastSeq = envelope.seq;
        handlers.onEnvelope(envelope);
      });
    }
    listen("open", () => {
      failures = 0;
      handlers.onOpen();
    });
    listen("end", (message) => {
      close();
      handlers.onEnd(endReason(message.data));
    });
    listen("error", () => {
      if (current.readyState !== CLOSED) {
        handlers.onTrouble("reconnecting", RECONNECTING);
        return;
      }
      const delay = RETRY_DELAYS_MS[failures];
      if (delay === undefined) {
        close();
        handlers.onTrouble("lost", "Nie można połączyć się z rozprawą: nie istnieje, została zapomniana albo serwer nie odpowiada.");
        return;
      }
      failures++;
      handlers.onTrouble("reconnecting", RECONNECTING);
      timer = setTimeout(connect, delay);
    });
  };
  connect();
  return close;
}

function endReason(data: string): "finished" | "interrupted" {
  try {
    return (JSON.parse(data) as { reason?: unknown }).reason === "finished" ? "finished" : "interrupted";
  } catch {
    return "interrupted";
  }
}
