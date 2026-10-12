import { describe, expect, it } from "vitest";
import type { Assessment } from "./assessment.js";
import { CRITIC_IDS, type CriticId } from "./critics.js";
import {
  currentScores,
  evolve,
  fileTrial,
  initialScores,
  nextSpeaker,
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
const prosecution: TrialEvent = { type: "ProsecutionDelivered", speech: "Odrzucic!" };

const statement = (round: number, criticId: CriticId, revisedScore: number | null = null): TrialEvent => ({
  type: "StatementMade",
  round,
  criticId,
  statement: `${criticId} w rundzie ${String(round)}`,
  revisedScore,
});

const round = (n: number): TrialEvent[] => CRITIC_IDS.map((id) => statement(n, id));
const aborted: TrialEvent = { type: "TrialAborted", reason: "przekroczony budzet" };

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

describe("oskarzenie i debata", () => {
  it("mowa oskarzenia otwiera pierwsza runde, mowi pierwszy przy stole", () => {
    const state = replay([filed(2), ...allAssessed, prosecution]);
    expect(state).toMatchObject({ phase: "debate", round: 1, prosecution: "Odrzucic!" });
    expect(nextSpeaker(state)).toBe("ats");
  });

  it("bez rund debaty po oskarzeniu od razu narada", () => {
    expect(replay([filed(0), ...allAssessed, prosecution])).toMatchObject({ phase: "deliberation", round: 0 });
  });

  it("oskarzenie dopiero po wszystkich ocenach", () => {
    rejects([filed(), submitted("ats"), prosecution], /Mowa oskarzenia mozliwe w fazie prosecution/);
  });

  it("krytycy mowia w kolejnosci miejsc", () => {
    const state = replay([filed(), ...allAssessed, prosecution, statement(1, "ats"), statement(1, "hr")]);
    expect(nextSpeaker(state)).toBe("techLead");
  });

  it("odrzuca wypowiedz nie w swojej kolejce", () => {
    rejects([filed(), ...allAssessed, prosecution, statement(1, "hr")], /Teraz mowi ats w rundzie 1/);
  });

  it("odrzuca wypowiedz z inna runda", () => {
    rejects([filed(2), ...allAssessed, prosecution, statement(2, "ats")], /Teraz mowi ats w rundzie 1/);
  });

  it("odrzuca wypowiedz przed debata", () => {
    rejects([filed(), ...allAssessed, statement(1, "ats")], /Wypowiedz mozliwe w fazie debate/);
  });

  it("po rundzie zaczyna sie nastepna, po ostatniej narada", () => {
    const afterFirst = replay([filed(2), ...allAssessed, prosecution, ...round(1)]);
    expect(afterFirst).toMatchObject({ phase: "debate", round: 2 });
    expect(nextSpeaker(afterFirst)).toBe("ats");
    const afterLast = replay([filed(2), ...allAssessed, prosecution, ...round(1), ...round(2)]);
    expect(afterLast).toMatchObject({ phase: "deliberation", round: 2 });
    expect(afterLast.statements).toHaveLength(10);
  });

  it("nikt nie mowi poza debata", () => {
    expect(nextSpeaker(replay([filed(), ...allAssessed]))).toBeNull();
  });

  it("zmiana zdania nadpisuje ocene, ostatnia wygrywa, poczatkowe zostaja", () => {
    const events = [
      filed(2),
      ...allAssessed,
      prosecution,
      statement(1, "ats", 3),
      ...round(1).slice(1),
      statement(2, "ats", 8),
    ];
    const state = replay(events);
    expect(currentScores(state)).toMatchObject({ ats: 8, hr: 6 });
    expect(initialScores(state).ats).toBe(6);
  });
});

describe("przerwanie i kolejne fazy", () => {
  const debate = [filed(1), ...allAssessed, prosecution, ...round(1)];

  it("rozprawe mozna przerwac w kazdej trwajacej fazie", () => {
    for (let cut = 1; cut <= debate.length; cut++) {
      expect(replay([...debate.slice(0, cut), aborted])).toMatchObject({
        phase: "aborted",
        abortReason: "przekroczony budzet",
      });
    }
  });

  it("przerwana rozprawa nie przyjmuje zdarzen", () => {
    rejects([filed(), aborted, submitted("ats")], /zakonczona \(aborted\)/);
  });

  it("evolve nie zmienia poprzedniego stanu", () => {
    const before = replay([filed()]);
    evolve(before, submitted("ats"));
    expect(before.assessments).toEqual([]);
  });

  it("werdykt nie jest jeszcze obslugiwany", () => {
    rejects([...debate, { type: "VerdictAnnounced", justification: "x" }], /jeszcze nieobslugiwany/);
  });
});
