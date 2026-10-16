import { DEBATE_ASK, JUDGE_ASK, PROMPTS, PROSECUTION_ASK, PROSECUTOR_STANCE } from "@trybunal/court";
import { CRITIC_IDS, type CriticId, criticById, pendingVerdict, replay, type TrialEvent } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import {
  ANCHORS,
  PROMPTS_SCENE,
  PROMPTS_V2,
  replaceEnding,
  SCALE_LINE,
  SCENE_DEBATE_ASK,
  SCENE_JUDGE_ASK,
  SCENE_PROSECUTION_ASK,
  SCENE_PROSECUTOR_STANCE,
  VARIANTS,
  variantByVersion,
} from "./variants.js";

describe("warianty promptow", () => {
  it("v1 to prompty sadu, v2 rozni sie tylko zasadami: kotwice zastepuja linie skali", () => {
    expect(VARIANTS.map((v) => v.version)).toEqual(["v1", "v2-kotwice", "v3-scena"]);
    expect(VARIANTS[0]).toBe(PROMPTS);
    const [before = "", after = ""] = PROMPTS.rules.split(SCALE_LINE);
    expect(after.length).toBeGreaterThan(0);
    expect(PROMPTS_V2).toEqual({ ...PROMPTS, version: "v2-kotwice", rules: `${before}${ANCHORS}${after}` });
    // Jedna skala, nie dwie.
    expect(PROMPTS_V2.rules.match(/Skala ocen/g)).toHaveLength(1);
    expect(PROMPTS_V2.rules).not.toContain("6–7 zaprosić");
  });

  it("kotwice opisuja kazdy przedzial skali, w tym prog zaproszenia 6", () => {
    for (const band of ["9–10", "7–8", "- 6:", "4–5", "1–3"]) expect(ANCHORS).toContain(band);
    expect(ANCHORS).toContain("Wyjątek: Bot ATS");
  });

  it("wersje sa unikalne i da sie je znalezc po nazwie", () => {
    expect(new Set(VARIANTS.map((v) => v.version)).size).toBe(VARIANTS.length);
    expect(variantByVersion("v2-kotwice")).toBe(PROMPTS_V2);
    expect(variantByVersion("v3")).toBeUndefined();
  });
});

describe("v3-scena", () => {
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

  it("podmienia tylko koncowe polecenia i postawe prokuratora; zasady i przebieg jak w v1", () => {
    expect(PROMPTS_SCENE).toMatchObject({ version: "v3-scena", rules: PROMPTS.rules, assessmentTask: PROMPTS.assessmentTask, judgeInstructions: PROMPTS.judgeInstructions });
    expect(PROMPTS_SCENE.prosecutionTask(state)).toBe(PROMPTS.prosecutionTask(state).replace(PROSECUTION_ASK, SCENE_PROSECUTION_ASK));
    expect(PROMPTS_SCENE.debateTask(state, "hr")).toBe(PROMPTS.debateTask(state, "hr").replace(DEBATE_ASK, SCENE_DEBATE_ASK));
    const verdict = pendingVerdict(replay([...events, ...CRITIC_IDS.map((id): TrialEvent => ({ type: "StatementMade", round: 1, criticId: id, statement: "x", revisedScore: null }))]));
    expect(PROMPTS_SCENE.judgeTask(state, verdict).endsWith(SCENE_JUDGE_ASK)).toBe(true);
    expect(PROMPTS_SCENE.judgeTask(state, verdict)).not.toContain(JUDGE_ASK);
  });

  it("prokurator zawsze wnosi o odrzucenie, ale ocenia uczciwie; przysiegli bez zmian", () => {
    expect(PROMPTS_SCENE.instructionsFor(criticById("prosecutor"))).toContain(SCENE_PROSECUTOR_STANCE);
    expect(PROMPTS_SCENE.instructionsFor(criticById("prosecutor"))).not.toContain(PROSECUTOR_STANCE);
    expect(PROMPTS_SCENE.instructionsFor(criticById("hr"))).toBe(PROMPTS.instructionsFor(criticById("hr")));
  });

  it("wypowiedzi pod dymek: limity dlugosci, zwrot do krytyka, sentencja sedziego", () => {
    expect(SCENE_DEBATE_ASK).toContain("najwyżej 350 znaków");
    expect(SCENE_DEBATE_ASK).toContain("po nazwie");
    expect(SCENE_PROSECUTION_ASK).toContain("najwyżej 600 znaków");
    expect(SCENE_JUDGE_ASK).toContain("sentencji");
  });

  it("zadanie bez oczekiwanego zakonczenia: blad, a nie cicha zmiana srodka promptu", () => {
    expect(replaceEnding("abc koniec", "koniec", "nowy")).toBe("abc nowy");
    expect(() => replaceEnding("koniec abc", "koniec", "nowy")).toThrow("Zadanie nie konczy sie poleceniem: koniec");
  });
});
