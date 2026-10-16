import { runTrial } from "@trybunal/court";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { heuristicLlm, heuristicScore, heuristicScript, keywordCoverage, offerKeywords } from "./heuristic.js";

const offer = `Oferta: Junior Java.
Szukamy osoby, która lubi Javę.
## Wymagania
- Java 17 i Spring Boot.
- Testy w JUnit, C# i C++ mile widziane
* Git, REST.
-nie lista
- praca w zespole`;

describe("offerKeywords", () => {
  it("bierze tylko punkty listy i slowa z wielka litera, cyfra, + albo #; bez kropki na koncu i bez powtorzen", () => {
    expect(offerKeywords(offer)).toEqual(["java", "17", "spring", "boot", "testy", "junit", "c#", "c++", "git", "rest"]);
  });

  it("bez listy nie ma slow kluczowych", () => {
    expect(offerKeywords("Java, Spring, SQL")).toEqual([]);
  });

  it("punkt listy tylko na poczatku linii; myslnik w srodku zdania to nie lista", () => {
    expect(offerKeywords("Wymagania - Java\nx- Kotlin\n  * Scala")).toEqual(["scala"]);
  });

  it("kilka kropek na koncu slowa tez odpada", () => {
    expect(offerKeywords("- Spring..")).toEqual(["spring"]);
    expect(keywordCoverage("Znam Spring..", ["spring"])).toBe(1);
  });

  it("pomija jednoznakowe slowa i punkty bez slow", () => {
    expect(offerKeywords("- R oraz Go\n- ...")).toEqual(["go"]);
  });
});

describe("keywordCoverage", () => {
  it("czesc slow kluczowych w CV — cale slowa, bez wielkosci liter i kropki na koncu", () => {
    expect(keywordCoverage("Znam JAVA. Spring Boot.", ["java", "spring", "boot", "kafka"])).toBe(0.75);
    expect(keywordCoverage("Javascript", ["java"])).toBe(0);
    expect(keywordCoverage("C# i C++", ["c#", "c++"])).toBe(1);
  });

  it("bez slow kluczowych pokrycie 0, a nie dzielenie przez zero", () => {
    expect(keywordCoverage("cokolwiek", [])).toBe(0);
    expect(keywordCoverage("...", ["java"])).toBe(0);
  });
});

describe("heuristicScore", () => {
  it("1 + 9 x pokrycie, przesuniete wedlug krytyka i przyciete do skali", () => {
    expect(heuristicScore(0.5, "ats")).toBe(6);
    expect(heuristicScore(0.5, "hr")).toBe(7);
    expect(heuristicScore(0.5, "techLead")).toBe(5);
    expect(heuristicScore(0.5, "hiringManager")).toBe(6);
    expect(heuristicScore(0.5, "prosecutor")).toBe(3);
    expect(heuristicScore(1, "hr")).toBe(10);
    expect(heuristicScore(0, "prosecutor")).toBe(1);
  });
});

describe("heuristicScript", () => {
  it("bez dokumentow CV i oferty ocenia na zero pokrycia", () => {
    const request = { label: "assessment:ats", model: "claude-haiku-5-5", maxTokens: 1, rules: "", documents: [], instructions: "", task: "", schema: z.unknown() } as const;
    expect(heuristicScript(request, 0)).toEqual({ score: 1, summary: "Heurystyka: 0% słów kluczowych z oferty.", strengths: [], concerns: [], rewrites: [] });
  });
});

describe("heuristicLlm", () => {
  it("prowadzi cala rozprawe do werdyktu bez kosztu — pelne CV dostaje zaproszenie, puste odrzucenie", async () => {
    const trial = (cvText: string) => runTrial({ trialId: "h", cvText, jobOffer: offer, debateRounds: 1 }, { llm: heuristicLlm() });
    const strong = await trial("Java 17, Spring Boot, Testy JUnit, C#, C++, Git, REST");
    expect(strong.state.verdict?.decision).toBe("invite");
    expect(strong.calls.every((c) => c.costNanoUsd === 0)).toBe(true);
    expect(strong.state.assessments.find((a) => a.criticId === "ats")?.summary).toBe("Heurystyka: 100% słów kluczowych z oferty.");
    const weak = await trial("Lubię gotować.");
    expect(weak.state).toMatchObject({ phase: "closed", verdict: { decision: "reject", juryAverage: 1.25 } });
    expect(weak.state.prosecution).toBe("Heurystyka nie wygłasza mowy oskarżenia.");
    expect(weak.state.statements.every((s) => s.revisedScore === null && s.statement === "Heurystyka podtrzymuje ocenę.")).toBe(true);
    expect(weak.state.justification).toBe("Werdykt z heurystyki słów kluczowych.");
  });
});
