import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, MIGRATIONS, PostgresEventStore } from "./postgres.js";
import { describeEventStore } from "./store.contract.js";
import { ConflictError } from "./store.js";

// Prawdziwy Postgres w kontenerze (Docker). Kazdy test kontraktu dostaje czysta baze.
let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describeEventStore("Postgres", async () => {
  await pool.query("TRUNCATE trial_events, trials");
  return new PostgresEventStore(pool);
});

describe("Postgres — migracje i wspolbieznosc", () => {
  it("migracje wykonuja sie raz, takze gdy kilka instancji startuje naraz", async () => {
    await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
    const { rows } = await pool.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it("dwa zapisy tego samego numeru naraz: dokladnie jeden wygrywa", async () => {
    await pool.query("TRUNCATE trial_events, trials");
    const store = new PostgresEventStore(pool);
    await store.createTrial("t", Buffer.from("k"), new Date());
    const record = (payload: number) => ({
      trialId: "t", seq: 1, type: "TrialFiled", occurredAt: new Date(), schemaVersion: 1, payload: Buffer.from([payload]), calls: [],
    });
    const results = await Promise.allSettled([1, 2, 3, 4].map((p) => store.append(record(p))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    }
    expect(await store.read("t", 0)).toHaveLength(1);
  });

  it("inny blad bazy nie udaje konfliktu", async () => {
    const broken = new pg.Pool({ connectionString: container.getConnectionUri().replace(/\/[^/]+$/, "/brak_bazy") });
    const store = new PostgresEventStore(broken);
    await expect(store.createTrial("t", Buffer.from("k"), new Date())).rejects.not.toBeInstanceOf(ConflictError);
    const record = { trialId: "t", seq: 1, type: "TrialFiled", occurredAt: new Date(), schemaVersion: 1, payload: Buffer.from([1]), calls: [] };
    await expect(store.append(record)).rejects.not.toBeInstanceOf(ConflictError);
    await broken.end();
  });

  it("nieudana migracja jest wycofana w calosci i nie jest zapisana jako wykonana", async () => {
    const failing = [...MIGRATIONS, "CREATE TABLE polowiczna (id int); SELECT * FROM nie_ma_takiej_tabeli;"];
    await expect(migrate(pool, failing)).rejects.toThrow(/nie_ma_takiej_tabeli/);
    const { rows } = await pool.query("SELECT to_regclass('polowiczna') AS t, (SELECT max(version) FROM schema_migrations) AS v");
    expect(rows[0]).toEqual({ t: null, v: MIGRATIONS.length });
    // Blokada zwolniona mimo bledu: kolejna migracja nie wisi.
    await migrate(pool);
  });
});
