import {
  IncompleteOutputError,
  InvalidOutputError,
  type LlmClient,
  LlmError,
  LlmTransportError,
  type ModelId,
  type StructuredRequest,
} from "@trybunal/llm";

/** Jedna proba zapytania — do raportu kosztow i do ewaluacji. */
export interface CallRecord {
  readonly label: string;
  readonly attempt: number;
  readonly model: ModelId;
  readonly outcome: "ok" | "invalid" | "incomplete" | "transport";
  readonly costNanoUsd: number;
  readonly durationMs: number;
}

export interface AskOptions<T> {
  readonly maxAttempts: number;
  readonly signal?: AbortSignal;
  readonly sleep: (ms: number) => Promise<void>;
  readonly record: (call: CallRecord) => void;
  /** Reguly, ktorych schemat nie wyrazi (np. cytat musi byc w CV). Pusta lista = odpowiedz przyjeta. */
  readonly validate?: (data: T) => readonly string[];
}

export class StepFailedError extends Error {
  override readonly name = "StepFailedError";

  constructor(
    readonly label: string,
    readonly attempts: number,
    readonly lastProblem: string,
  ) {
    super(`${label}: brak poprawnej odpowiedzi po ${String(attempts)} probach (${lastProblem})`);
  }
}

/** Czekanie miedzy probami przy przeciazeniu API: 1 s, 2 s, 4 s... chyba ze API powie inaczej. */
export const backoffMs = (attempt: number) => 1000 * 2 ** (attempt - 1);

/**
 * Pyta model, az dostanie odpowiedz zgodna ze schematem i regulami, albo skoncza sie proby:
 * - zla odpowiedz (schemat, zmyslony cytat) -> ponowienie z informacja zwrotna dla modelu,
 * - "max_tokens" -> ponowienie z dwa razy wiekszym limitem, odmowa modelu -> koniec,
 * - przeciazenie API (retryable) -> odczekanie i ponowienie, inny blad transportu -> koniec.
 * Kazda proba przechodzi przez klienta (a wiec przez budzet), kazda trafia do rejestru.
 */
export async function ask<T>(llm: LlmClient, request: StructuredRequest<T>, options: AskOptions<T>): Promise<T> {
  let current = request;
  let lastProblem = "";
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const base = { label: request.label, attempt, model: current.model };
    try {
      const result = await llm.generate(current, options.signal);
      options.record({ ...base, outcome: "ok", costNanoUsd: result.costNanoUsd, durationMs: result.durationMs });
      const problems = options.validate?.(result.data) ?? [];
      if (problems.length === 0) {
        return result.data;
      }
      lastProblem = problems.join("; ");
      current = { ...current, retry: { previousOutput: JSON.stringify(result.data), problems } };
    } catch (error) {
      if (error instanceof LlmError) {
        const outcome = error instanceof IncompleteOutputError ? "incomplete" : "invalid";
        options.record({ ...base, outcome, costNanoUsd: error.costNanoUsd, durationMs: 0 });
      } else if (error instanceof LlmTransportError) {
        options.record({ ...base, outcome: "transport", costNanoUsd: 0, durationMs: 0 });
      }
      if (error instanceof InvalidOutputError) {
        current = { ...current, retry: { previousOutput: error.rawOutput, problems: error.problems } };
      } else if (error instanceof IncompleteOutputError && error.stopReason === "max_tokens") {
        current = { ...current, maxTokens: current.maxTokens * 2 };
      } else if (error instanceof LlmTransportError && error.retryable) {
        if (attempt < options.maxAttempts) {
          await options.sleep(error.retryAfterMs ?? backoffMs(attempt));
        }
      } else {
        throw error;
      }
      lastProblem = error.message;
    }
  }
  throw new StepFailedError(request.label, options.maxAttempts, lastProblem);
}
