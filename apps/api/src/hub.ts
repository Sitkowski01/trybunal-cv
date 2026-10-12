import type { EventEnvelope } from "./journal.js";

type Listener = (envelope: EventEnvelope) => void;

/**
 * Rozglasza zapisane zdarzenia do otwartych strumieni SSE w tej instancji. Zdarzenie trafia tu
 * dopiero po zapisie w dzienniku, wiec klient, ktory sie spozni, doczyta je z bazy.
 * Przy kilku instancjach API ten sam interfejs obsluzylby Postgres LISTEN/NOTIFY.
 */
export class TrialHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(trialId: string, listener: Listener): () => void {
    const set = this.listeners.get(trialId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(trialId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(trialId);
    };
  }

  publish(envelope: EventEnvelope): void {
    for (const listener of [...(this.listeners.get(envelope.trialId) ?? [])]) {
      listener(envelope);
    }
  }

  /** Ilu sluchaczy ma rozprawa — do testow sprzatania po rozlaczeniu. */
  listenerCount(trialId: string): number {
    return this.listeners.get(trialId)?.size ?? 0;
  }
}
