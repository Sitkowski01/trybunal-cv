import type { CallRecord } from "@trybunal/court";
import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, type EventStore, type StoredRecord } from "./store.js";

/** Wspolne testy kontraktu EventStore: ta sama obietnica w pamieci i w Postgresie. */
export function describeEventStore(name: string, create: () => Promise<EventStore>) {
  const call = (costNanoUsd: number): CallRecord => ({
    label: "assessment:hr",
    attempt: 1,
    model: "claude-sonnet-5-5",
    outcome: "ok",
    usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 7 },
    costNanoUsd,
    costKnown: true,
    durationMs: 3,
  });
  const record = (trialId: string, seq: number, extra: Partial<StoredRecord> = {}): StoredRecord => ({
    trialId,
    seq,
    type: seq === 1 ? "TrialFiled" : "AssessmentSubmitted",
    occurredAt: new Date(Date.UTC(2026, 9, 12, 10, 0, seq)),
    schemaVersion: 1,
    payload: Buffer.from([seq, 0, 255]),
    calls: [],
    ...extra,
  });

  describe(`EventStore: ${name}`, () => {
    let store: EventStore;
    beforeEach(async () => {
      store = await create();
      await store.createTrial("t-1", Buffer.from("klucz"), new Date());
    });

    it("zapisuje i oddaje zdarzenia rosnaco, po wskazanym numerze", async () => {
      const first = record("t-1", 1);
      const second = record("t-1", 2, { calls: [call(5)] });
      await store.append(first);
      await store.append(second);
      expect(await store.read("t-1", 0)).toEqual([first, second]);
      expect(await store.read("t-1", 1)).toEqual([second]);
      expect(await store.read("t-1", 2)).toEqual([]);
    });

    it("nieznana rozprawa: brak zdarzen i brak klucza", async () => {
      expect(await store.read("inna", 0)).toEqual([]);
      expect(await store.wrappedKey("inna")).toBeUndefined();
      expect(await store.forget("inna")).toBe(false);
    });

    it("drugi raz to samo id rozprawy -> ConflictError", async () => {
      await expect(store.createTrial("t-1", Buffer.from("x"), new Date())).rejects.toBeInstanceOf(ConflictError);
      expect(await store.wrappedKey("t-1")).toEqual(Buffer.from("klucz"));
    });

    it("zdarzenie bez rozprawy, powtorzony numer albo dziura -> ConflictError", async () => {
      await expect(store.append(record("brak", 1))).rejects.toBeInstanceOf(ConflictError);
      await store.append(record("t-1", 1));
      await expect(store.append(record("t-1", 1))).rejects.toBeInstanceOf(ConflictError);
      await expect(store.append(record("t-1", 3))).rejects.toBeInstanceOf(ConflictError);
      expect(await store.read("t-1", 0)).toHaveLength(1);
    });

    it("zapomnienie usuwa klucz, zdarzenia zostaja (bez klucza nieczytelne)", async () => {
      await store.append(record("t-1", 1));
      expect(await store.forget("t-1")).toBe(true);
      expect(await store.wrappedKey("t-1")).toBeNull();
      expect(await store.read("t-1", 0)).toHaveLength(1);
      expect(await store.forget("t-1")).toBe(true);
    });

    it("rozprawy sa od siebie niezalezne", async () => {
      await store.createTrial("t-2", Buffer.from("k2"), new Date());
      await store.append(record("t-1", 1));
      await store.append(record("t-2", 1));
      await store.forget("t-2");
      expect(await store.read("t-2", 0)).toEqual([record("t-2", 1)]);
      expect(await store.wrappedKey("t-1")).toEqual(Buffer.from("klucz"));
    });

    it("koszt od chwili: sumuje proby zdarzen od tej chwili wlacznie", async () => {
      await store.append(record("t-1", 1));
      await store.append(record("t-1", 2, { calls: [call(100), call(20)] }));
      await store.append(record("t-1", 3, { calls: [call(3)] }));
      expect(await store.spentSince(new Date(Date.UTC(2026, 9, 12, 10, 0, 2)))).toBe(123);
      expect(await store.spentSince(new Date(Date.UTC(2026, 9, 12, 10, 0, 3)))).toBe(3);
      expect(await store.spentSince(new Date(Date.UTC(2026, 9, 13)))).toBe(0);
    });

    it("trwa: bez konca i z pulsem (albo zalozeniem) po podanej chwili; koniec dotyczy tylko tej rozprawy", async () => {
      const created = new Date(Date.UTC(2026, 9, 17, 12));
      await store.createTrial("t-2", Buffer.from("k2"), created);
      await store.createTrial("t-3", Buffer.from("k3"), created);
      const before = new Date(Date.UTC(2026, 9, 17, 11));
      expect(await store.isActive("t-2", before)).toBe(true);
      // Bez pulsu po granicy — instancja padla w trakcie, nikt jej nie dokonczy.
      expect(await store.isActive("t-2", created)).toBe(false);
      // Puls przywraca; dotyczy tylko wskazanych rozpraw (nieznane pomija).
      await store.touch(["t-2", "brak"], new Date(Date.UTC(2026, 9, 17, 12, 1)));
      expect(await store.isActive("t-2", created)).toBe(true);
      expect(await store.isActive("t-3", created)).toBe(false);
      await store.markEnded("t-2", new Date(Date.UTC(2026, 9, 17, 12, 5)));
      expect(await store.isActive("t-2", before)).toBe(false);
      expect(await store.isActive("t-3", before)).toBe(true);
      expect(await store.isActive("brak", before)).toBe(false);
      await store.markEnded("brak", new Date());
    });

    it("retencja: klucze rozpraw starszych niz granica usuniete, zdarzenia i nowsze rozprawy zostaja", async () => {
      await store.createTrial("stara", Buffer.from("k"), new Date(Date.UTC(2026, 8, 1)));
      await store.createTrial("zapomniana", Buffer.from("k"), new Date(Date.UTC(2026, 8, 1)));
      await store.forget("zapomniana");
      await store.createTrial("nowa", Buffer.from("k"), new Date(Date.UTC(2026, 9, 16)));
      await store.append(record("stara", 1));
      // Juz zapomniana nie liczy sie drugi raz.
      expect(await store.expireKeys(new Date(Date.UTC(2026, 9, 1)))).toBe(1);
      expect(await store.wrappedKey("stara")).toBeNull();
      expect(await store.read("stara", 0)).toEqual([record("stara", 1)]);
      expect(await store.wrappedKey("nowa")).toEqual(Buffer.from("k"));
      expect(await store.expireKeys(new Date(Date.UTC(2026, 9, 1)))).toBe(0);
    });
  });
}
