import type { CallRecord } from "@trybunal/court";

/**
 * Surowy zapis dziennika: rozprawy z kluczem i zaszyfrowane zdarzenia. Store nie zna tresci zdarzen
 * ani kluczy w postaci jawnej — to robota dziennika (journal.ts). Dwie implementacje z jednym
 * zestawem testow kontraktu: w pamieci (testy, demo) i Postgres.
 */
export interface StoredRecord {
  readonly trialId: string;
  /** Numer zdarzenia w rozprawie od 1, bez dziur. Para (trialId, seq) jest unikalna. */
  readonly seq: number;
  readonly type: string;
  readonly occurredAt: Date;
  readonly schemaVersion: number;
  /** Zaszyfrowana tresc zdarzenia. */
  readonly payload: Buffer;
  /** Jawne metadane: proby zapytan (model, tokeny, koszt) — bez tresci CV. */
  readonly calls: readonly CallRecord[];
}

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}

export interface EventStore {
  /** Nowa rozprawa z zaszyfrowanym kluczem danych; ConflictError, gdy id juz jest. */
  createTrial(trialId: string, wrappedKey: Buffer, createdAt: Date): Promise<void>;
  /** ConflictError, gdy rozprawy nie ma albo numer nie jest kolejnym (dwa zapisy naraz, dziura). */
  append(record: StoredRecord): Promise<void>;
  /** Zdarzenia o numerach wiekszych niz afterSeq, rosnaco. Pusta lista, gdy rozprawy nie ma. */
  read(trialId: string, afterSeq: number): Promise<StoredRecord[]>;
  /** undefined: nie ma takiej rozprawy; null: klucz usuniety (rozprawa zapomniana). */
  wrappedKey(trialId: string): Promise<Buffer | null | undefined>;
  /** Usuwa klucz rozprawy; false, gdy rozprawy nie ma. */
  forget(trialId: string): Promise<boolean>;
  /** Suma znanych kosztow zapytan zdarzen od danej chwili — do dziennego budzetu. */
  spentSince(since: Date): Promise<number>;
}

interface MemoryTrial {
  wrappedKey: Buffer | null;
  readonly events: StoredRecord[];
}

export class InMemoryEventStore implements EventStore {
  private readonly trials = new Map<string, MemoryTrial>();

  createTrial(trialId: string, wrappedKey: Buffer): Promise<void> {
    if (this.trials.has(trialId)) {
      return Promise.reject(new ConflictError(`Rozprawa ${trialId} juz istnieje`));
    }
    this.trials.set(trialId, { wrappedKey: Buffer.from(wrappedKey), events: [] });
    return Promise.resolve();
  }

  append(record: StoredRecord): Promise<void> {
    const trial = this.trials.get(record.trialId);
    if (trial === undefined) {
      return Promise.reject(new ConflictError(`Nie ma rozprawy ${record.trialId}`));
    }
    if (record.seq !== trial.events.length + 1) {
      return Promise.reject(new ConflictError(`Zdarzenie ${String(record.seq)} nie jest kolejnym w rozprawie ${record.trialId}`));
    }
    trial.events.push({ ...record, payload: Buffer.from(record.payload) });
    return Promise.resolve();
  }

  read(trialId: string, afterSeq: number): Promise<StoredRecord[]> {
    return Promise.resolve((this.trials.get(trialId)?.events ?? []).filter((e) => e.seq > afterSeq));
  }

  wrappedKey(trialId: string): Promise<Buffer | null | undefined> {
    return Promise.resolve(this.trials.get(trialId)?.wrappedKey);
  }

  forget(trialId: string): Promise<boolean> {
    const trial = this.trials.get(trialId);
    if (trial !== undefined) {
      trial.wrappedKey = null;
    }
    return Promise.resolve(trial !== undefined);
  }

  spentSince(since: Date): Promise<number> {
    const events = [...this.trials.values()].flatMap((t) => t.events).filter((e) => e.occurredAt >= since);
    return Promise.resolve(events.flatMap((e) => e.calls).reduce((sum, c) => sum + c.costNanoUsd, 0));
  }
}
