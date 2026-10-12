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
  });
}
