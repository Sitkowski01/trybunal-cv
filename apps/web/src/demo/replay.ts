import { ApiError, type TrialApi } from "../api/client.js";
import { CLOSED, type EventSourceFactory, type EventSourceLike } from "../api/stream.js";
import { FIRST_EVENT_MS, pauseAfter } from "./pace.js";
import type { Recording } from "./recording.js";

/**
 * Demo bez serwera: zamiast fetch i EventSource ten sam interfejs (TrialApi, EventSourceFactory)
 * odtwarza nagranie. Reszta aplikacji — stan sali, scena 3D, raport — nie wie, ze serwera nie ma,
 * a zdarzenia przechodza przez te same schematy co na zywo.
 */
export const DEMO_TRIAL_ID = "nagranie";
const SCHEME = "nagranie:";
const OPEN = 1;
/** Ten sam powod, ktory zapisuje rozprawa anulowana na serwerze. */
const CANCELLED = "Rozprawa anulowana";
const FINISHED = JSON.stringify({ reason: "finished" });

export interface Replay {
  readonly api: TrialApi;
  readonly sources: EventSourceFactory;
}

class ReplaySource implements EventSourceLike {
  readyState = 0;
  /** Numer ostatniego wyslanego zdarzenia — przerwanie dostaje nastepny. */
  lastSeq = 0;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly onClose: (source: ReplaySource) => void) {}

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.stop();
    this.readyState = CLOSED;
    this.onClose(this);
  }

  /** Zatrzymuje zaplanowane zdarzenia (zamkniecie albo przerwanie rozprawy). */
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  later(ms: number, action: () => void) {
    this.timers.push(setTimeout(action, ms));
  }

  emit(type: string, data = "") {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }

  finish() {
    this.emit("end", FINISHED);
  }
}

export function createReplay(recording: Recording, speed = 1): Replay {
  /** Trwajace odtworzenia — przerwanie rozprawy trafia do kazdego z nich. */
  const live = new Set<ReplaySource>();

  const sources: EventSourceFactory = (url) => {
    const source = new ReplaySource((closed) => live.delete(closed));
    if (url !== `${SCHEME}${DEMO_TRIAL_ID}`) {
      // Jak serwer dla nieznanej rozprawy: odmowa i koniec, bez wznawiania.
      source.later(0, () => {
        source.readyState = CLOSED;
        source.emit("error");
      });
      return source;
    }
    live.add(source);
    source.later(0, () => {
      source.readyState = OPEN;
      source.emit("open");
    });
    // Tempo 2 = dwa razy szybciej: kazda przerwa dzielona przez tempo.
    let at = FIRST_EVENT_MS;
    recording.events.forEach((recorded, index) => {
      source.later(at / speed, () => {
        source.lastSeq = recorded.envelope.seq;
        source.emit(recorded.envelope.event.type, recorded.data);
        if (index === recording.events.length - 1) {
          live.delete(source);
          source.finish();
        }
      });
      at += pauseAfter(recorded.envelope.event);
    });
    return source;
  };

  const api: TrialApi = {
    file: () => Promise.reject(new ApiError(0, "Demo nie ma serwera — odtwarza nagraną rozprawę.")),
    cancel: (trialId) => {
      const running = trialId === DEMO_TRIAL_ID ? [...live] : [];
      if (running.length === 0) return Promise.reject(new ApiError(409, "Rozprawa nie trwa"));
      for (const source of running) {
        live.delete(source);
        source.stop();
        source.later(0, () => {
          const envelope = { seq: source.lastSeq + 1, occurredAt: new Date().toISOString(), event: { type: "TrialAborted", reason: CANCELLED }, calls: [] };
          source.emit("TrialAborted", JSON.stringify(envelope));
          source.finish();
        });
      }
      return Promise.resolve();
    },
    // Nagranie nie ma klucza do usuniecia; widok i tak pokazuje rozprawe jako zapomniana.
    forget: () => Promise.resolve(),
    eventsUrl: (trialId) => `${SCHEME}${trialId}`,
  };
  return { api, sources };
}

/** Tempo z adresu (?tempo=4) — szybki podglad i testy e2e; poza zakresem 1–50 zwykle tempo. */
export function speedFromSearch(search: string): number {
  const speed = Number(new URLSearchParams(search).get("tempo"));
  return Number.isFinite(speed) && speed >= 1 && speed <= 50 ? speed : 1;
}
