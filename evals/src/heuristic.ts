import { CRITIC_IDS, type CriticId } from "@trybunal/domain";
import { type FakeScript, FakeLlmClient } from "@trybunal/llm";

/**
 * Punkt odniesienia bez modelu: kazdy krytyk liczy tylko, ile slow kluczowych z wymagan oferty
 * pada w CV. Tak dziala najprostszy filtr ATS. Ewaluacja tej heurystyki pokazuje, ile wnosi
 * rozprawa LLM ponad liczenie slow — i dziala w CI bez klucza API, sprawdzajac caly potok.
 */

/** Slowa z punktow listy oferty, ktore wygladaja na nazwy technologii: wielka litera, cyfra, + albo #. */
export function offerKeywords(offer: string): string[] {
  const bullets = offer.split("\n").filter((line) => /^\s*[-*]\s/.test(line));
  const words = bullets.flatMap((line) => line.match(/[\p{L}\d][\p{L}\d+#.]*/gu) ?? []).map((w) => w.replace(/\.+$/, ""));
  return [...new Set(words.filter((w) => w.length >= 2 && /[\p{Lu}\d+#]/u.test(w)).map((w) => w.toLowerCase()))];
}

/** Czesc slow kluczowych obecnych w CV (bez wielkosci liter, jako cale slowa). 0 bez slow kluczowych. */
export function keywordCoverage(cv: string, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const words = new Set((cv.match(/[\p{L}\d][\p{L}\d+#.]*/gu) ?? []).map((w) => w.replace(/\.+$/, "").toLowerCase()));
  return keywords.filter((k) => words.has(k)).length / keywords.length;
}

/** Krytycy roznia sie surowoscia o staly krok; prokurator zawsze najsurowszy. */
const OFFSET: Readonly<Record<CriticId, number>> = { ats: 0, hr: 1, techLead: -1, hiringManager: 0, prosecutor: -3 };
const clampScore = (score: number) => Math.min(10, Math.max(1, Math.round(score)));

export function heuristicScore(coverage: number, criticId: CriticId): number {
  return clampScore(1 + 9 * coverage + OFFSET[criticId]);
}

export const heuristicScript: FakeScript = (request) => {
  const text = (name: string) => request.documents.find((d) => d.name === name)?.text ?? "";
  const coverage = keywordCoverage(text("cv"), offerKeywords(text("oferta")));
  const critic = CRITIC_IDS.find((id) => request.label === `assessment:${id}`);
  if (critic !== undefined) {
    return {
      score: heuristicScore(coverage, critic),
      summary: `Heurystyka: ${String(Math.round(coverage * 100))}% słów kluczowych z oferty.`,
      strengths: [],
      concerns: [],
      rewrites: [],
    };
  }
  if (request.label === "prosecution") return { speech: "Heurystyka nie wygłasza mowy oskarżenia." };
  if (request.label.startsWith("statement:")) return { statement: "Heurystyka podtrzymuje ocenę.", revisedScore: null };
  return { justification: "Werdykt z heurystyki słów kluczowych." };
};

/** Heurystyka nic nie kosztuje i nie zuzywa tokenow — raport nie pokaze zmyslonego kosztu. */
export const heuristicLlm = () =>
  new FakeLlmClient(heuristicScript, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });
