import { runTrial } from "@trybunal/court";
import { wordDiff } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { firstQuotableLine, rehearsalLlm, slowRehearsalLlm } from "./rehearsal.js";

const CV = "\n  \n- 12\n## Anna Nowak, backend\nJava, Spring";

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

  it("poprawka Hiring Managera i zastrzezenie Tech Leada cytuja CV - rozprawa je przyjmuje", async () => {
    const run = await runTrial({ trialId: "t", cvText: CV, jobOffer: "Java", debateRounds: 0 }, { llm: rehearsalLlm() });
    const byCritic = Object.fromEntries(run.state.assessments.map((a) => [a.criticId, a]));
    expect(byCritic.techLead?.concerns).toEqual([{ quote: "## Anna Nowak, backend", issue: "Brak projektu, ktory to potwierdza.", severity: "medium" }]);
    const rewrite = byCritic.hiringManager?.rewrites[0];
    expect(rewrite?.original).toBe("## Anna Nowak, backend");
    expect(rewrite?.reason).toBe("Wplyw wyrazony liczba.");
    expect(wordDiff(rewrite?.original ?? "", rewrite?.proposed ?? "").map((p) => p.kind)).toEqual(["same", "added"]);
    expect(run.state.assessments.filter((a) => a.concerns.length + a.rewrites.length > 0)).toHaveLength(2);
  });

  it("CV bez linii z trzema literami: oceny bez cytatow", async () => {
    const run = await runTrial({ trialId: "t", cvText: "C#\n12", jobOffer: "Java", debateRounds: 0 }, { llm: rehearsalLlm() });
    expect(run.state.assessments.every((a) => a.concerns.length === 0 && a.rewrites.length === 0)).toBe(true);
  });

  it("z przerwa odpowiada dopiero po czasie, a anulowanie przerywa czekanie", async () => {
    const llm = slowRehearsalLlm(40)();
    const started = Date.now();
    const run = await runTrial({ trialId: "t", cvText: CV, jobOffer: "Java", debateRounds: 0 }, { llm });
    expect(run.state.phase).toBe("closed");
    // Krytyk-lider, potem czterech naraz, prokurator, sedzia: co najmniej cztery przerwy po kolei.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    const controller = new AbortController();
    const request = { label: "prosecution", model: "claude-haiku-5-5", maxTokens: 10, rules: "", documents: [], instructions: "", task: "", schema: {} as never } as const;
    const pending = llm.generate(request, controller.signal);
    controller.abort(new Error("anulowano"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("firstQuotableLine", () => {
  it.each<[string, string | null]>([
    ["Java", "Java"],
    ["  ab\n  abc  ", "abc"],
    ["C#\n12\n", null],
    ["", null],
    ["ąęł", "ąęł"],
  ])("%j -> %j", (cv, expected) => {
    expect(firstQuotableLine(cv)).toBe(expected);
  });

  it("dluga linie przycina do 120 znakow bez spacji na koncu", () => {
    const line = `${"a".repeat(119)} ${"b".repeat(50)}`;
    expect(firstQuotableLine(line)).toBe("a".repeat(119));
    expect(firstQuotableLine("x".repeat(300))).toHaveLength(120);
  });
});
