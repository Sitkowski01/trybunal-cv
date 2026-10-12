import { describe, expect, it } from "vitest";
import { CRITIC_IDS } from "./critics.js";
import { MAX_CV_CHARS, type TrialEvent, TrialEventSchema } from "./events.js";
import { announceVerdict, replay } from "./trial.js";

const filed: TrialEvent = { type: "TrialFiled", trialId: "t-1", cvText: "CV z Java", jobOffer: "Oferta", debateRounds: 1 };

const fullTrial = (): TrialEvent[] => {
  const events: TrialEvent[] = [
    filed,
    ...CRITIC_IDS.map((criticId): TrialEvent => ({
      type: "AssessmentSubmitted",
      assessment: {
        criticId,
        score: 7,
        summary: "ok",
        strengths: ["Java"],
        concerns: [{ quote: "Java", issue: "bez projektow", severity: "low" }],
        rewrites: [],
      },
    })),
    { type: "ProsecutionDelivered", speech: "Odrzucic!" },
    ...CRITIC_IDS.map((criticId): TrialEvent => ({
      type: "StatementMade",
      round: 1,
      criticId,
      statement: "Podtrzymuje",
      revisedScore: criticId === "hr" ? 5 : null,
    })),
  ];
  return [...events, announceVerdict(replay(events), "Zapraszamy")];
};

const parses = (event: unknown) => TrialEventSchema.safeParse(event).success;

describe("TrialEventSchema", () => {
  it("cala rozprawa przechodzi przez JSON (jak przez baze) i schemat bez zmian", () => {
    const events = fullTrial();
    const fromDb: unknown = JSON.parse(JSON.stringify(events));
    expect((fromDb as unknown[]).map((e) => TrialEventSchema.parse(e))).toEqual(events);
    expect(replay(events).phase).toBe("closed");
  });

  it.each<[string, Record<string, unknown>]>([
    ["nieznany typ", { type: "SomethingElse" }],
    ["puste id rozprawy", { ...filed, trialId: " " }],
    ["za dlugie CV", { ...filed, cvText: "x".repeat(MAX_CV_CHARS + 1) }],
    ["4 rundy debaty", { ...filed, debateRounds: 4 }],
    ["pusta mowa oskarzenia", { type: "ProsecutionDelivered", speech: "" }],
    ["za dluga mowa", { type: "ProsecutionDelivered", speech: "x".repeat(3001) }],
    ["runda 0", { type: "StatementMade", round: 0, criticId: "hr", statement: "x", revisedScore: null }],
    ["nowa ocena 11", { type: "StatementMade", round: 1, criticId: "hr", statement: "x", revisedScore: 11 }],
    ["mowi sedzia", { type: "StatementMade", round: 1, criticId: "judge", statement: "x", revisedScore: null }],
    ["puste uzasadnienie przerwania", { type: "TrialAborted", reason: "" }],
  ])("odrzuca: %s", (_, event) => {
    expect(parses(event)).toBe(false);
  });

  it("dopuszcza CV na granicy dlugosci i brak zmiany oceny", () => {
    expect(parses({ ...filed, cvText: "x".repeat(MAX_CV_CHARS) })).toBe(true);
    expect(parses({ type: "StatementMade", round: 3, criticId: "hr", statement: "x", revisedScore: null })).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["nieznana decyzja", { decision: "maybe" }],
    ["srednia 11", { juryAverage: 11 }],
    ["ujemny rozrzut", { spread: -1 }],
    ["nieznany krytyk w zmianach zdania", { mindChanges: [{ criticId: "judge", from: 5, to: 6 }] }],
  ])("odrzuca werdykt: %s", (_, change) => {
    const verdict = fullTrial().at(-1) as Extract<TrialEvent, { type: "VerdictAnnounced" }>;
    expect(parses({ ...verdict, verdict: { ...verdict.verdict, ...change } })).toBe(false);
  });

  it.each([-1, 1.5])("odrzuca wersje reguly %d", (ruleVersion) => {
    const verdict = fullTrial().at(-1) as TrialEvent;
    expect(parses({ ...verdict, ruleVersion })).toBe(false);
  });
});
