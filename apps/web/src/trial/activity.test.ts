import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { activity } from "./activity.js";
import { type Court, emptyCourt } from "./court.js";
import { seats, speaker } from "./seats.js";

const list = envelopes(trial([7, 7, 7, 7, 7], [[null, null, null, null, null]]));
const activities = (court: Court) => seats(court).map((s) => activity(court, s));

describe("activity", () => {
  it("przed zdarzeniami nikt nic nie robi", () => {
    expect(activities(emptyCourt)).toEqual(["idle", "idle", "idle", "idle", "idle"]);
  });

  it("oceny: kto zlozyl, ten 'assessed', reszta czyta akta", () => {
    expect(activities(fold(list.slice(0, 3)))).toEqual(["assessed", "assessed", "thinking", "thinking", "thinking"]);
  });

  it("po zerwaniu polaczenia nikt juz nie mysli", () => {
    const lost: Court = { ...fold(list.slice(0, 2)), status: "lost" };
    expect(activities(lost)).toEqual(["assessed", "idle", "idle", "idle", "idle"]);
  });

  it("debata: przemawia autor ostatniej wypowiedzi, nastepny szykuje odpowiedz, reszta slucha", () => {
    const court = fold(list.slice(0, 8));
    expect(speaker(court)).toBe("ats");
    expect(activities(court)).toEqual(["speaking", "preparing", "listening", "listening", "listening"]);
  });

  it("po mowie oskarzenia przemawia prokurator, Bot ATS szykuje pierwsza odpowiedz", () => {
    const court = fold(list.slice(0, 7));
    expect(speaker(court)).toBe("prosecutor");
    expect(activities(court)).toEqual(["preparing", "listening", "listening", "listening", "speaking"]);
  });

  it("narada: autor ostatniego slowa wciaz przemawia, reszta slucha", () => {
    expect(activities(fold(list.slice(0, list.length - 1)))).toEqual(["listening", "listening", "listening", "listening", "speaking"]);
  });

  it("oskarzenie i koniec: wszyscy po ocenie", () => {
    for (const n of [6, list.length]) {
      expect(activities(fold(list.slice(0, n)))).toEqual(["assessed", "assessed", "assessed", "assessed", "assessed"]);
    }
  });
});
