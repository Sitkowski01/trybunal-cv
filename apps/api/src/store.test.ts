import { describe, expect, it } from "vitest";
import { describeEventStore } from "./store.contract.js";
import { InMemoryEventStore } from "./store.js";

describeEventStore("w pamieci", () => Promise.resolve(new InMemoryEventStore()));

describe("InMemoryEventStore", () => {
  it("konflikty z komunikatem, co poszlo nie tak", async () => {
    const store = new InMemoryEventStore();
    await store.createTrial("t", Buffer.from("k"));
    const record = { trialId: "t", seq: 2, type: "TrialFiled", occurredAt: new Date(), schemaVersion: 1, payload: Buffer.from([1]), calls: [] };
    await expect(store.createTrial("t", Buffer.from("k"))).rejects.toThrow("Rozprawa t juz istnieje");
    await expect(store.append({ ...record, trialId: "x" })).rejects.toThrow("Nie ma rozprawy x");
    await expect(store.append(record)).rejects.toThrow("Zdarzenie 2 nie jest kolejnym w rozprawie t");
  });

  it("trzyma kopie buforow — zmiana po zapisie nie psuje dziennika", async () => {
    const store = new InMemoryEventStore();
    const key = Buffer.from("klucz");
    await store.createTrial("t", key);
    const payload = Buffer.from([1]);
    await store.append({ trialId: "t", seq: 1, type: "TrialFiled", occurredAt: new Date(), schemaVersion: 1, payload, calls: [] });
    key[0] = 0;
    payload[0] = 9;
    expect(await store.wrappedKey("t")).toEqual(Buffer.from("klucz"));
    expect((await store.read("t", 0))[0]?.payload).toEqual(Buffer.from([1]));
  });
});
