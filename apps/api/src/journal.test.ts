import type { CallRecord } from "@trybunal/court";
import type { TrialEvent } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { DecryptionError, newKey } from "./crypto.js";
import { Journal, SCHEMA_VERSION, TrialForgottenError, TrialNotFoundError } from "./journal.js";
import { ConflictError, InMemoryEventStore } from "./store.js";

const filed: TrialEvent = { type: "TrialFiled", trialId: "t-1", cvText: "Anna Nowak, Java", jobOffer: "Junior Java", debateRounds: 1 };
const speech: TrialEvent = { type: "ProsecutionDelivered", speech: "Odrzucic" };
const call: CallRecord = {
  label: "prosecution", attempt: 1, model: "claude-sonnet-5-5", outcome: "ok", usage: null, costNanoUsd: 42, costKnown: true, durationMs: 1,
};
const at = new Date("2026-10-12T10:00:00.000Z");

function setup() {
  const store = new InMemoryEventStore();
  const masterKey = newKey();
  return { store, masterKey, journal: new Journal(store, masterKey, () => at) };
}

describe("Journal", () => {
  it("zapisuje koperte i odczytuje ja z powrotem", async () => {
    const { journal } = setup();
    await journal.create("t-1");
    const envelope = await journal.append("t-1", 1, filed, []);
    expect(envelope).toEqual({ trialId: "t-1", seq: 1, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: SCHEMA_VERSION, event: filed, calls: [] });
    await journal.append("t-1", 2, speech, [call]);
    expect(await journal.read("t-1")).toEqual([envelope, { ...envelope, seq: 2, event: speech, calls: [call] }]);
    expect((await journal.read("t-1", 1)).map((e) => e.seq)).toEqual([2]);
  });

  it("w bazie tresc jest zaszyfrowana, a typ, czas i koszt jawne", async () => {
    const { store, journal } = setup();
    await journal.create("t-1");
    await journal.append("t-1", 1, filed, [call]);
    const [stored] = await store.read("t-1", 0);
    expect(stored?.payload.includes(Buffer.from("Anna"))).toBe(false);
    expect(stored).toMatchObject({ type: "TrialFiled", occurredAt: at, schemaVersion: SCHEMA_VERSION, calls: [call] });
    expect(await journal.spentSince(at)).toBe(42);
  });

  it("zapomniana rozprawa: odczyt i zapis -> TrialForgottenError", async () => {
    const { journal } = setup();
    await journal.create("t-1");
    await journal.append("t-1", 1, filed, []);
    expect(await journal.forget("t-1")).toBe(true);
    await expect(journal.read("t-1")).rejects.toBeInstanceOf(TrialForgottenError);
    await expect(journal.append("t-1", 2, speech, [])).rejects.toThrow("Rozprawa t-1 zostala zapomniana na zadanie kandydata");
    expect(await journal.forget("brak")).toBe(false);
  });

  it("nieznana rozprawa -> TrialNotFoundError", async () => {
    const { journal } = setup();
    await expect(journal.read("brak")).rejects.toThrow(new TrialNotFoundError("Nie ma rozprawy brak"));
    await expect(journal.append("brak", 1, filed, [])).rejects.toBeInstanceOf(TrialNotFoundError);
  });

  it("konflikty numerow przechodza ze store", async () => {
    const { journal } = setup();
    await journal.create("t-1");
    await expect(journal.append("t-1", 2, filed, [])).rejects.toBeInstanceOf(ConflictError);
  });

  it("inny klucz glowny nie odczyta rozprawy", async () => {
    const { store, journal } = setup();
    await journal.create("t-1");
    await expect(new Journal(store, newKey()).read("t-1")).rejects.toBeInstanceOf(DecryptionError);
  });

  it("zdarzenie przeniesione z innego miejsca dziennika nie odszyfruje sie", async () => {
    const { store, journal } = setup();
    await journal.create("t-1");
    await journal.append("t-1", 1, filed, []);
    await journal.append("t-1", 2, speech, []);
    const [first, second] = await store.read("t-1", 0);
    if (first === undefined || second === undefined) throw new Error("brak zdarzen");
    first.payload.set(second.payload.subarray(0, first.payload.length));
    await expect(journal.read("t-1")).rejects.toBeInstanceOf(DecryptionError);
  });

  it("nieznana wersja schematu i tresc niezgodna ze schematem -> blad, nie ciche dane", async () => {
    const { store, journal, masterKey } = setup();
    await journal.create("t-1");
    await journal.append("t-1", 1, filed, []);
    const [record] = await store.read("t-1", 0);
    if (record === undefined) throw new Error("brak zdarzenia");
    const tampered = new InMemoryEventStore();
    await tampered.createTrial("t-1", (await store.wrappedKey("t-1")) ?? Buffer.alloc(0));
    await tampered.append({ ...record, schemaVersion: 2 });
    await expect(new Journal(tampered, masterKey).read("t-1")).rejects.toThrow("Nieznana wersja schematu zdarzenia: 2");

    const bad = new Journal(store, masterKey, () => at);
    await bad.append("t-1", 2, { type: "ProsecutionDelivered", speech: "" }, []);
    await expect(bad.read("t-1")).rejects.toThrow(/speech/);
  });
});
