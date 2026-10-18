import type { CallRecord } from "@trybunal/court";
import pg from "pg";
import { ConflictError, type EventStore, type StoredRecord } from "./store.js";

/**
 * Migracje po kolei, kazda raz. Blokada doradcza: dwie instancje API startujace naraz
 * nie wykonaja tej samej migracji dwa razy.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE trials (
     trial_id text PRIMARY KEY,
     created_at timestamptz NOT NULL,
     wrapped_key bytea -- NULL: rozprawa zapomniana (RODO), zdarzenia nie do odczytania
   );
   CREATE TABLE trial_events (
     trial_id text NOT NULL REFERENCES trials (trial_id),
     seq integer NOT NULL CHECK (seq >= 1),
     type text NOT NULL,
     occurred_at timestamptz NOT NULL,
     schema_version integer NOT NULL,
     payload bytea NOT NULL,
     calls jsonb NOT NULL,
     PRIMARY KEY (trial_id, seq)
   );
   CREATE INDEX trial_events_occurred_at ON trial_events (occurred_at);`,
  // Koniec i puls rozprawy w bazie: przy kilku instancjach API kazda wie, czy rozprawa jeszcze trwa.
  // Indeks po dacie zalozenia: retencja kluczy szuka starych rozpraw.
  `ALTER TABLE trials ADD COLUMN ended_at timestamptz, ADD COLUMN alive_at timestamptz;
   CREATE INDEX trials_created_at ON trials (created_at);`,
];

const MIGRATION_LOCK = 7_211_001;

export async function migrate(pool: pg.Pool, migrations: readonly string[] = MIGRATIONS): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL)");
    const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    for (const [index, sql] of migrations.entries()) {
      const version = index + 1;
      if (applied.has(version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    client.release();
  }
}

interface EventRow {
  trial_id: string;
  seq: number;
  type: string;
  occurred_at: Date;
  schema_version: number;
  payload: Buffer;
  calls: CallRecord[];
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const sqlState = (error: unknown) => (error as { code?: unknown }).code;

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: pg.Pool) {}

  async createTrial(trialId: string, wrappedKey: Buffer, createdAt: Date): Promise<void> {
    try {
      await this.pool.query("INSERT INTO trials (trial_id, created_at, wrapped_key) VALUES ($1, $2, $3)", [trialId, createdAt, wrappedKey]);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) throw new ConflictError("Rozprawa juz istnieje");
      throw error;
    }
  }

  async append(record: StoredRecord): Promise<void> {
    // Kolejny numer sprawdzony w tym samym zapytaniu: dziura (seq za duzy) nic nie wstawi,
    // a dwa zapisy tego samego numeru naraz zatrzyma klucz glowny.
    let inserted;
    try {
      inserted = await this.pool.query(
        `INSERT INTO trial_events (trial_id, seq, type, occurred_at, schema_version, payload, calls)
         SELECT $1::text, $2::integer, $3, $4, $5, $6, $7
         WHERE $2::integer = 1 + (SELECT count(*) FROM trial_events WHERE trial_id = $1::text)`,
        [record.trialId, record.seq, record.type, record.occurredAt, record.schemaVersion, record.payload, JSON.stringify(record.calls)],
      );
    } catch (error) {
      const state = sqlState(error);
      if (state === UNIQUE_VIOLATION || state === FOREIGN_KEY_VIOLATION) {
        throw new ConflictError(`Zdarzenie ${String(record.seq)} odrzucone`);
      }
      throw error;
    }
    if (inserted.rowCount !== 1) {
      throw new ConflictError(`Zdarzenie ${String(record.seq)} nie jest kolejnym w rozprawie`);
    }
  }

  async read(trialId: string, afterSeq: number): Promise<StoredRecord[]> {
    const { rows } = await this.pool.query<EventRow>(
      "SELECT * FROM trial_events WHERE trial_id = $1 AND seq > $2 ORDER BY seq",
      [trialId, afterSeq],
    );
    return rows.map((r) => ({
      trialId: r.trial_id,
      seq: r.seq,
      type: r.type,
      occurredAt: r.occurred_at,
      schemaVersion: r.schema_version,
      payload: r.payload,
      calls: r.calls,
    }));
  }

  async wrappedKey(trialId: string): Promise<Buffer | null | undefined> {
    const { rows } = await this.pool.query<{ wrapped_key: Buffer | null }>("SELECT wrapped_key FROM trials WHERE trial_id = $1", [trialId]);
    return rows[0]?.wrapped_key;
  }

  async forget(trialId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE trials SET wrapped_key = NULL WHERE trial_id = $1", [trialId]);
    return result.rowCount === 1;
  }

  async spentSince(since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>(
      `SELECT coalesce(sum((c ->> 'costNanoUsd')::bigint), 0) AS total
       FROM trial_events, jsonb_array_elements(calls) AS c WHERE occurred_at >= $1`,
      [since],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async markEnded(trialId: string, endedAt: Date): Promise<void> {
    await this.pool.query("UPDATE trials SET ended_at = $2 WHERE trial_id = $1", [trialId, endedAt]);
  }

  async touch(trialIds: readonly string[], at: Date): Promise<void> {
    await this.pool.query("UPDATE trials SET alive_at = $2 WHERE trial_id = ANY($1::text[])", [trialIds, at]);
  }

  async isActive(trialId: string, aliveSince: Date): Promise<boolean> {
    // Bez pulsu (rozprawa dopiero zalozona) liczy sie chwila zalozenia.
    const { rows } = await this.pool.query(
      "SELECT 1 FROM trials WHERE trial_id = $1 AND ended_at IS NULL AND coalesce(alive_at, created_at) > $2",
      [trialId, aliveSince],
    );
    return rows.length === 1;
  }

  async expireKeys(before: Date): Promise<number> {
    const result = await this.pool.query("UPDATE trials SET wrapped_key = NULL WHERE created_at < $1 AND wrapped_key IS NOT NULL", [before]);
    return result.rowCount ?? 0;
  }
}
