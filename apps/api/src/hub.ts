import type { EventEnvelope } from "./journal.js";

interface Listener {
  readonly onEvent: (envelope: EventEnvelope) => void;
  readonly onStop: () => void;
}

/**
 * Rozglasza zapisane zdarzenia do otwartych strumieni SSE w tej instancji. Zdarzenie trafia tu
 * dopiero po zapisie w dzienniku, wiec klient, ktory sie spozni, doczyta je z bazy.
 * stop(): rozprawa przestala trwac — strumien, ktory nie dostal werdyktu ani przerwania
 * (bo ich zapis sie nie udal), nie moze czekac w nieskonczonosc.
 * Przy kilku instancjach API ten sam interfejs obsluzylby Postgres LISTEN/NOTIFY.
 */
export class TrialHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Blad jednego sluchacza nie dociera do rozprawy ani do pozostalych sluchaczy. */
  constructor(private readonly onListenerError: (error: unknown) => void = () => undefined) {}

  subscribe(trialId: string, onEvent: Listener["onEvent"], onStop: Listener["onStop"] = () => undefined): () => void {
    const listener = { onEvent, onStop };
    const set = this.listeners.get(trialId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(trialId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(trialId);
    };
  }

  publish(envelope: EventEnvelope): void {
    this.each(envelope.trialId, (l) => {
      l.onEvent(envelope);
    });
  }

  stop(trialId: string): void {
    this.each(trialId, (l) => {
      l.onStop();
    });
  }

  /** Ile rozpraw ma sluchaczy — do testow sprzatania (brak wycieku pamieci). */
  get activeTrials(): number {
    return this.listeners.size;
  }

  /** Ilu sluchaczy ma rozprawa — do testow sprzatania po rozlaczeniu. */
  listenerCount(trialId: string): number {
    return this.listeners.get(trialId)?.size ?? 0;
  }

  private each(trialId: string, call: (listener: Listener) => void): void {
    // Kopia: sluchacz moze sie wypisac w trakcie rozglaszania.
    for (const listener of [...(this.listeners.get(trialId) ?? [])]) {
      try {
        call(listener);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
