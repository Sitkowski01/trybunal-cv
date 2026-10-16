import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseDifferences, majority, stdDev, summarize, variantsOf } from "./metrics.js";
import { aborted, outcome } from "./test/fixtures.js";

describe("majority", () => {
  it("wiecej zaproszen -> invite; remis i przewaga odrzucen -> reject", () => {
    expect(majority(["invite", "invite", "reject"])).toBe("invite");
    expect(majority(["invite", "reject"])).toBe("reject");
    expect(majority(["reject", "reject", "invite"])).toBe("reject");
    expect(majority(["invite"])).toBe("invite");
  });
});

describe("stdDev", () => {
  it("odchylenie populacji; stale wartosci i pusta lista -> 0", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(stdDev([6, 6, 6])).toBe(0);
    expect(stdDev([])).toBe(0);
  });
});

describe("summarize", () => {
  it("trafnosc i macierz pomylek tylko z zakonczonych rozpraw wybranego wariantu", () => {
    const s = summarize("v1", [
      outcome({ caseId: "a", expected: "invite", decision: "invite" }),
      outcome({ caseId: "b", expected: "invite", decision: "reject" }),
      outcome({ caseId: "c", expected: "reject", decision: "invite" }),
      outcome({ caseId: "d", expected: "reject", decision: "reject" }),
      outcome({ caseId: "e", expected: "reject", decision: "reject" }),
      aborted({ caseId: "f" }),
      outcome({ caseId: "a", variant: "v2", decision: "reject" }),
    ]);
    expect(s).toMatchObject({ variant: "v1", trials: 6, completed: 5, aborted: 1, accuracy: 3 / 5 });
    expect(s.confusion).toEqual({ invite: { invite: 1, reject: 1 }, reject: { invite: 1, reject: 2 } });
  });

  it("bez zakonczonych rozpraw metryki sa puste, a nie zerowe", () => {
    const s = summarize("v1", [aborted({ costNanoUsd: 0, attempts: 0, inputTokens: 0 })]);
    expect(s).toMatchObject({ accuracy: null, cacheHitRatio: null, retryRate: null, missedCases: [] });
    expect(s.stability).toEqual({ repeatedCases: 0, agreement: null, juryAverageStdDev: null, flippingCases: [] });
    expect(summarize("v9", []).cost).toEqual({ totalNanoUsd: 0, meanPerTrialNanoUsd: null, maxPerTrialNanoUsd: null });
  });

  it("trafnosc wedlug tagow; tag bez rozpraw pomijany, kolejnosc jak w slowniku tagow", () => {
    const s = summarize("v1", [
      outcome({ caseId: "a", tags: ["slabe", "ats"], expected: "reject", decision: "reject" }),
      outcome({ caseId: "b", tags: ["ats"], expected: "reject", decision: "invite" }),
      aborted({ caseId: "c", tags: ["luka"] }),
    ]);
    expect(s.byTag).toEqual([
      { tag: "slabe", completed: 1, correct: 1 },
      { tag: "ats", completed: 2, correct: 1 },
    ]);
  });

  it("stabilnosc: zgodnosc z wiekszoscia, odchylenie sredniej, przypadki zmieniajace werdykt", () => {
    const s = summarize("v1", [
      outcome({ caseId: "a", repeat: 0, decision: "invite", juryAverage: 6 }),
      outcome({ caseId: "a", repeat: 1, decision: "reject", juryAverage: 5 }),
      outcome({ caseId: "a", repeat: 2, decision: "invite", juryAverage: 7 }),
      outcome({ caseId: "b", repeat: 0, decision: "reject", juryAverage: 3, expected: "reject" }),
      outcome({ caseId: "b", repeat: 1, decision: "reject", juryAverage: 3, expected: "reject" }),
      outcome({ caseId: "c", repeat: 0 }),
    ]);
    expect(s.stability.repeatedCases).toBe(2);
    expect(s.stability.agreement).toBeCloseTo((2 / 3 + 1) / 2);
    expect(s.stability.juryAverageStdDev).toBeCloseTo((Math.sqrt(2 / 3) + 0) / 2);
    expect(s.stability.flippingCases).toEqual(["a"]);
  });

  it("chybione przypadki wedlug werdyktu wiekszosci powtorzen", () => {
    const s = summarize("v1", [
      outcome({ caseId: "a", expected: "invite", decision: "reject" }),
      outcome({ caseId: "a", expected: "invite", decision: "reject", repeat: 1 }),
      outcome({ caseId: "a", expected: "invite", decision: "invite", repeat: 2 }),
      outcome({ caseId: "b", expected: "reject", decision: "reject" }),
    ]);
    expect(s.missedCases).toEqual(["a"]);
  });

  it("koszt, cache i ponowienia licza tez przerwane rozprawy — za nie tez placimy", () => {
    const s = summarize("v1", [
      outcome({ costNanoUsd: 300, attempts: 10, failedAttempts: 1, inputTokens: 100, cacheWriteTokens: 100, cacheReadTokens: 200 }),
      aborted({ costNanoUsd: 900, attempts: 10, failedAttempts: 3, inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 }),
    ]);
    expect(s.cost).toEqual({ totalNanoUsd: 1200, meanPerTrialNanoUsd: 600, maxPerTrialNanoUsd: 900 });
    expect(s.cacheHitRatio).toBe(200 / 500);
    expect(s.retryRate).toBe(4 / 20);
  });

  it("nieudane proby wedlug kroku i powodu: sumy z rozpraw wariantu, od najczestszych, remis alfabetycznie", () => {
    // Kolejnosc wystapienia celowo inna niz wynikowa.
    const s = summarize("v1", [
      outcome({ failures: { "statement:hr/incomplete": 1, "prosecution/invalid": 1 } }),
      aborted({ failures: { "assessment:ats/rejected": 3 } }),
      outcome({ variant: "v2", failures: { "justification/transport": 5 } }),
    ]);
    expect(s.failures).toEqual([
      { key: "assessment:ats/rejected", count: 3 },
      { key: "prosecution/invalid", count: 1 },
      { key: "statement:hr/incomplete", count: 1 },
    ]);
    expect(summarize("v1", [outcome()]).failures).toEqual([]);
  });

  it("wlasnosc: trafne + chybione = zakonczone, a trafnosc i zgodnosc mieszcza sie w [0, 1]", () => {
    const arbOutcome = fc.record({
      caseId: fc.constantFrom("a", "b", "c"),
      expected: fc.constantFrom("invite" as const, "reject" as const),
      decision: fc.constantFrom("invite" as const, "reject" as const, null),
      juryAverage: fc.double({ min: 1, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(arbOutcome, { maxLength: 30 }), (rows) => {
        const all = rows.map((r, repeat) => (r.decision === null ? aborted({ ...r, repeat }) : outcome({ ...r, repeat })));
        const s = summarize("v1", all);
        const c = s.confusion;
        expect(c.invite.invite + c.invite.reject + c.reject.invite + c.reject.reject).toBe(s.completed);
        expect(s.completed + s.aborted).toBe(s.trials);
        for (const value of [s.accuracy, s.stability.agreement]) {
          if (value !== null) expect(value >= 0 && value <= 1).toBe(true);
        }
        expect(s.stability.agreement === null || s.stability.agreement >= 0.5).toBe(true);
      }),
    );
  });
});

describe("variantsOf i caseDifferences", () => {
  it("warianty w kolejnosci pierwszego wystapienia", () => {
    expect(variantsOf([outcome({ variant: "v2" }), outcome({ variant: "v1" }), outcome({ variant: "v2" })])).toEqual(["v2", "v1"]);
  });

  it("roznice werdyktow wiekszosci; przypadek bez wyniku w jednym z wariantow pomijany", () => {
    const rows = [
      outcome({ caseId: "a", variant: "v1", decision: "invite", expected: "reject" }),
      outcome({ caseId: "a", variant: "v2", decision: "reject", expected: "reject" }),
      outcome({ caseId: "b", variant: "v1", decision: "reject" }),
      outcome({ caseId: "b", variant: "v2", decision: "reject" }),
      outcome({ caseId: "c", variant: "v1", decision: "invite" }),
      aborted({ caseId: "c", variant: "v2" }),
      outcome({ caseId: "d", variant: "v2", decision: "invite" }),
    ];
    expect(caseDifferences(rows, "v1", "v2")).toEqual([{ caseId: "a", expected: "reject", base: "invite", candidate: "reject" }]);
  });
});
