import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSED, type EventSourceLike } from "../api/stream.js";
import { toSse } from "../test/sse.js";
import { envelopes, trial } from "../test/trials.js";
import { FIRST_EVENT_MS, pauseAfter } from "./pace.js";
import { readRecording } from "./recording.js";
import { createReplay, DEMO_TRIAL_ID } from "./replay.js";

const full = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null]]));
const recording = readRecording(toSse(full));
/** Kiedy przychodzi kazde zdarzenie przy tempie 1: po przerwie poprzedniego. */
const at = full.map((_, i) => full.slice(0, i).reduce((ms, e) => ms + pauseAfter(e.event), FIRST_EVENT_MS));
const END = at.at(-1) ?? 0;

/** Zrodlo z zapisem wszystkiego, co przyszlo (typ i dane), jak sluchacze w openTrialStream. */
function listen(source: EventSourceLike) {
  const got: { type: string; data: string }[] = [];
  for (const type of ["open", "error", "end", ...new Set(full.map((e) => e.event.type)), "TrialAborted"]) {
    source.addEventListener(type, (event) => got.push({ type, data: event.data }));
  }
  return got;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createReplay", () => {
  it("odtwarza nagranie w tempie: otwarcie, zdarzenia z danymi jak z serwera, na koniec end", () => {
    const { api, sources } = createReplay(recording);
    const source = sources(api.eventsUrl(DEMO_TRIAL_ID));
    const got = listen(source);
    expect(source.readyState).toBe(0);
    vi.advanceTimersByTime(0);
    expect(source.readyState).toBe(1);
    expect(got).toEqual([{ type: "open", data: "" }]);

    vi.advanceTimersByTime((at[1] ?? 0) - 1);
    expect(got.map((g) => g.type)).toEqual(["open", "TrialFiled"]);
    vi.advanceTimersByTime(1);
    expect(got.map((g) => g.type)).toEqual(["open", "TrialFiled", "AssessmentSubmitted"]);

    vi.advanceTimersByTime(END);
    expect(got.slice(1, -1).map((g) => g.data)).toEqual(full.map((e) => JSON.stringify(e)));
    expect(got.at(-1)).toEqual({ type: "end", data: '{"reason":"finished"}' });
  });

  it("tempo 4: cala rozprawa w czwartej czesci czasu", () => {
    const { api, sources } = createReplay(recording, 4);
    const got = listen(sources(api.eventsUrl(DEMO_TRIAL_ID)));
    vi.advanceTimersByTime(END / 4);
    expect(got.at(-1)?.type).toBe("end");
  });

  it("zamkniecie zatrzymuje odtwarzanie", () => {
    const { api, sources } = createReplay(recording);
    const source = sources(api.eventsUrl(DEMO_TRIAL_ID));
    const got = listen(source);
    vi.advanceTimersByTime(at[2] ?? 0);
    source.close();
    expect(source.readyState).toBe(CLOSED);
    vi.advanceTimersByTime(END);
    expect(got).toHaveLength(4);
  });

  it("nieznana rozprawa: odmowa jak z serwera (blad przy zamknietym polaczeniu)", () => {
    const { api, sources } = createReplay(recording);
    const source = sources(api.eventsUrl("inna"));
    const got = listen(source);
    vi.advanceTimersByTime(END);
    expect(source.readyState).toBe(CLOSED);
    expect(got).toEqual([{ type: "error", data: "" }]);
  });
});
