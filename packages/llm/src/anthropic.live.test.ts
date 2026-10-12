import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlmClient } from "./anthropic.js";
import type { StructuredRequest } from "./client.js";

/**
 * Test na prawdziwym API — uruchamia sie tylko z kluczem (ANTHROPIC_API_KEY), w CI jest pomijany.
 * Najtanszy model, kilka groszy. Sprawdza to, czego atrapa nie sprawdzi: ze API przyjmuje nasze
 * zapytanie, zwraca JSON zgodny ze schematem i ze drugie zapytanie z tym samym poczatkiem trafia
 * w cache (poczatek musi miec min. 512 tokenow).
 */
const apiKey = process.env.ANTHROPIC_API_KEY;

const Verdict = z.object({ decision: z.enum(["invite", "reject"]), reason: z.string().min(1).max(300) });

const sharedContext = [
  "Jestes czlonkiem trybunalu oceniajacego CV pod konkretna oferte pracy.",
  "CV kandydata:",
  ...Array.from({ length: 60 }, (_, i) => `- Projekt ${String(i + 1)}: backend w Javie i TypeScripcie, testy mutacyjne, CI.`),
  "Oferta: Junior Backend Developer (Java, Spring, PostgreSQL).",
].join("\n");

const request = (task: string): StructuredRequest<z.infer<typeof Verdict>> => ({
  label: "live",
  model: "claude-haiku-5-5",
  maxTokens: 300,
  sharedContext,
  instructions: "Jestes rekruterem HR. Odpowiadasz krotko.",
  task,
  schema: Verdict,
});

describe.skipIf(apiKey === undefined)("AnthropicLlmClient na prawdziwym API", () => {
  it("zwraca odpowiedz zgodna ze schematem, a drugie zapytanie czyta poczatek z cache", async () => {
    const llm = AnthropicLlmClient.fromApiKey(apiKey ?? "");
    const first = await llm.generate(request("Czy zaprosic kandydata? Uzasadnij jednym zdaniem."));
    expect(["invite", "reject"]).toContain(first.data.decision);
    expect(first.costNanoUsd).toBeGreaterThan(0);

    const second = await llm.generate(request("Jaka jest najwieksza slabosc tego CV? Jednym zdaniem."));
    expect(second.usage.cacheReadTokens).toBeGreaterThan(0);
  }, 60_000);
});
