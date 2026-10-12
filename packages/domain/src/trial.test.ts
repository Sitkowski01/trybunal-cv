import { describe, expect, it } from "vitest";
import type { Assessment } from "./assessment.js";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import {
  fileTrial,
  initialScores,
  replay,
  type TrialEvent,
  TrialRuleError,
} from "./trial.js";

const filed = (debateRounds = 1): TrialEvent => ({
  type: "TrialFiled",
  trialId: "t-1",
  cvText: "CV",
  jobOffer: "Oferta",
  debateRounds,
});

const assessment = (criticId: CriticId, score = 6): Assessment => ({
  criticId,
  score,
  recommendation: score >= 6 ? "invite" : "reject",
  summary: `Ocena ${criticId}`,
  strengths: [],
  concerns: [],
  rewrites: [],
});

const submitted = (criticId: CriticId, score = 6): TrialEvent => ({
  type: "AssessmentSubmitted",
  assessment: assessment(criticId, score),
});

const allAssessed: TrialEvent[] = CRITIC_IDS.map((id) => submitted(id));
const rejects = (events: TrialEvent[], message: RegExp) => {
  expect(() => replay(events)).toThrow(TrialRuleError);
  expect(() => replay(events)).toThrow(message);
};

it("blad reguly rozprawy ma wlasna nazwe w logach", () => {
  expect(new TrialRuleError("x").name).toBe("TrialRuleError");
});

describe("wniesienie sprawy", () => {
  it("zaczyna od fazy ocen z pustymi aktami", () => {
    expect(replay([filed()])).toMatchObject({
      trialId: "t-1",
      cvText: "CV",
      jobOffer: "Oferta",
      debateRounds: 1,
      phase: "assessing",
      assessments: [],
      prosecution: null,
      round: 0,
      statements: [],
      verdict: null,
      justification: null,
      abortReason: null,
    });
  });

  it("odrzuca rozprawe zaczeta innym zdarzeniem", () => {
    rejects([submitted("ats")], /musi zaczac sie od TrialFiled, a nie AssessmentSubmitted/);
  });

  it("odrzuca pusta liste zdarzen", () => {
    rejects([], /Brak zdarzen/);
  });

  it.each([0, 3])("przyjmuje %i rund debaty", (rounds) => {
    expect(fileTrial(filed(rounds)).debateRounds).toBe(rounds);
  });

  it.each([-1, 4, 1.5])("odrzuca %d rund debaty", (rounds) => {
    expect(() => fileTrial(filed(rounds))).toThrow(/od 0 do 3/);
  });

  it("nie da sie wniesc sprawy drugi raz", () => {
    rejects([filed(), filed()], /juz zostala wniesiona/);
  });
});

describe("oceny niezalezne", () => {
  it("czeka na wszystkich pieciu krytykow", () => {
    const four = allAssessed.slice(0, 4);
    expect(replay([filed(), ...four]).phase).toBe("assessing");
    expect(replay([filed(), ...allAssessed]).phase).toBe("prosecution");
  });

  it("przyjmuje oceny w dowolnej kolejnosci", () => {
    expect(replay([filed(), ...[...allAssessed].reverse()]).phase).toBe("prosecution");
  });

  it("krytyk ocenia tylko raz", () => {
    rejects([filed(), submitted("hr"), submitted("hr", 3)], /hr juz zlozyl ocene/);
  });

  it("po zebraniu ocen nie przyjmuje kolejnych", () => {
    rejects([filed(), ...allAssessed, submitted("ats")], /Ocena mozliwe w fazie assessing.*prosecution/);
  });

  it("oceny poczatkowe to wyniki z niezaleznej rundy", () => {
    const events = [filed(), ...CRITIC_IDS.map((id, i) => submitted(id, i + 1))];
    expect(initialScores(replay(events))).toEqual({ ats: 1, hr: 2, techLead: 3, hiringManager: 4, prosecutor: 5 });
  });
});

describe("kolejne fazy", () => {
  it("mowa oskarzenia nie jest jeszcze obslugiwana", () => {
    rejects([filed(), ...allAssessed, { type: "ProsecutionDelivered", speech: "x" }], /jeszcze nieobslugiwane/);
  });
});
