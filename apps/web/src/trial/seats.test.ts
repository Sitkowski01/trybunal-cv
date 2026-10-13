import { CRITIC_IDS, currentScores, nextSpeaker, replay } from "@trybunal/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { emptyCourt } from "./court.js";
import { seats, speaker } from "./seats.js";

describe("seats i speaker zgodne z domena", () => {
  it("kazdy poczatek rozprawy: mowca jak nextSpeaker, oceny na miejscach jak currentScores", () => {
    const score = fc.integer({ min: 1, max: 10 });
    const arb = fc.record({
      scores: fc.array(score, { minLength: 5, maxLength: 5 }),
      revisions: fc.array(fc.array(fc.option(score), { minLength: 5, maxLength: 5 }), { maxLength: 3 }),
    });
    fc.assert(
      fc.property(arb, fc.nat(), ({ scores, revisions }, cut) => {
        const events = trial(scores, revisions);
        const prefix = events.slice(0, (cut % events.length) + 1);
        const domain = replay(prefix);
        const court = fold(envelopes(prefix));
        expect(speaker(court)).toBe(nextSpeaker(domain));
        if (domain.assessments.length === CRITIC_IDS.length) {
          expect(Object.fromEntries(seats(court).map((s) => [s.criticId, s.score]))).toEqual(currentScores(domain));
        }
      }),
    );
  });

  it("przed wniesieniem nikt nie mowi", () => {
    expect(speaker(emptyCourt)).toBeNull();
  });
});

describe("seats", () => {
  it("przed ocena: puste miejsca w kolejnosci domeny", () => {
    expect(seats(emptyCourt)).toEqual(CRITIC_IDS.map((criticId) => ({ criticId, assessment: null, score: null, statements: [] })));
  });

  it("ostatnia zmiana zdania wygrywa; brak zmiany zostawia ocene", () => {
    const court = fold(envelopes(trial([4, 5, 6, 7, 8], [[9, 3, null, null, null], [null, 2, null, null, null]])));
    expect(seats(court).map((s) => s.score)).toEqual([9, 2, 6, 7, 8]);
    const ats = seats(court)[0];
    expect(ats?.statements.map((s) => [s.round, s.revisedScore])).toEqual([[1, 9], [2, null]]);
    expect(ats?.assessment?.score).toBe(4);
  });
});
