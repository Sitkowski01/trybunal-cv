import { runTrial } from "@trybunal/court";
import { FakeLlmClient, type FakeScript, LlmTransportError, raw } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { heuristicScript } from "./heuristic.js";
import { latestOutcomes, OutcomeSchema, outcomeKey, parseOutcomes, relabel, toOutcome } from "./outcome.js";
import { evalCase, outcome } from "./test/fixtures.js";

const usage = { inputTokens: 100, outputTokens: 20, cacheWriteTokens: 30, cacheReadTokens: 40 };
const c = evalCase({ id: "c7", expected: "reject", tags: ["ats", "slabe"] });
const trial = (script: FakeScript, debateRounds = 1) =>
  runTrial({ trialId: "t", cvText: c.cvText, jobOffer: c.offerText, debateRounds }, { llm: new FakeLlmClient(script, usage), sleep: () => Promise.resolve() });

describe("toOutcome", () => {
  it("zakonczona rozprawa: werdykt, oceny przed i po debacie, tokeny i koszt ze wszystkich prob", async () => {
    // HR raz odpowiada zlym JSON-em, a w debacie zmienia ocene.
    let broken = false;
    const script: FakeScript = (req, i) => {
      if (req.label === "assessment:hr" && !broken) {
        broken = true;
        return raw("{");
      }
      if (req.label === "statement:1:hr") return { statement: "Zmieniam", revisedScore: 9 };
      return heuristicScript(req, i);
    };
    const run = await trial(script);
    const o = toOutcome(c, "v2", 3, run);
    expect(o).toMatchObject({
      caseId: "c7",
      variant: "v2",
      repeat: 3,
      expected: "reject",
      tags: ["ats", "slabe"],
      decision: run.state.verdict?.decision,
      abortReason: null,
      juryAverage: run.state.verdict?.juryAverage,
      attempts: 13,
      failedAttempts: 1,
      inputTokens: 1300,
      outputTokens: 260,
      cacheWriteTokens: 390,
      cacheReadTokens: 520,
      costNanoUsd: run.calls.reduce((s, call) => s + call.costNanoUsd, 0),
    });
    expect(o.costNanoUsd).toBeGreaterThan(0);
    expect(o.initialScores?.hr).toBe(10);
    expect(o.finalScores?.hr).toBe(9);
    expect(OutcomeSchema.parse(o)).toEqual(o);
  });

  it("przerwana rozprawa: bez werdyktu i ocen, z powodem i kosztem prob", async () => {
    const run = await trial((req, i) => (req.label === "prosecution" ? raw("zle") : heuristicScript(req, i)));
    const o = toOutcome(c, "v1", 0, run);
    expect(o).toMatchObject({ decision: null, juryAverage: null, initialScores: null, finalScores: null, failedAttempts: 3 });
    expect(o.abortReason).toContain("prosecution");
    expect(o.costNanoUsd).toBeGreaterThan(0);
  });

  it("proba bez odpowiedzi (np. przeciazenie) nie ma zuzycia tokenow i nie psuje sum", async () => {
    let failed = false;
    const run = await trial((req, i) => {
      if (req.label === "prosecution" && !failed) {
        failed = true;
        throw new LlmTransportError("529", true, false, 529, 0);
      }
      return heuristicScript(req, i);
    }, 0);
    const o = toOutcome(c, "v1", 0, run);
    expect(run.calls.some((call) => call.usage === null)).toBe(true);
    expect(o.inputTokens).toBe(100 * run.calls.filter((call) => call.usage !== null).length);
  });
});

describe("outcomeKey i parseOutcomes", () => {
  it("klucz z wariantu, przypadku i powtorzenia", () => {
    expect(outcomeKey({ caseId: "a", variant: "v1", repeat: 2 })).toBe("v1/a/2");
  });

  it("czyta JSONL, pomija puste linie i wskazuje zly wiersz po numerze w pliku", () => {
    const line = JSON.stringify(outcome());
    expect(parseOutcomes(`${line}\n\n${line}\n`)).toEqual([outcome(), outcome()]);
    expect(parseOutcomes("")).toEqual([]);
    expect(() => parseOutcomes(`${line}\n\n${JSON.stringify({ ...outcome(), decision: "maybe" })}\n`)).toThrow(/^Wiersz 3: /);
    expect(() => parseOutcomes(`${JSON.stringify({ ...outcome(), extra: 1 })}\n`)).toThrow("Wiersz 1");
    expect(() => parseOutcomes(`${line}\n{zly json\n`)).toThrow(/^Wiersz 2: .*JSON/);
    expect(parseOutcomes(`${line}\n   \n`)).toEqual([outcome()]);
    // Dwa bledy w jednym wierszu — oba w komunikacie.
    expect(() => parseOutcomes(`${JSON.stringify({ ...outcome(), decision: "maybe", repeat: -1 })}\n`)).toThrow(/^Wiersz 1: Too small: .+; Invalid option: .+/);
  });

  it("blad skladni JSON niesie oryginalny wyjatek jako przyczyne", () => {
    let caught: unknown;
    try {
      parseOutcomes("{\n");
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("urwany ostatni wiersz (zabity proces) pomijany — wznowienie powtorzy te rozprawe", () => {
    const line = JSON.stringify(outcome());
    expect(parseOutcomes(`${line}\n${line.slice(0, 20)}`)).toEqual([outcome()]);
    expect(parseOutcomes(line)).toEqual([]);
    expect(parseOutcomes(`\n${line}`)).toEqual([]);
  });
});

describe("latestOutcomes i relabel", () => {
  it("pozniejszy wynik o tym samym kluczu zastepuje wczesniejszy", () => {
    const first = outcome({ decision: null });
    const other = outcome({ caseId: "c2" });
    const retried = outcome({ decision: "reject" });
    expect(latestOutcomes([first, other, retried])).toEqual([retried, other]);
  });

  it("oczekiwany werdykt i tagi z biezacego zbioru; przypadek spoza zbioru bez zmian", () => {
    const fixed = evalCase({ id: "c1", expected: "reject", tags: ["graniczny"] });
    const gone = outcome({ caseId: "usuniety" });
    expect(relabel([outcome(), gone], [fixed])).toEqual([outcome({ expected: "reject", tags: ["graniczny"] }), gone]);
  });
});
