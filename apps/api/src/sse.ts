import type { IncomingMessage, ServerResponse } from "node:http";
import { toPublicEvent } from "@trybunal/domain";
import type { TrialHub } from "./hub.js";
import type { EventEnvelope, Journal } from "./journal.js";

/** Zdarzenia, po ktorych rozprawa juz nic nie powie. */
const TERMINAL = new Set(["VerdictAnnounced", "TrialAborted"]);

/** Zdarzenie do wyslania: wniesienie bez tekstu CV i oferty (zob. toPublicEvent w domenie). */
export function publicEvent(envelope: EventEnvelope) {
  return envelope.event.type === "TrialFiled" ? { ...envelope, event: toPublicEvent(envelope.event) } : envelope;
}

/** Jedno zdarzenie SSE: id = numer zdarzenia, zeby przegladarka wznowila od niego (Last-Event-ID). */
export function formatEvent(envelope: EventEnvelope): string {
  return `id: ${String(envelope.seq)}\nevent: ${envelope.event.type}\ndata: ${JSON.stringify(publicEvent(envelope))}\n\n`;
}

/**
 * Konczy strumien jawnym zdarzeniem "end". Samo zamkniecie polaczenia EventSource potraktowalby
 * jak awarie i laczyl sie ponownie w nieskonczonosc. "interrupted": rozprawa nie trwa, a nie ma
 * werdyktu ani przerwania (np. restart serwera w trakcie) — nic juz nie przyjdzie.
 */
export const formatEnd = (reason: "finished" | "interrupted") => `event: end\ndata: ${JSON.stringify({ reason })}\n\n`;

export interface StreamDeps {
  readonly journal: Journal;
  readonly hub: TrialHub;
  /** Czy rozprawa trwa — w tej albo innej instancji API. */
  readonly isRunning: (trialId: string) => Promise<boolean>;
  readonly heartbeatMs: number;
}

/**
 * Strumien zdarzen rozprawy od numeru afterSeq: najpierw zapisane w dzienniku, potem na zywo.
 * Subskrypcja przed odczytem z bazy, a duplikaty odsiane po numerze — zadne zdarzenie nie
 * przepadnie w szczelinie miedzy odczytem a subskrypcja. Bledy odczytu (404, 410) rzucane
 * zanim cokolwiek zostanie wyslane, zeby trafily do zwyklej obslugi bledow HTTP.
 */
export async function openStream(trialId: string, afterSeq: number, deps: StreamDeps) {
  const buffered: EventEnvelope[] = [];
  let deliver: ((e: EventEnvelope) => void) | null = null;
  // Koniec rozprawy przed podlaczeniem klienta zapamietany: wylapie go sprawdzenie po nadrobieniu zaleglosci.
  let stopped: (() => void) | null = null;
  let stoppedEarly = false;
  const unsubscribe = deps.hub.subscribe(
    trialId,
    (e) => {
      if (deliver === null) buffered.push(e);
      else deliver(e);
    },
    () => {
      if (stopped === null) stoppedEarly = true;
      else stopped();
    },
  );
  let stored: EventEnvelope[];
  let running: boolean;
  try {
    stored = await deps.journal.read(trialId, afterSeq);
    running = await deps.isRunning(trialId);
  } catch (error) {
    unsubscribe();
    throw error;
  }

  return (request: IncomingMessage, response: ServerResponse) => {
    // Klient mogl odejsc w trakcie odczytu z bazy — wtedy zdarzenie "close" juz bylo.
    if (request.destroyed || response.destroyed) {
      unsubscribe();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Proxy (nginx) nie moze buforowac strumienia.
      "x-accel-buffering": "no",
    });
    // Obiekt, a nie zmienne: stan zmieniaja wywolania zwrotne, czego analiza przeplywu TS nie widzi.
    const progress = { last: afterSeq, ended: false };
    const heartbeat = setInterval(() => response.write(": ping\n\n"), deps.heartbeatMs);
    const finish = (reason?: "finished" | "interrupted") => {
      if (progress.ended) return;
      progress.ended = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (reason !== undefined) response.end(formatEnd(reason));
    };
    // Rozlaczenie klienta tylko sprzata — rozprawa trwa dalej, mozna do niej wrocic.
    response.on("close", () => {
      finish();
    });
    const send = (e: EventEnvelope) => {
      if (progress.ended || e.seq <= progress.last) return;
      progress.last = e.seq;
      response.write(formatEvent(e));
      if (TERMINAL.has(e.event.type)) finish("finished");
    };
    stored.forEach(send);
    buffered.forEach(send);
    deliver = send;
    stopped = () => {
      finish("interrupted");
    };
    if (!progress.ended && (stoppedEarly || !running)) finish("interrupted");
  };
}
