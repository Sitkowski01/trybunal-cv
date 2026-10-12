import { type LlmClient, type LlmResult, parseOutput, type StructuredRequest } from "./client.js";
import { costNanoUsd, type TokenUsage } from "./pricing.js";

/** Co atrapa ma odpowiedziec na dane zapytanie: dane (przejda przez schemat) albo blad. */
export type FakeReply = unknown;
export type FakeScript = (request: StructuredRequest<unknown>, callIndex: number) => FakeReply;

export const FAKE_USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 };

/**
 * Model do testow: bez sieci, deterministyczny, zapisuje zapytania. Odpowiedz przechodzi przez
 * ten sam schemat co odpowiedz Claude'a, wiec test z atrapa lapie tez bledy ksztaltu danych.
 * Rzucony blad (np. InvalidOutputError) symuluje awarie modelu.
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: StructuredRequest<unknown>[] = [];

  constructor(
    private readonly script: FakeScript,
    private readonly usage: TokenUsage = FAKE_USAGE,
  ) {}

  generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason as Error);
    }
    const index = this.calls.push(request) - 1;
    try {
      const reply = this.script(request, index);
      const raw = typeof reply === "string" ? reply : JSON.stringify(reply);
      const data = parseOutput(raw, request.schema, request.model, this.usage);
      return Promise.resolve({
        data,
        model: request.model,
        usage: this.usage,
        costNanoUsd: costNanoUsd(request.model, this.usage),
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/** Skrypt z odpowiedziami po etykiecie zapytania; brak etykiety to blad testu, nie cisza. */
export function byLabel(replies: Readonly<Record<string, FakeReply>>): FakeScript {
  return (request) => {
    if (!Object.hasOwn(replies, request.label)) {
      throw new Error(`Atrapa nie zna odpowiedzi dla "${request.label}"`);
    }
    return replies[request.label];
  };
}
