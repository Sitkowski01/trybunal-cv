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
 * "Trwa" sprawdzane przed odczytem: rozprawa konczy sie zapisem werdyktu, a dopiero potem znacznika
 * konca, wiec gdy juz nie trwa, odczyt widzi werdykt.
 * Na zywo: zdarzenie z numerem wiekszym niz nastepny oznacza zgubione powiadomienie (np. LISTEN
 * w trakcie ponownego laczenia) — brakujace doczytujemy z dziennika. Przy kazdym pulsie strumien
 * sprawdza, czy rozprawa trwa: instancja, ktora ja prowadzila, mogla pasc bez slowa.
 * Blad bazy w trakcie zamyka polaczenie bez "end" — przegladarka wznowi od Last-Event-ID.
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
    running = await deps.isRunning(trialId);
    stored = await deps.journal.read(trialId, afterSeq);
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
    // Kroki wymagajace bazy ida po kolei; zdarzenia na zywo czekaja za nimi, zeby nie wyprzedzic doczytanych.
    let queue: Promise<void> | null = null;
    const later = (step: () => void | Promise<void>) => {
      const next = (queue ?? Promise.resolve()).then(step).catch(() => {
        finish();
        response.end();
      });
      queue = next;
      void next.then(() => {
        if (queue === next) queue = null;
      });
    };
    const catchUp = async () => {
      if (!progress.ended) (await deps.journal.read(trialId, progress.last)).forEach(send);
    };
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
      later(async () => {
        if (progress.ended || (await deps.isRunning(trialId))) return;
        await catchUp();
        finish("interrupted");
      });
    }, deps.heartbeatMs);
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
    const live = (e: EventEnvelope) => {
      if (queue !== null) {
        later(() => { send(e); });
      } else if (e.seq > progress.last + 1) {
        later(async () => {
          await catchUp();
          send(e);
        });
      } else {
        send(e);
      }
    };
    stored.forEach(send);
    buffered.forEach(live);
    deliver = live;
    stopped = () => {
      if (queue === null) finish("interrupted");
      else later(() => { finish("interrupted"); });
    };
    if (!progress.ended && (stoppedEarly || !running)) stopped();
  };
}
