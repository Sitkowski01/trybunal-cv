import { CRITIC_IDS } from "@trybunal/domain";
import { isModelId } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { AssessmentOutput, cacheLeader, DEFAULT_CONFIG, JustificationOutput, ProsecutionOutput, StatementOutput } from "./config.js";

describe("DEFAULT_CONFIG", () => {
  it("ATS na najtanszym modelu, uzasadnienie dla kandydata na najmocniejszym", () => {
    expect(DEFAULT_CONFIG.models.assessment.ats).toBe("claude-haiku-5-5");
    expect(DEFAULT_CONFIG.models.justification).toBe("claude-opus-5-5");
  });

  it("kazdy krytyk i kazda faza ma model z cennika", () => {
    const { assessment, ...phases } = DEFAULT_CONFIG.models;
    expect(Object.keys(assessment).sort()).toEqual([...CRITIC_IDS].sort());
    expect([...Object.values(assessment), ...Object.values(phases)].every(isModelId)).toBe(true);
  });

  it("limity tokenow sa dodatnie, a prob wiecej niz jedna", () => {
    const { assessment: perCritic, ...phases } = DEFAULT_CONFIG.maxTokens;
    expect([...Object.values(perCritic), ...Object.values(phases)].every((n) => n > 0)).toBe(true);
    // Bot ATS mysli dluzej — wiekszy limit tylko dla niego.
    expect(perCritic.ats).toBeGreaterThan(perCritic.hr);
    expect(DEFAULT_CONFIG.maxAttempts).toBeGreaterThan(1);
  });
});

describe("cacheLeader", () => {
  it("domyslnie HR: pierwszy przy stole z modelem wiekszosci (Sonnet), a nie ATS na Haiku", () => {
    expect(cacheLeader(DEFAULT_CONFIG.models.assessment)).toBe("hr");
  });

  it("wszyscy na jednym modelu: pierwszy przy stole", () => {
    expect(cacheLeader({ ats: "claude-haiku-5-5", hr: "claude-haiku-5-5", techLead: "claude-haiku-5-5", hiringManager: "claude-haiku-5-5", prosecutor: "claude-haiku-5-5" })).toBe("ats");
  });

  it("remis grup: pierwszy przy stole z najwiekszej grupy", () => {
    const models = { ats: "claude-opus-5-5", hr: "claude-haiku-5-5", techLead: "claude-sonnet-5-5", hiringManager: "claude-haiku-5-5", prosecutor: "claude-sonnet-5-5" } as const;
    expect(cacheLeader(models)).toBe("hr");
  });
});

describe("schematy odpowiedzi modelu", () => {
  it("ocena bez id krytyka — id dopisuje orkiestracja", () => {
    const output = { score: 7, summary: "ok", strengths: [], concerns: [], rewrites: [] };
    expect(AssessmentOutput.parse(output)).toEqual(output);
    expect(AssessmentOutput.parse({ ...output, criticId: "hr" })).not.toHaveProperty("criticId");
  });

  it("wypowiedz w debacie: ocena 1-10 albo null", () => {
    expect(StatementOutput.safeParse({ statement: "x", revisedScore: null }).success).toBe(true);
    expect(StatementOutput.safeParse({ statement: "x", revisedScore: 11 }).success).toBe(false);
    expect(StatementOutput.safeParse({ statement: "", revisedScore: 5 }).success).toBe(false);
  });

  it.each([
    [ProsecutionOutput, "speech", 3000],
    [StatementOutput, "statement", 2000],
    [JustificationOutput, "justification", 3000],
  ] as const)("tekst %#: niepusty i z limitem dlugosci", (schema, field, max) => {
    const base = field === "statement" ? { revisedScore: null } : {};
    expect(schema.safeParse({ ...base, [field]: "x".repeat(max) }).success).toBe(true);
    expect(schema.safeParse({ ...base, [field]: "x".repeat(max + 1) }).success).toBe(false);
    expect(schema.safeParse({ ...base, [field]: " " }).success).toBe(false);
  });
});
