import { describe, expect, it } from "vitest";
import { majority, stdDev, summarize } from "./metrics.js";
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
});
