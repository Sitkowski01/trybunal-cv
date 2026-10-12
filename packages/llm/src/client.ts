import type { z } from "zod";
import { costNanoUsd, type ModelId, type TokenUsage } from "./pricing.js";

/**
 * Port do modelu jezykowego. Orkiestracja rozprawy zna tylko ten interfejs — w produkcji stoi
 * za nim Claude, w testach atrapa, w demo nagranie. Kazde zapytanie zwraca dane juz sprawdzone
 * schematem i koszt w nanodolarach.
 */

/** Dokument od uzytkownika (CV, oferta). Niezaufany: to dane do oceny, nie polecenia. */
export interface SourceDocument {
  /** Krotka nazwa, np. "cv" — male litery, cyfry, myslnik. */
  readonly name: string;
  readonly text: string;
}

/** Poprzednia, odrzucona odpowiedz i powody — model zobaczy je jako swoja wypowiedz i uwagi. */
export interface RetryFeedback {
  readonly previousOutput: string;
  readonly problems: readonly string[];
}

export interface StructuredRequest<T> {
  /** Do logow, kosztow i nagran, np. "assessment:hr". */
  readonly label: string;
  readonly model: ModelId;
  readonly maxTokens: number;
  /** Zaufane zasady, wspolne dla wszystkich agentow rozprawy. */
  readonly rules: string;
  /** Niezaufane dokumenty, wspolne dla wszystkich agentow. Razem z zasadami tworza poczatek do cache. */
  readonly documents: readonly SourceDocument[];
  /** Rola agenta (persona, rubryka) — juz za punktem cache, bo rozna u kazdego. */
  readonly instructions: string;
  readonly task: string;
  readonly retry?: RetryFeedback;
  /** Schemat odpowiedzi; bez .transform(), bo transformacji nie da sie zapisac w JSON Schema. */
  readonly schema: z.ZodType<T>;
}

export interface LlmResult<T> {
  readonly data: T;
  readonly model: ModelId;
  readonly usage: TokenUsage;
  readonly costNanoUsd: number;
  /** Id zapytania po stronie dostawcy — do szukania w logach; atrapa go nie ma. */
  readonly requestId: string | null;
  readonly durationMs: number;
}

export interface LlmClient {
  generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>>;
}

/** Model odpowiedzial, ale odpowiedz jest do niczego. Tokeny zuzyte, wiec blad niesie ich koszt. */
export class LlmError extends Error {
  override readonly name: string = "LlmError";

  constructor(
    message: string,
    readonly model: ModelId,
    readonly usage: TokenUsage,
  ) {
    super(message);
  }

  get costNanoUsd(): number {
    return costNanoUsd(this.model, this.usage);
  }
}

/** Odpowiedz nie jest JSON-em albo nie spelnia schematu — mozna ponowic z RetryFeedback. */
export class InvalidOutputError extends LlmError {
  override readonly name = "InvalidOutputError";

  constructor(
    readonly problems: readonly string[],
    readonly rawOutput: string,
    model: ModelId,
    usage: TokenUsage,
  ) {
    super(`Odpowiedz modelu nie spelnia schematu: ${problems.join("; ")}`, model, usage);
  }
}

/** Model nie skonczyl normalnie: limit tokenow ("max_tokens" — ponow z wiekszym), odmowa ("refusal" — nie ponawiaj). */
export class IncompleteOutputError extends LlmError {
  override readonly name = "IncompleteOutputError";

  constructor(
    readonly stopReason: string,
    model: ModelId,
    usage: TokenUsage,
  ) {
    super(`Odpowiedz modelu przerwana: ${stopReason}`, model, usage);
  }
}

/**
 * Nie dostalismy odpowiedzi: przerwanie, timeout, zerwane polaczenie, odmowa API (429, 5xx).
 * Zuzycia nie znamy. mayHaveBeenBilled mowi, czy zapytanie moglo dojsc do modelu — wtedy
 * budzet zaklada najgorszy koszt.
 */
export class LlmTransportError extends Error {
  override readonly name = "LlmTransportError";

  constructor(
    message: string,
    readonly retryable: boolean,
    readonly mayHaveBeenBilled: boolean,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** Sprawdza surowy tekst odpowiedzi schematem; wspolne dla adaptera Claude i atrap. */
export function parseOutput<T>(raw: string, schema: z.ZodType<T>, model: ModelId, usage: TokenUsage): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new InvalidOutputError(["odpowiedz nie jest poprawnym JSON-em"], raw, model, usage);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(calosc)"}: ${i.message}`);
    throw new InvalidOutputError(problems, raw, model, usage);
  }
  return parsed.data;
}
