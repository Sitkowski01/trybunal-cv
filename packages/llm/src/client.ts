import type { z } from "zod";
import { costNanoUsd, type ModelId, type TokenUsage } from "./pricing.js";

/**
 * Port do modelu jezykowego. Orkiestracja rozprawy zna tylko ten interfejs — w produkcji stoi
 * za nim Claude, w testach atrapa, w demo nagranie. Kazde zapytanie zwraca dane juz sprawdzone
 * schematem i koszt w nanodolarach.
 */
export interface StructuredRequest<T> {
  /** Do logow i kosztow, np. "assessment:hr". */
  readonly label: string;
  readonly model: ModelId;
  readonly maxTokens: number;
  /**
   * Wspolny poczatek promptu dla wszystkich agentow rozprawy (zasady, CV, oferta). Idzie
   * pierwszy i jest oznaczony do cache — kolejni agenci placa za niego ulamek ceny.
   */
  readonly sharedContext: string;
  /** Rola agenta (persona, rubryka) — juz po punkcie cache, bo rozna u kazdego. */
  readonly instructions: string;
  readonly task: string;
  readonly schema: z.ZodType<T>;
}

export interface LlmResult<T> {
  readonly data: T;
  readonly model: ModelId;
  readonly usage: TokenUsage;
  readonly costNanoUsd: number;
}

export interface LlmClient {
  generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>>;
}

/** Blad po stronie modelu. Tokeny i tak zostaly zuzyte, wiec blad niesie ich koszt. */
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

/** Odpowiedz nie jest JSON-em albo nie spelnia schematu — mozna ponowic z informacja, co jest zle. */
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

/** Model skonczyl przez limit tokenow albo odmowe — odpowiedz jest niepelna. */
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

/** Sprawdza surowy tekst odpowiedzi schematem; wspolne dla adaptera Claude i atrapy. */
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
