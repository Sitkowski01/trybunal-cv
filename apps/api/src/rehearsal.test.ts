import { runTrial } from "@trybunal/court";
import { describe, expect, it } from "vitest";
import { rehearsalLlm } from "./rehearsal.js";

describe("proba generalna", () => {
  it("pelna rozprawa bez modelu: rozne oceny, zmiana zdania Tech Leada, zaproszenie", async () => {
    const run = await runTrial({ trialId: "t", cvText: "Java", jobOffer: "Java", debateRounds: 2 }, { llm: rehearsalLlm() });
    expect(run.state.phase).toBe("closed");
    expect(Object.fromEntries(run.state.assessments.map((a) => [a.criticId, a.score]))).toEqual({ ats: 7, hr: 6, techLead: 5, hiringManager: 7, prosecutor: 3 });
    expect(run.state.assessments.every((a) => a.strengths.length === 1 && a.summary.includes(a.criticId))).toBe(true);
    expect(run.state.verdict).toMatchObject({ decision: "invite", mindChanges: [{ criticId: "techLead", from: 5, to: 6 }] });
    // Zmiana zdania tylko raz: w drugiej rundzie Tech Lead juz podtrzymuje.
    expect(run.state.statements.filter((s) => s.revisedScore !== null)).toHaveLength(1);
    expect(run.state.prosecution).toMatch(/odrzucenie/u);
  });
});
