import { describe, expect, it } from "vitest";
import { describeEventStore } from "./store.contract.js";
import { InMemoryEventStore } from "./store.js";

describeEventStore("w pamieci", () => Promise.resolve(new InMemoryEventStore()));

describe("InMemoryEventStore", () => {
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
