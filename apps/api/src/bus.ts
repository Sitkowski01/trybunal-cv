import type { TrialHub } from "./hub.js";
import type { EventEnvelope } from "./journal.js";

/**
 * Co rozprawa mowi reszcie serwera: zdarzenie zapisane w dzienniku, rozprawa skonczona, prosba
 * o anulowanie. W jednej instancji API to wywolania w procesie (LocalBus); przy kilku instancjach
 * Postgres NOTIFY (PostgresBus) — klient moze miec strumien SSE na innej instancji niz ta, ktora
 * prowadzi rozprawe, a „Przerwij” moze trafic jeszcze gdzie indziej.
 */
export interface TrialBus {
  /** Zdarzenie zapisane w dzienniku — do strumieni SSE wszystkich instancji. */
  published(envelope: EventEnvelope): void;
  /** Rozprawa przestala trwac — strumienie bez werdyktu ani przerwania nie czekaja w nieskonczonosc. */
  stopped(trialId: string): void;
  /** Prosba o anulowanie — dociera do instancji, ktora prowadzi rozprawe. */
  cancelRequested(trialId: string): void;
  /** Instancja zglasza, jak anuluje swoje rozprawy (TrialService przy starcie). */
  onCancel(handler: (trialId: string) => void): void;
}

/** Jedna instancja: komunikaty prosto do strumieni tej instancji i do jej rozpraw. */
export class LocalBus implements TrialBus {
  private cancel: (trialId: string) => void = () => undefined;

  constructor(private readonly hub: TrialHub) {}

  published(envelope: EventEnvelope): void {
    this.hub.publish(envelope);
  }

  stopped(trialId: string): void {
    this.hub.stop(trialId);
  }

  cancelRequested(trialId: string): void {
    this.cancel(trialId);
  }

  onCancel(handler: (trialId: string) => void): void {
    this.cancel = handler;
  }
}
