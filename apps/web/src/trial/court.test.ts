import { replay } from "@trybunal/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { apply, type Court, emptyCourt, ended, isOver, phaseOf } from "./court.js";
import type { Envelope } from "./envelope.js";

const score = fc.integer({ min: 1, max: 10 });
const trialArb = fc.record({
  scores: fc.array(score, { minLength: 5, maxLength: 5 }),
  revisions: fc.array(fc.array(fc.option(score), { minLength: 5, maxLength: 5 }), { maxLength: 3 }),
  aborted: fc.boolean(),
});

describe("sala z przegladarki zgodna z domena", () => {
  it("kazdy poczatek rozprawy: stan jak replay (bez CV)", () => {
    fc.assert(
      fc.property(trialArb, fc.nat(), ({ scores, revisions, aborted }, cut) => {
        const events = trial(scores, revisions, aborted);
        const prefix = events.slice(0, (cut % events.length) + 1);
        const domain = replay(prefix);
        const court = fold(envelopes(prefix));
        expect(court.trial).toEqual({ ...domain, cvText: "", jobOffer: "" });
      }),
    );
  });

  it("powtorzone zdarzenia (wznowienie strumienia) nie zmieniaja stanu", () => {
    fc.assert(
      fc.property(trialArb, fc.array(fc.nat(), { maxLength: 3 }), ({ scores, revisions }, repeats) => {
        const list = envelopes(trial(scores, revisions), 7);
        // Po kazdym zdarzeniu serwer moze powtorzyc dowolne wczesniejsze.
        const withRepeats = list.flatMap((e, i) => [e, ...repeats.map((r) => list[r % (i + 1)] as Envelope)]);
        expect(fold(withRepeats)).toEqual(fold(list));
      }),
    );
  });
});

describe("apply", () => {
  const list = envelopes(trial([4, 5, 6, 7, 8], [[9, null, null, null, null], [null, 2, null, null, null]]), 1000);

  it("pusta sala: laczenie, bez rozprawy i fazy", () => {
    expect(emptyCourt).toEqual({ status: "connecting", trial: null, abortedIn: null, costNanoUsd: 0, lastSeq: 0, fault: null });
    expect(phaseOf(emptyCourt)).toBeNull();
  });

  it("wniesienie: rozprawa w fazie ocen, status live, numer zdarzenia", () => {
    const court = fold(list.slice(0, 1));
    expect(court).toMatchObject({ status: "live", lastSeq: 1, abortedIn: null, fault: null });
    expect(court.trial).toMatchObject({ trialId: "t-1", phase: "assessing", debateRounds: 2 });
  });

  it("sumuje koszt wszystkich wywolan ze wszystkich zdarzen", () => {
    const withTwoCalls: Envelope = { ...(list[1] as Envelope), calls: [{ costNanoUsd: 1 }, { costNanoUsd: 2 }] };
    expect(fold(list).costNanoUsd).toBe(1000 * list.length);
    expect(fold([list[0] as Envelope, withTwoCalls]).costNanoUsd).toBe(1003);
  });

  it("zdarzenie niezgodne z przebiegiem: blad w stanie, dalsze zdarzenia ignorowane", () => {
    const court = fold([list[0] as Envelope, { ...(list[6] as Envelope), seq: 2 }]);
    expect(court.status).toBe("lost");
    expect(court.fault).toMatch(/^Serwer przysłał zdarzenie niezgodne z przebiegiem rozprawy: Mowa oskarzenia/u);
    expect(court.lastSeq).toBe(1);
    expect(apply(court, { ...(list[1] as Envelope), seq: 3 })).toBe(court);
  });

  it("strumien bez wniesienia na poczatku to tez blad przebiegu", () => {
    expect(apply(emptyCourt, list[1] as Envelope).fault).toMatch(/Rozprawa musi zaczac sie od TrialFiled/u);
  });

  it("inny blad niz regula rozprawy nie jest polykany", () => {
    const court = fold(list.slice(0, 1));
    const odd = { ...(list[1] as Envelope), event: null } as unknown as Envelope;
    expect(() => apply(court, odd)).toThrow(TypeError);
  });

  it("werdykt i przerwanie koncza strumien; przerwanie pamieta faze, w ktorej stanelo", () => {
    expect(fold(list)).toMatchObject({ status: "finished", abortedIn: null });
    const aborted = fold(envelopes(trial([7, 7, 7, 7, 7], [[null]], true)));
    expect(aborted.status).toBe("finished");
    expect(aborted.trial?.abortReason).toBe("budzet");
    const early = envelopes(trial([7, 7, 7, 7, 7], [], true));
    expect(fold([early[0] as Envelope, { ...(early.at(-1) as Envelope), seq: 2 }]).abortedIn).toBe("assessing");
    const midDebate = envelopes(trial([7, 7, 7, 7, 7], [[null]]));
    const abort = early.at(-1) as Envelope;
    expect(fold([...midDebate.slice(0, 8), { ...abort, seq: 9 }]).abortedIn).toBe("debate");
  });
});

describe("ended i isOver", () => {
  const list = envelopes(trial([7, 7, 7, 7, 7], [[null, null, null, null, null]]));

  it("koniec po werdykcie albo po utracie polaczenia nic nie zmienia", () => {
    const court = fold(list);
    expect(ended(court)).toBe(court);
    const lost: Court = { ...fold(list.slice(0, 2)), status: "lost" };
    expect(ended(lost)).toBe(lost);
  });

  it("koniec w trakcie albo przed pierwszym zdarzeniem to przerwanie", () => {
    expect(ended(fold(list.slice(0, 3))).status).toBe("interrupted");
    expect(ended(emptyCourt).status).toBe("interrupted");
  });

  it("isOver tylko dla werdyktu i przerwania", () => {
    expect((["assessing", "prosecution", "debate", "deliberation", "closed", "aborted"] as const).map(isOver)).toEqual([false, false, false, false, true, true]);
  });
});
