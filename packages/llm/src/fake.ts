import { type LlmClient, type LlmResult, parseOutput, type StructuredRequest } from "./client.js";
import { costNanoUsd, type TokenUsage } from "./pricing.js";

/** Surowy tekst odpowiedzi (np. zly JSON), w odroznieniu od danych, ktore atrapa zserializuje. */
export class RawOutput {
  constructor(readonly text: string) {}
}

export const raw = (text: string) => new RawOutput(text);

/** Odpowiedz atrapy: dane (przejda przez schemat) albo raw("..."). Rzucony blad symuluje awarie. */
export type FakeScript = (request: StructuredRequest<unknown>, callIndex: number) => unknown;

export const FAKE_USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 };

/**
 * Model do testow: bez sieci, deterministyczny, zapisuje zapytania. Odpowiedz przechodzi przez
 * ten sam schemat co odpowiedz Claude'a, wiec test z atrapa lapie tez bledy ksztaltu danych.
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: StructuredRequest<unknown>[] = [];

  constructor(
    private readonly script: FakeScript,
    private readonly usage: TokenUsage = FAKE_USAGE,
  ) {}

  generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    // Wyjatek rzucony w funkcji przekazanej do new Promise staje sie odrzuceniem obietnicy.
    return new Promise((resolve) => {
      signal?.throwIfAborted();
      const reply = this.script(request, this.calls.push(request) - 1);
      const text = reply instanceof RawOutput ? reply.text : JSON.stringify(reply);
      const data = parseOutput(text, request.schema, request.model, this.usage);
      resolve({
        data,
        model: request.model,
        usage: this.usage,
        costNanoUsd: costNanoUsd(request.model, this.usage),
        requestId: null,
        durationMs: 0,
      });
    });
  }
}

/** Skrypt z odpowiedziami po etykiecie zapytania; brak etykiety to blad testu, nie cisza. */
export function byLabel(replies: Readonly<Record<string, unknown>>): FakeScript {
  return (request) => {
    if (!Object.hasOwn(replies, request.label)) {
      throw new Error(`Atrapa nie zna odpowiedzi dla "${request.label}"`);
    }
    return replies[request.label];
  };
}
