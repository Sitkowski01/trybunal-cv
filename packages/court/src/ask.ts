import {
  IncompleteOutputError,
  InvalidOutputError,
  type LlmClient,
  LlmError,
  LlmTransportError,
  type ModelId,
  type StructuredRequest,
  type TokenUsage,
} from "@trybunal/llm";

/**
 * Jedna proba zapytania — do raportu kosztow i ewaluacji. "rejected": odpowiedz zgodna ze schematem,
 * ale odrzucona przez regule (np. zmyslony cytat). Zuzycie tokenow (z cache) pokazuje, czy cache dziala.
 */
export interface CallRecord {
  readonly label: string;
  readonly attempt: number;
  readonly model: ModelId;
  readonly outcome: "ok" | "rejected" | "invalid" | "incomplete" | "transport";
  readonly usage: TokenUsage | null;
  readonly costNanoUsd: number;
  /** false: brak odpowiedzi, ktory mogl kosztowac — costNanoUsd to najgorszy przypadek policzony przez budzet. */
  readonly costKnown: boolean;
  readonly durationMs: number;
}

export interface AskOptions<T> {
  readonly maxAttempts: number;
  readonly signal?: AbortSignal;
  /** Czekanie przerywane sygnalem — anulowana rozprawa nie dosypia do konca. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
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
/** Gorna granica czekania, nawet gdy API kaze dluzej — wtedy lepiej przerwac niz wisiec. */
export const MAX_WAIT_MS = 30_000;
/** Sufit podwajania limitu tokenow: dalej to juz nie urwana odpowiedz, tylko zle zadanie. */
export const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Pyta model, az dostanie odpowiedz zgodna ze schematem i regulami, albo skoncza sie proby:
 * - zla odpowiedz (schemat, zmyslony cytat) -> ponowienie z informacja zwrotna dla modelu,
 * - "max_tokens" -> ponowienie z dwa razy wiekszym limitem, odmowa modelu -> koniec,
 * - przeciazenie API (retryable) -> odczekanie i ponowienie, inny blad transportu -> koniec.
 * Kazda proba przechodzi przez klienta (a wiec przez budzet), kazda trafia do rejestru.
 */
export async function ask<T>(llm: LlmClient, request: StructuredRequest<T>, options: AskOptions<T>): Promise<T> {
  let current = request;
  let lastProblem = "nie bylo zadnej proby";
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    // Anulowanie przed kazda proba: zapytanie, ktore nie wyszlo, nie moze trafic do budzetu.
    options.signal?.throwIfAborted();
    const base = { label: request.label, attempt, model: current.model };
    try {
      const result = await llm.generate(current, options.signal);
      const problems = options.validate?.(result.data) ?? [];
      const { usage, costNanoUsd, durationMs } = result;
      const outcome = problems.length === 0 ? "ok" : "rejected";
      options.record({ ...base, outcome, usage, costNanoUsd, costKnown: true, durationMs });
      if (problems.length === 0) {
        return result.data;
      }
      lastProblem = problems.join("; ");
      current = { ...current, retry: { previousOutput: JSON.stringify(result.data), problems } };
    } catch (error) {
      if (error instanceof LlmError) {
        const outcome = error instanceof IncompleteOutputError ? "incomplete" : "invalid";
        options.record({ ...base, outcome, usage: error.usage, costNanoUsd: error.costNanoUsd, costKnown: true, durationMs: 0 });
      } else if (error instanceof LlmTransportError) {
        // Koszt nieznany: liczymy to, co policzyl budzet (najgorszy przypadek), zeby dzienny limit go widzial.
        const costKnown = !error.mayHaveBeenBilled;
        options.record({ ...base, outcome: "transport", usage: null, costNanoUsd: error.chargedNanoUsd, costKnown, durationMs: 0 });
      }
      if (error instanceof InvalidOutputError) {
        current = { ...current, retry: { previousOutput: error.rawOutput, problems: error.problems } };
      } else if (error instanceof IncompleteOutputError && error.stopReason === "max_tokens" && current.maxTokens < MAX_OUTPUT_TOKENS) {
        current = { ...current, maxTokens: Math.min(current.maxTokens * 2, MAX_OUTPUT_TOKENS) };
      } else if (error instanceof LlmTransportError && error.retryable) {
        if (attempt < options.maxAttempts) {
          await options.sleep(Math.min(error.retryAfterMs ?? backoffMs(attempt), MAX_WAIT_MS), options.signal);
        }
      } else {
        throw error;
      }
      lastProblem = error.message;
    }
  }
  throw new StepFailedError(request.label, options.maxAttempts, lastProblem);
}
