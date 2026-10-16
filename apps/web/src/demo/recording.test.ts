import { describe, expect, it } from "vitest";
import { BadEnvelopeError } from "../trial/envelope.js";
import { toSse } from "../test/sse.js";
import { envelopes, trial } from "../test/trials.js";
import committed from "./recording.sse?raw";
import { DEMO_CASE } from "./case.js";
import { BadRecordingError, readRecording } from "./recording.js";

const full = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null]]));

describe("readRecording", () => {
  it("zakonczona rozprawa: zdarzenia w kolejnosci, z danymi dokladnie jak ze strumienia", () => {
    const recording = readRecording(toSse(full));
    expect(recording.events.map((e) => e.envelope)).toEqual(full);
    expect(recording.events[0]?.data).toBe(JSON.stringify(full[0]));
  });

  it("rozprawa przerwana tez jest poprawnym nagraniem", () => {
    const aborted = envelopes(trial([5, 5, 5, 5, 5], [], true));
    expect(readRecording(toSse(aborted)).events.at(-1)?.envelope.event.type).toBe("TrialAborted");
  });

  it("bez zdarzenia end: strumien nie zapisal sie do konca", () => {
    expect(() => readRecording(toSse(full, null))).toThrow(new BadRecordingError("Nagranie bez zdarzenia end — strumien nie zostal zapisany do konca"));
    expect(new BadRecordingError("x").name).toBe("BadRecordingError");
  });

  it("zdarzenia po end sa pomijane", () => {
    expect(readRecording(toSse(full) + toSse(full, null)).events).toHaveLength(full.length);
  });

  it("zle dane zdarzenia: blad schematu jak na zywo", () => {
    expect(() => readRecording('event: TrialFiled\ndata: {"seq":1}\n\nevent: end\ndata: {}\n\n')).toThrow(BadEnvelopeError);
  });

  it("typ SSE niezgodny z danymi", () => {
    const text = toSse(full).replace("event: ProsecutionDelivered", "event: StatementMade");
    expect(() => readRecording(text)).toThrow(new BadRecordingError("Zdarzenie 7: typ SSE StatementMade, a w danych ProsecutionDelivered"));
  });

  it("musi zaczynac sie od wniesienia i konczyc werdyktem albo przerwaniem", () => {
    const filed = "Nagranie musi zaczynac sie od wniesienia sprawy";
    expect(() => readRecording(toSse([]))).toThrow(new BadRecordingError(filed));
    expect(() => readRecording(toSse(full.slice(1)))).toThrow(new BadRecordingError(filed));
    expect(() => readRecording(toSse(full.slice(0, -1)))).toThrow(new BadRecordingError("Nagranie musi konczyc sie werdyktem albo przerwaniem rozprawy"));
  });

  it("numery zdarzen po kolei od 1, bez luk", () => {
    const gap = [...full.slice(0, 3), ...full.slice(4)];
    expect(() => readRecording(toSse(gap))).toThrow(new BadRecordingError("Zdarzenie 4 ma numer 5"));
  });

  it("nagranie w repozytorium: pelna rozprawa nad CV z demo, z debata w dwoch rundach", () => {
    const { events } = readRecording(committed);
    const filed = events[0]?.envelope.event;
    // Serwer przycina tekst i ukrywa imie i nazwisko ([KANDYDAT]) — po dlugosci oferty poznac, ze to ta sama sprawa.
    expect(filed?.type === "TrialFiled" && filed.jobOfferChars).toBe(DEMO_CASE.offer.trim().length);
    expect(events.at(-1)?.envelope.event.type).toBe("VerdictAnnounced");
    expect(events.filter((e) => e.envelope.event.type === "StatementMade")).toHaveLength(10);
  });
});
