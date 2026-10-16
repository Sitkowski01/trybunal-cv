import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { CLOSED, type EventSourceLike } from "../api/stream.js";
import { parseEnvelope } from "../trial/envelope.js";
import { toSse } from "../test/sse.js";
import { envelopes, trial } from "../test/trials.js";
import { FIRST_EVENT_MS, pauseAfter } from "./pace.js";
import { readRecording } from "./recording.js";
import { createReplay, DEMO_TRIAL_ID, speedFromSearch } from "./replay.js";

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

  it("przerwanie: zdarzenie TrialAborted z kolejnym numerem i end; dalszych zdarzen brak", async () => {
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    const { api, sources } = createReplay(recording);
    const got = listen(sources(api.eventsUrl(DEMO_TRIAL_ID)));
    vi.advanceTimersByTime(at[3] ?? 0);
    await api.cancel(DEMO_TRIAL_ID);
    vi.advanceTimersByTime(END);
    expect(got.map((g) => g.type)).toEqual(["open", "TrialFiled", "AssessmentSubmitted", "AssessmentSubmitted", "AssessmentSubmitted", "TrialAborted", "end"]);
    expect(parseEnvelope(got[5]?.data ?? "")).toEqual({
      seq: 5,
      // Czas przerwania: zegar przesuniety do czwartego zdarzenia (0,3 + 2,5 + 2 × 1,2 s).
      occurredAt: "2026-10-16T12:00:05.200Z",
      event: { type: "TrialAborted", reason: "Rozprawa anulowana" },
      calls: [],
    });
  });

  it("przerwanie trafia do kazdego trwajacego odtworzenia (np. dwie karty)", async () => {
    const { api, sources } = createReplay(recording);
    const first = listen(sources(api.eventsUrl(DEMO_TRIAL_ID)));
    const second = listen(sources(api.eventsUrl(DEMO_TRIAL_ID)));
    vi.advanceTimersByTime(at[1] ?? 0);
    await api.cancel(DEMO_TRIAL_ID);
    vi.advanceTimersByTime(0);
    expect(first.at(-2)?.type).toBe("TrialAborted");
    expect(second.at(-2)?.type).toBe("TrialAborted");
  });

  it("nie da sie przerwac rozprawy zakonczonej, zamknietej ani nieznanej (409)", async () => {
    const { api, sources } = createReplay(recording);
    const conflict = new ApiError(409, "Rozprawa nie trwa");
    await expect(api.cancel(DEMO_TRIAL_ID)).rejects.toEqual(conflict);

    sources(api.eventsUrl(DEMO_TRIAL_ID));
    vi.advanceTimersByTime(END);
    await expect(api.cancel(DEMO_TRIAL_ID)).rejects.toEqual(conflict);

    sources(api.eventsUrl(DEMO_TRIAL_ID)).close();
    await expect(api.cancel(DEMO_TRIAL_ID)).rejects.toEqual(conflict);

    sources(api.eventsUrl(DEMO_TRIAL_ID));
    await expect(api.cancel("inna")).rejects.toEqual(conflict);
  });

  it("drugie przerwanie tej samej rozprawy: 409", async () => {
    const { api, sources } = createReplay(recording);
    sources(api.eventsUrl(DEMO_TRIAL_ID));
    await api.cancel(DEMO_TRIAL_ID);
    await expect(api.cancel(DEMO_TRIAL_ID)).rejects.toBeInstanceOf(ApiError);
  });

  it("wniesienie odrzuca (demo nie ma serwera), zapomnienie przechodzi; adres strumienia z id rozprawy", async () => {
    const { api } = createReplay(recording);
    await expect(api.file({ cv: { kind: "text", text: "x" }, jobOffer: "y", debateRounds: 0 })).rejects.toEqual(
      new ApiError(0, "Demo nie ma serwera — odtwarza nagraną rozprawę."),
    );
    await expect(api.forget(DEMO_TRIAL_ID)).resolves.toBeUndefined();
    expect(api.eventsUrl("a b")).toBe("nagranie:a b");
  });
});

describe("speedFromSearch", () => {
  it("tempo z adresu w zakresie 1-50, inaczej 1", () => {
    expect(speedFromSearch("?tempo=4")).toBe(4);
    expect(speedFromSearch("?rozprawa=nagranie&tempo=1.5")).toBe(1.5);
    expect(speedFromSearch("?tempo=50")).toBe(50);
    expect(speedFromSearch("?tempo=1")).toBe(1);
    for (const bad of ["", "?tempo=0.5", "?tempo=51", "?tempo=abc", "?tempo=Infinity", "?tempo=-3"]) expect(speedFromSearch(bad)).toBe(1);
  });
});
