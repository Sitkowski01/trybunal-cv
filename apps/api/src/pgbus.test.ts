import { EventEmitter } from "node:events";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrialHub } from "./hub.js";
import type { Journal } from "./journal.js";
import { CHANNEL, PostgresBus } from "./pgbus.js";

// Ponowne laczenie LISTEN na atrapie puli — przypadki, ktorych prawdziwa baza nie wywola na zawolanie.
class FakeClient extends EventEmitter {
  readonly queries: string[] = [];
  released: unknown[] = [];
  constructor(private readonly failListen = false) {
    super();
  }
  query(sql: string) {
    this.queries.push(sql);
    return this.failListen && sql.startsWith("LISTEN") ? Promise.reject(new Error("LISTEN odrzucony")) : Promise.resolve({ rows: [] });
  }
  release(arg?: unknown) {
    this.released.push(arg);
  }
}

function setup(connects: (() => Promise<FakeClient>)[]) {
  const errors: unknown[] = [];
  let calls = 0;
  const pool = {
    connect: () => {
      const next = connects[calls++];
      return next === undefined ? Promise.reject(new Error("brak polaczen")) : next();
    },
    query: () => Promise.resolve({ rows: [] }),
  } as unknown as pg.Pool;
  const bus = new PostgresBus({ pool, journal: {} as Journal, hub: new TrialHub(), onError: (e) => errors.push(e), reconnectMs: 10 });
  return { bus, errors, connects: () => calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PostgresBus — ponowne laczenie", () => {
  it("zerwane polaczenie: zwolnione z bledem, kolejne proby co 10, 20 ms, az LISTEN wroci", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { bus, errors, connects } = setup([
      () => Promise.resolve(first),
      () => Promise.reject(new Error("baza wstaje")),
      () => Promise.resolve(second),
    ]);
    await bus.start();
    const broken = new Error("terminating connection");
    first.emit("error", broken);
    first.emit("error", new Error("drugi raz")); // juz nie nasz sluchacz — ignorowany
    expect(first.released).toEqual([broken]);
    await vi.advanceTimersByTimeAsync(9);
    expect(connects()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connects()).toBe(2);
    await vi.advanceTimersByTimeAsync(19);
    expect(connects()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connects()).toBe(3);
    expect(second.queries).toEqual([`LISTEN ${CHANNEL}`]);
    expect(errors.map((e) => (e as Error).message)).toEqual(["terminating connection", "baza wstaje"]);
    await bus.close();
    expect(second.queries).toEqual([`LISTEN ${CHANNEL}`, `UNLISTEN ${CHANNEL}`]);
  });

  it("przerwa rosnie najwyzej do 30 s", async () => {
    const first = new FakeClient();
    const { bus, connects } = setup([() => Promise.resolve(first)]);
    await bus.start();
    first.emit("error", new Error("x"));
    // 10, 20, 40, ... ms; po przekroczeniu 30 s kazda kolejna proba po 30 s.
    await vi.advanceTimersByTimeAsync(10 + 20 + 40 + 80 + 160 + 320 + 640 + 1280 + 2560 + 5120 + 10_240 + 20_480);
    const before = connects();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(connects()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(connects()).toBe(before + 1);
    await bus.close();
  });

  it("odrzucony LISTEN: polaczenie zniszczone, blad dla wywolujacego", async () => {
    const client = new FakeClient(true);
    const { bus } = setup([() => Promise.resolve(client)]);
    await expect(bus.start()).rejects.toThrow("LISTEN odrzucony");
    expect(client.released).toEqual([true]);
  });

  it("zamkniecie w trakcie ponownego laczenia: nikt juz nie laczy, a spoznione polaczenie wraca do puli", async () => {
    const first = new FakeClient();
    const late = new FakeClient();
    let resolveLate: (c: FakeClient) => void = () => undefined;
    const { bus, connects } = setup([
      () => Promise.resolve(first),
      () => new Promise<FakeClient>((r) => { resolveLate = r; }),
    ]);
    await bus.start();
    first.emit("error", new Error("x"));
    await vi.advanceTimersByTimeAsync(10);
    expect(connects()).toBe(2);
    await bus.close();
    resolveLate(late);
    await vi.advanceTimersByTimeAsync(1000);
    expect(late.released).toEqual([undefined]);
    expect(connects()).toBe(2);
  });

  it("zamkniecie przed proba ponownego laczenia odwoluje ja", async () => {
    const first = new FakeClient();
    const { bus, connects } = setup([() => Promise.resolve(first)]);
    await bus.start();
    first.emit("error", new Error("x"));
    await bus.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connects()).toBe(1);
  });
});
