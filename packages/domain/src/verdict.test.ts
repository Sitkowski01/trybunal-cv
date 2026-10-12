import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import { ATS_GATE, deliberate, INVITE_THRESHOLD, type Scores } from "./verdict.js";

const scores = (ats: number, hr: number, techLead: number, hiringManager: number, prosecutor = 2): Scores => ({
  ats,
  hr,
  techLead,
  hiringManager,
  prosecutor,
});

const scoreArb = fc.integer({ min: 1, max: 10 });
const scoresArb: fc.Arbitrary<Scores> = fc.record({
  ats: scoreArb,
  hr: scoreArb,
  techLead: scoreArb,
  hiringManager: scoreArb,
  prosecutor: scoreArb,
});

describe("deliberate", () => {
  it("zaprasza, gdy srednia przysieglych osiaga prog", () => {
    const s = scores(6, 6, 6, 6);
    expect(deliberate(s, s)).toMatchObject({ decision: "invite", juryAverage: 6 });
  });

  it("odrzuca tuz pod progiem", () => {
    const s = scores(6, 6, 6, 5);
    expect(deliberate(s, s)).toMatchObject({ decision: "reject", juryAverage: 5.75 });
  });

  it("odrzuca przy niskiej ocenie ATS mimo wysokiej sredniej", () => {
    const s = scores(ATS_GATE - 1, 10, 10, 10);
    expect(deliberate(s, s)).toMatchObject({ decision: "reject", atsGateFailed: true });
  });

  it("ATS dokladnie na bramce przepuszcza", () => {
    const s = scores(ATS_GATE, 10, 10, 10);
    expect(deliberate(s, s)).toMatchObject({ decision: "invite", atsGateFailed: false });
  });

  it("liczy rozrzut i wskazuje najsurowszych i najlagodniejszych", () => {
    const s = scores(3, 7, 3, 7, 1);
    expect(deliberate(s, s)).toMatchObject({
      spread: 4,
      disputed: true,
      harshest: ["ats", "techLead"],
      mildest: ["hr", "hiringManager"],
    });
  });

  it("rozrzut ponizej progu to brak sporu", () => {
    const s = scores(5, 6, 7, 8);
    expect(deliberate(s, s)).toMatchObject({ spread: 3, disputed: false });
  });

  it("zapisuje zmiany zdania w kolejnosci miejsc, takze prokuratora", () => {
    const verdict = deliberate(scores(5, 5, 5, 5, 2), scores(5, 7, 5, 4, 3));
    expect(verdict.mindChanges).toEqual([
      { criticId: "hr", from: 5, to: 7 },
      { criticId: "hiringManager", from: 5, to: 4 },
      { criticId: "prosecutor", from: 2, to: 3 },
    ]);
  });

  it("bez zmian zdania lista jest pusta", () => {
    const s = scores(5, 5, 5, 5);
    expect(deliberate(s, s).mindChanges).toEqual([]);
  });
});

describe("deliberate — wlasnosci", () => {
  it("ocena prokuratora nigdy nie zmienia decyzji", () => {
    fc.assert(
      fc.property(scoresArb, scoreArb, (s, other) => {
        const changed = { ...s, prosecutor: other };
        return deliberate(s, s).decision === deliberate(changed, changed).decision;
      }),
    );
  });

  it("podniesienie oceny przysieglego nigdy nie zamienia zaproszenia w odrzucenie", () => {
    const juror = fc.constantFrom<CriticId>("ats", "hr", "techLead", "hiringManager");
    fc.assert(
      fc.property(scoresArb, juror, (s, id) => {
        const raised = { ...s, [id]: Math.min(10, s[id] + 1) };
        return !(deliberate(s, s).decision === "invite" && deliberate(raised, raised).decision === "reject");
      }),
    );
  });

  it("zaproszenie zawsze oznacza srednia co najmniej na progu i zdany ATS", () => {
    fc.assert(
      fc.property(scoresArb, (s) => {
        const v = deliberate(s, s);
        return v.decision === "reject" || (v.juryAverage >= INVITE_THRESHOLD && s.ats >= ATS_GATE);
      }),
    );
  });

  it("najsurowsi i najlagodniejsi to przysiegli z ocena min i max", () => {
    fc.assert(
      fc.property(scoresArb, (s) => {
        const v = deliberate(s, s);
        const jury = CRITIC_IDS.filter((id) => id !== "prosecutor").map((id) => s[id]);
        return (
          v.harshest.every((id) => s[id] === Math.min(...jury)) &&
          v.mildest.every((id) => s[id] === Math.max(...jury)) &&
          !v.harshest.includes("prosecutor") &&
          v.spread === Math.max(...jury) - Math.min(...jury)
        );
      }),
    );
  });
});
