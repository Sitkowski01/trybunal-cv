import type { CallRecord } from "@trybunal/court";
import { type TrialEvent, TrialEventSchema } from "@trybunal/domain";
import { newKey, open, seal } from "./crypto.js";
import type { EventStore } from "./store.js";

/** Wersja ksztaltu zdarzen w dzienniku. Zmiana schematu = nowa wersja + przeksztalcenie starych przy odczycie. */
export const SCHEMA_VERSION = 1;

/**
 * Puls: instancja prowadzaca rozprawe potwierdza co tyle, ze rozprawa trwa. Bez pulsu przez
 * ALIVE_MS (trzy pominiete) instancja padla albo zostala zrestartowana — nikt rozprawy nie dokonczy.
 */
export const HEARTBEAT_MS = 15_000;
export const ALIVE_MS = 3 * HEARTBEAT_MS;
const DAY_MS = 24 * 60 * 60_000;

/** Koperta zdarzenia: to wysyla SSE i to odtwarza powtorka. */
export interface EventEnvelope {
  readonly trialId: string;
  readonly seq: number;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly event: TrialEvent;
  readonly calls: readonly CallRecord[];
}

export class TrialNotFoundError extends Error {
  override readonly name = "TrialNotFoundError";
}

/** Rozprawa zapomniana na zadanie kandydata: zdarzenia sa, ale klucza juz nie ma. */
export class TrialForgottenError extends Error {
  override readonly name = "TrialForgottenError";
}

/**
 * Dziennik rozpraw: koperty, szyfrowanie tresci kluczem rozprawy i sprawdzanie schematem przy odczycie
 * (baza to tez wejscie z zewnatrz). Klucz rozprawy czytany z bazy przy kazdej operacji, bez pamieci
 * podrecznej: zapomnienie dziala od razu, rowniez w innych instancjach API.
 */
export class Journal {
  constructor(
    private readonly store: EventStore,
    private readonly masterKey: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(trialId: string): Promise<void> {
    await this.store.createTrial(trialId, seal(this.masterKey, newKey(), `key:${trialId}`), this.now());
  }

  async append(trialId: string, seq: number, event: TrialEvent, calls: readonly CallRecord[]): Promise<EventEnvelope> {
    const key = await this.key(trialId);
    const envelope: EventEnvelope = { trialId, seq, occurredAt: this.now().toISOString(), schemaVersion: SCHEMA_VERSION, event, calls };
    await this.store.append({
      trialId,
      seq,
      type: event.type,
      occurredAt: new Date(envelope.occurredAt),
      schemaVersion: SCHEMA_VERSION,
      payload: seal(key, Buffer.from(JSON.stringify(event), "utf8"), `${trialId}:${String(seq)}`),
      calls,
    });
    return envelope;
  }

  async read(trialId: string, afterSeq = 0): Promise<EventEnvelope[]> {
    const key = await this.key(trialId);
    const records = await this.store.read(trialId, afterSeq);
    return records.map((r) => {
      if (r.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`Nieznana wersja schematu zdarzenia: ${String(r.schemaVersion)}`);
      }
      const json: unknown = JSON.parse(open(key, r.payload, `${trialId}:${String(r.seq)}`).toString("utf8"));
      return {
        trialId,
        seq: r.seq,
        occurredAt: r.occurredAt.toISOString(),
        schemaVersion: r.schemaVersion,
        event: TrialEventSchema.parse(json),
        calls: r.calls,
      };
    });
  }

  /** TrialNotFoundError / TrialForgottenError, gdy rozprawy nie da sie odczytac. */
  async assertReadable(trialId: string): Promise<void> {
    await this.key(trialId);
  }

  /** Usuwa klucz rozprawy (RODO). false, gdy rozprawy nie ma. */
  forget(trialId: string): Promise<boolean> {
    return this.store.forget(trialId);
  }

  spentSince(since: Date): Promise<number> {
    return this.store.spentSince(since);
  }

  /** Rozprawa przestala trwac — zapis w bazie, zeby wiedzialy o tym inne instancje API. */
  markEnded(trialId: string): Promise<void> {
    return this.store.markEnded(trialId, this.now());
  }

  /** Puls rozpraw tej instancji — zob. HEARTBEAT_MS. */
  touch(trialIds: readonly string[]): Promise<void> {
    return this.store.touch(trialIds, this.now());
  }

  /** Czy rozprawa trwa (w tej albo innej instancji): bez konca i z pulsem z ostatnich ALIVE_MS. */
  isActive(trialId: string): Promise<boolean> {
    return this.store.isActive(trialId, new Date(this.now().getTime() - ALIVE_MS));
  }

  /** Retencja: usuwa klucze rozpraw starszych niz podana liczba dni; zwraca, ile usunieto. */
  expireOlderThan(days: number): Promise<number> {
    return this.store.expireKeys(new Date(this.now().getTime() - days * DAY_MS));
  }

  private async key(trialId: string): Promise<Buffer> {
    const wrapped = await this.store.wrappedKey(trialId);
    if (wrapped === undefined) {
      throw new TrialNotFoundError("Nie ma takiej rozprawy");
    }
    if (wrapped === null) {
      throw new TrialForgottenError("Rozprawa zostala zapomniana na zadanie kandydata");
    }
    return open(this.masterKey, wrapped, `key:${trialId}`);
  }
}
