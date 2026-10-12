import { z } from "zod";
import {
  IncompleteOutputError,
  InvalidOutputError,
  type LlmClient,
  type LlmResult,
  parseOutput,
  type StructuredRequest,
} from "./client.js";
import { isModelId, type ModelId } from "./pricing.js";

/**
 * Nagranie rozmowy z modelem ("kaseta"). Raz nagrana prawdziwa rozprawa sluzy potem jako demo
 * bez serwera, test e2e na prawdziwych odpowiedziach i punkt odniesienia w ewaluacjach.
 * Zapisujemy tez nieudane odpowiedzi — powtorka ma pokazac ponowienia i prawdziwy koszt.
 * Odpowiedzi cytuja CV, wiec do demo nagrywamy tylko fikcyjne CV.
 */
const count = z.number().int().min(0);
const common = {
  label: z.string().min(1),
  model: z.string().refine(isModelId, { message: "Nieznany model" }),
  usage: z.object({ inputTokens: count, outputTokens: count, cacheWriteTokens: count, cacheReadTokens: count }),
  costNanoUsd: count,
};

export const CassetteEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), ...common, data: z.unknown(), requestId: z.string().nullable(), durationMs: count }),
  z.object({ kind: z.literal("invalid"), ...common, problems: z.array(z.string()), rawOutput: z.string() }),
  z.object({ kind: z.literal("incomplete"), ...common, stopReason: z.string() }),
]);

export const CassetteSchema = z.array(CassetteEntrySchema);
export type CassetteEntry = z.infer<typeof CassetteEntrySchema>;

/** Przepuszcza zapytania do prawdziwego modelu i zapisuje odpowiedzi — udane i odrzucone. */
export class RecordingLlmClient implements LlmClient {
  private readonly entries: CassetteEntry[] = [];

  constructor(private readonly inner: LlmClient) {}

  async generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    const label = request.label;
    try {
      const result = await this.inner.generate(request, signal);
      this.entries.push({ kind: "ok", label, ...result });
      return result;
    } catch (error) {
      if (error instanceof InvalidOutputError) {
        const { model, usage, costNanoUsd, problems, rawOutput } = error;
        this.entries.push({ kind: "invalid", label, model, usage, costNanoUsd, problems: [...problems], rawOutput });
      } else if (error instanceof IncompleteOutputError) {
        const { model, usage, costNanoUsd, stopReason } = error;
        this.entries.push({ kind: "incomplete", label, model, usage, costNanoUsd, stopReason });
      }
      throw error;
    }
  }

  cassette(): readonly CassetteEntry[] {
    return [...this.entries];
  }
}

/**
 * Odtwarza nagranie: dla kazdej etykiety kolejne odpowiedzi w nagranej kolejnosci (rownolegli
 * krytycy maja rozne etykiety, wiec kolejnosc miedzy nimi nie ma znaczenia). Odrzucone odpowiedzi
 * wracaja jako te same bledy. Dane przechodza przez schemat zapytania, a nagranie innym modelem
 * to blad — stara kaseta po zmianie schematu albo modelu nie przejdzie po cichu.
 */
export class ReplayLlmClient implements LlmClient {
  private readonly queues = new Map<string, CassetteEntry[]>();

  constructor(cassette: readonly CassetteEntry[]) {
    for (const entry of cassette) {
      const queue = this.queues.get(entry.label) ?? [];
      queue.push(entry);
      this.queues.set(entry.label, queue);
    }
  }

  generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    // Wyjatek rzucony w funkcji przekazanej do new Promise staje sie odrzuceniem obietnicy.
    return new Promise((resolve) => {
      signal?.throwIfAborted();
      const entry = this.queues.get(request.label)?.shift();
      if (entry === undefined) {
        throw new Error(`Nagranie nie ma (wiecej) odpowiedzi dla "${request.label}"`);
      }
      if (entry.model !== request.model) {
        throw new Error(`Nagranie "${request.label}" zrobiono modelem ${entry.model}, a nie ${request.model}`);
      }
      const model: ModelId = request.model;
      if (entry.kind === "invalid") {
        throw new InvalidOutputError(entry.problems, entry.rawOutput, model, entry.usage);
      }
      if (entry.kind === "incomplete") {
        throw new IncompleteOutputError(entry.stopReason, model, entry.usage);
      }
      const data = parseOutput(JSON.stringify(entry.data), request.schema, model, entry.usage);
      const { usage, costNanoUsd, requestId, durationMs } = entry;
      resolve({ data, model, usage, costNanoUsd, requestId, durationMs });
    });
  }
}
