import { describe, expect, it } from "vitest";
import { BadEnvelopeError, parseEnvelope } from "./envelope.js";

const filed = { type: "TrialFiled", trialId: "t-1", debateRounds: 1, cvChars: 120, jobOfferChars: 40 };
const envelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ trialId: "t-1", seq: 1, occurredAt: "2026-10-13T10:00:00.000Z", schemaVersion: 1, event: filed, calls: [], ...overrides });

describe("parseEnvelope", () => {
  it("czyta koperte serwera; z wywolan bierze tylko koszt", () => {
    const call = { label: "assessment:hr", attempt: 1, model: "claude-sonnet-5-5", costNanoUsd: 1500, costKnown: true };
    expect(parseEnvelope(envelope({ calls: [call] }))).toEqual({
      seq: 1,
      occurredAt: "2026-10-13T10:00:00.000Z",
      event: filed,
      calls: [{ costNanoUsd: 1500 }],
    });
  });

  it.each<[string, string]>([
    ["zly JSON", "{nie json"],
    ["numer 0", envelope({ seq: 0 })],
    ["numer ulamkowy", envelope({ seq: 1.5 })],
    // Bez tej kontroli frontend po cichu przyjalby strumien z serwera, ktory wycieka CV.
    ["wniesienie z tekstem CV", envelope({ event: { ...filed, cvText: "Java" } })],
    ["nieznane zdarzenie", envelope({ event: { type: "Unknown" } })],
    ["ujemny koszt", envelope({ calls: [{ costNanoUsd: -1 }] })],
    ["brak listy wywolan", envelope({ calls: undefined })],
    ["brak czasu", envelope({ occurredAt: undefined })],
  ])("odrzuca: %s", (_, data) => {
    expect(() => parseEnvelope(data)).toThrow(BadEnvelopeError);
  });

  it("komunikat mowi, czy zawiodl JSON, czy ksztalt", () => {
    expect(() => parseEnvelope("x")).toThrow("Zdarzenie rozprawy nie jest poprawnym JSON-em");
    expect(() => parseEnvelope(envelope({ seq: 0 }))).toThrow(/^Nieznany ksztalt zdarzenia rozprawy: .+/u);
    // Wszystkie problemy, nie tylko pierwszy.
    expect(() => parseEnvelope(envelope({ seq: 0, occurredAt: 5 }))).toThrow(/: .+; .+/u);
    expect(() => parseEnvelope("x")).toThrow(expect.objectContaining({ name: "BadEnvelopeError" }));
  });
});
