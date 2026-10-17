import { ANONYMIZATION_RULE, DEBATE_ASK, JUDGE_ASK, PROMPTS, PROSECUTION_ASK, PROSECUTOR_STANCE } from "@trybunal/court";
import { CRITIC_IDS, type CriticId, criticById, pendingVerdict, replay, type TrialEvent } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import {
  ANCHORS,
  DEFAULT_VARIANTS,
  PROMPTS_V1,
  PROMPTS_V2,
  PROMPTS_V3,
  replaceEnding,
  SCALE_LINE,
  V1_DEBATE_ASK,
  V1_JUDGE_ASK,
  V1_PROSECUTION_ASK,
  V1_PROSECUTOR_STANCE,
  VARIANTS,
  variantByVersion,
} from "./variants.js";

describe("warianty promptow", () => {
  it("v1, v2 i v3 do odtworzenia wynikow, prompty sadu na koncu i domyslnie", () => {
    expect(VARIANTS.map((v) => v.version)).toEqual(["v1", "v2-kotwice", "v3-scena", "v4"]);
    expect(VARIANTS.at(-1)).toBe(PROMPTS);
    expect(DEFAULT_VARIANTS).toEqual([PROMPTS]);
  });

  it("v2 to v1 z kotwicami zamiast linii skali", () => {
    const [before = "", after = ""] = PROMPTS_V1.rules.split(SCALE_LINE);
    expect(after.length).toBeGreaterThan(0);
    expect(PROMPTS_V2).toEqual({ ...PROMPTS_V1, version: "v2-kotwice", rules: `${before}${ANCHORS}${after}` });
    // Jedna skala, nie dwie.
    expect(PROMPTS_V2.rules.match(/Skala ocen/g)).toHaveLength(1);
    expect(PROMPTS_V2.rules).not.toContain("6–7 zaprosić");
  });

  it("kotwice opisuja kazdy przedzial skali, w tym prog zaproszenia 6", () => {
    for (const band of ["9–10", "7–8", "- 6:", "4–5", "1–3"]) expect(ANCHORS).toContain(band);
    expect(ANCHORS).toContain("Wyjątek: Bot ATS");
  });

  it("v3-scena to v4 bez zasady o anonimizacji; v1 i v2 tez bez niej", () => {
    expect(PROMPTS.rules).toContain(ANONYMIZATION_RULE);
    expect(PROMPTS_V3).toMatchObject({ version: "v3-scena", assessmentTask: PROMPTS.assessmentTask });
    expect(PROMPTS_V3.rules).not.toContain("[KANDYDAT]");
    expect(PROMPTS_V3.rules.split("\n")).toHaveLength(PROMPTS.rules.split("\n").length - ANONYMIZATION_RULE.split("\n").length);
    for (const old of [PROMPTS_V1, PROMPTS_V2]) expect(old.rules).not.toContain("[KANDYDAT]");
  });

  it("wersje sa unikalne i da sie je znalezc po nazwie", () => {
    expect(new Set(VARIANTS.map((v) => v.version)).size).toBe(VARIANTS.length);
    expect(variantByVersion("v2-kotwice")).toBe(PROMPTS_V2);
    expect(variantByVersion("v1")).toBe(PROMPTS_V1);
    expect(variantByVersion("v9")).toBeUndefined();
  });
});

describe("v1 odtworzone z promptow sadu", () => {
  const assessment = (criticId: CriticId, score: number): TrialEvent => ({
    type: "AssessmentSubmitted",
    assessment: { criticId, score, summary: "ok", strengths: [], concerns: [], rewrites: [] },
  });
  const events: TrialEvent[] = [
    { type: "TrialFiled", trialId: "t", cvText: "Java", jobOffer: "Junior Java", debateRounds: 1 },
    ...CRITIC_IDS.map((id) => assessment(id, 6)),
    { type: "ProsecutionDelivered", speech: "Odrzucic" },
  ];
  const state = replay(events);

  it("podmienia tylko koncowe polecenia i postawe prokuratora; zasady i przebieg wspolne", () => {
    expect(PROMPTS_V1).toMatchObject({ version: "v1", rules: PROMPTS_V3.rules, assessmentTask: PROMPTS.assessmentTask, judgeInstructions: PROMPTS.judgeInstructions });
    expect(PROMPTS_V1.prosecutionTask(state)).toBe(PROMPTS.prosecutionTask(state).replace(PROSECUTION_ASK, V1_PROSECUTION_ASK));
    expect(PROMPTS_V1.debateTask(state, "hr")).toBe(PROMPTS.debateTask(state, "hr").replace(DEBATE_ASK, V1_DEBATE_ASK));
    const verdict = pendingVerdict(replay([...events, ...CRITIC_IDS.map((id): TrialEvent => ({ type: "StatementMade", round: 1, criticId: id, statement: "x", revisedScore: null }))]));
    expect(PROMPTS_V1.judgeTask(state, verdict).endsWith(V1_JUDGE_ASK)).toBe(true);
    expect(PROMPTS_V1.judgeTask(state, verdict)).not.toContain(JUDGE_ASK);
  });

  it("prokurator v1 bez obowiazku wnoszenia o odrzucenie; przysiegli bez zmian", () => {
    expect(PROMPTS_V1.instructionsFor(criticById("prosecutor"))).toContain(V1_PROSECUTOR_STANCE);
    expect(PROMPTS_V1.instructionsFor(criticById("prosecutor"))).not.toContain(PROSECUTOR_STANCE);
    expect(PROMPTS_V1.instructionsFor(criticById("hr"))).toBe(PROMPTS.instructionsFor(criticById("hr")));
  });

  it("zadanie bez oczekiwanego zakonczenia: blad, a nie cicha zmiana srodka promptu", () => {
    expect(replaceEnding("abc koniec", "koniec", "nowy")).toBe("abc nowy");
    expect(() => replaceEnding("koniec abc", "koniec", "nowy")).toThrow("Zadanie nie konczy sie poleceniem: koniec");
  });
});
