import { z } from "zod";
import { type LlmClient, type LlmResult, parseOutput, type StructuredRequest } from "./client.js";
import { isModelId } from "./pricing.js";

/**
 * Nagranie rozmowy z modelem ("kaseta"). Raz nagrana prawdziwa rozprawa sluzy potem jako demo
 * bez serwera, test e2e na prawdziwych odpowiedziach i punkt odniesienia w ewaluacjach.
 */
const count = z.number().int().min(0);

export const CassetteEntrySchema = z.object({
  label: z.string().min(1),
  model: z.string().refine(isModelId, { message: "Nieznany model" }),
  data: z.unknown(),
  requestId: z.string().nullable(),
  durationMs: count,
  usage: z.object({
    inputTokens: count,
    outputTokens: count,
    cacheWriteTokens: count,
    cacheReadTokens: count,
  }),
  costNanoUsd: count,
});

export const CassetteSchema = z.array(CassetteEntrySchema);
export type CassetteEntry = z.infer<typeof CassetteSchema>[number];

/** Przepuszcza zapytania do prawdziwego modelu i zapisuje udane odpowiedzi w kolejnosci. */
export class RecordingLlmClient implements LlmClient {
  private readonly entries: CassetteEntry[] = [];

  constructor(private readonly inner: LlmClient) {}

  async generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    const result = await this.inner.generate(request, signal);
    this.entries.push({ label: request.label, ...result });
    return result;
  }

  cassette(): readonly CassetteEntry[] {
    return [...this.entries];
  }
}

/**
 * Odtwarza nagranie: dla kazdej etykiety kolejne odpowiedzi w tej kolejnosci, w jakiej je
 * nagrano (rownolegli krytycy moga skonczyc w dowolnej kolejnosci, ale etykiety maja rozne).
 * Dane przechodza przez schemat zapytania, wiec stare nagranie po zmianie schematu nie
 * przejdzie po cichu.
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

  generate<T>(request: StructuredRequest<T>): Promise<LlmResult<T>> {
    // Wyjatek rzucony w funkcji przekazanej do new Promise staje sie odrzuceniem obietnicy.
    return new Promise((resolve) => {
      const entry = this.queues.get(request.label)?.shift();
      if (entry === undefined) {
        throw new Error(`Nagranie nie ma (wiecej) odpowiedzi dla "${request.label}"`);
      }
      if (entry.model !== request.model) {
        throw new Error(`Nagranie "${request.label}" zrobiono modelem ${entry.model}, a nie ${request.model}`);
      }
      const data = parseOutput(JSON.stringify(entry.data), request.schema, request.model, entry.usage);
      const { usage, costNanoUsd, requestId, durationMs } = entry;
      resolve({ data, model: request.model, usage, costNanoUsd, requestId, durationMs });
    });
  }
}
