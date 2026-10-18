import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TrialEvent } from "@trybunal/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { type EventEnvelope, Journal } from "./journal.js";
import { CHANNEL, PostgresBus } from "./pgbus.js";
import { migrate, PostgresEventStore } from "./postgres.js";

// Dwie instancje API (osobne pule i magistrale) na jednej bazie w kontenerze: rozprawa prowadzona
// w A, strumien SSE i „Przerwij” w B.
let container: StartedPostgreSqlContainer;
const pools: pg.Pool[] = [];
const masterKey = newKey();

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pools.push(pool);
  await migrate(pool);
}, 120_000);

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await container.stop();
}, 60_000);

async function instance() {
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pools.push(pool);
  const journal = new Journal(new PostgresEventStore(pool), masterKey);
  const hub = new TrialHub();
  const errors: unknown[] = [];
  const bus = new PostgresBus({ pool, journal, hub, onError: (e) => errors.push(e), reconnectMs: 50 });
  await bus.start();
  return { pool, journal, hub, bus, errors };
}

const filed = (trialId: string): TrialEvent => ({ type: "TrialFiled", trialId, cvText: "Java", jobOffer: "Junior Java", debateRounds: 0 });
const speech: TrialEvent = { type: "ProsecutionDelivered", speech: "Odrzucic" };

describe("PostgresBus — kilka instancji", () => {
  it("zdarzenie zapisane w A trafia do strumieni A i B: raz, po kolei, odszyfrowane z dziennika", async () => {
    const a = await instance();
    const b = await instance();
    const heardA: EventEnvelope[] = [];
    const heardB: EventEnvelope[] = [];
    a.hub.subscribe("t-1", (e) => heardA.push(e));
    b.hub.subscribe("t-1", (e) => heardB.push(e));
    await a.journal.create("t-1");
    const first = await a.journal.append("t-1", 1, filed("t-1"), []);
    a.bus.published(first);
    const second = await a.journal.append("t-1", 2, speech, []);
    a.bus.published(second);
    await expect.poll(() => heardB.map((e) => e.seq)).toEqual([1, 2]);
    await expect.poll(() => heardA.map((e) => e.seq)).toEqual([1, 2]);
    expect(heardB[1]?.event).toEqual(speech);
    expect([...a.errors, ...b.errors]).toEqual([]);
    await Promise.all([a.bus.close(), b.bus.close()]);
  });

  it("koniec rozprawy i prosba o anulowanie przechodza miedzy instancjami", async () => {
    const a = await instance();
    const b = await instance();
    const stops: string[] = [];
    b.hub.subscribe("t-2", () => undefined, () => stops.push("t-2"));
    const cancelled: string[] = [];
    a.bus.onCancel((trialId) => cancelled.push(trialId));
    b.bus.cancelRequested("t-2");
    await expect.poll(() => cancelled).toEqual(["t-2"]);
    a.bus.stopped("t-2");
    await expect.poll(() => stops).toEqual(["t-2"]);
    await Promise.all([a.bus.close(), b.bus.close()]);
  });

  it("instancja bez sluchaczy rozprawy nie czyta dziennika; zly komunikat to blad w logach, a nie koniec magistrali", async () => {
    const a = await instance();
    const b = await instance();
    let reads = 0;
    const read = b.journal.read.bind(b.journal);
    b.journal.read = (...args) => {
      reads++;
      return read(...args);
    };
    // Znacznik: B przetwarza komunikaty po kolei, wiec gdy dotarla prosba o anulowanie wyslana po
    // zdarzeniu 1, zdarzenie 1 jest juz za nami (bez sluchaczy — bez odczytu dziennika).
    const marks: string[] = [];
    b.bus.onCancel((trialId) => marks.push(trialId));
    await a.journal.create("t-3");
    a.bus.published(await a.journal.append("t-3", 1, filed("t-3"), []));
    a.bus.cancelRequested("znacznik");
    await expect.poll(() => marks).toEqual(["znacznik"]);
    expect(reads).toBe(0);
    await a.pool.query("SELECT pg_notify($1, $2)", [CHANNEL, "to nie JSON"]);
    await expect.poll(() => b.errors).toHaveLength(1);
    const heard: number[] = [];
    b.hub.subscribe("t-3", (e) => heard.push(e.seq));
    a.bus.published(await a.journal.append("t-3", 2, speech, []));
    await expect.poll(() => heard).toEqual([2]);
    expect(reads).toBe(1);
    await Promise.all([a.bus.close(), b.bus.close()]);
  });

  it("zerwane polaczenie LISTEN (restart bazy): blad w logach, ponowne laczenie, magistrala dziala dalej", async () => {
    const a = await instance();
    const b = await instance();
    const listening = () => a.pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE query = $1", [`LISTEN ${CHANNEL}`]);
    const before = (await listening()).rows.map((r) => r.pid);
    // Zabijamy polaczenia nasluchujace obu instancji — tak jak restart Postgresa.
    await a.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = $1", [`LISTEN ${CHANNEL}`]);
    await expect.poll(() => b.errors.length).toBeGreaterThan(0);
    await expect.poll(async () => (await listening()).rows.filter((r) => !before.includes(r.pid)).length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    const cancelled: string[] = [];
    b.bus.onCancel((trialId) => cancelled.push(trialId));
    a.bus.cancelRequested("t-6");
    await expect.poll(() => cancelled).toEqual(["t-6"]);
    await Promise.all([a.bus.close(), b.bus.close()]);
  });

  it("po zamknieciu instancja nie slucha; drugie zamkniecie nic nie robi", async () => {
    const a = await instance();
    const b = await instance();
    const cancelled: string[] = [];
    b.bus.onCancel((trialId) => cancelled.push(trialId));
    await b.bus.close();
    await b.bus.close();
    // Komunikat dociera do A (slucha), wiec skoro doszedl tam, B tez by go juz dostala.
    const seenByA: string[] = [];
    a.bus.onCancel((trialId) => seenByA.push(trialId));
    a.bus.cancelRequested("t-5");
    await expect.poll(() => seenByA).toEqual(["t-5"]);
    expect(cancelled).toEqual([]);
    await a.bus.close();
  });
});
