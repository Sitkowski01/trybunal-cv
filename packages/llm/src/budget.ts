import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type LlmClient, LlmError, type LlmResult, LlmTransportError, type StructuredRequest } from "./client.js";
import { costNanoUsd, formatUsd } from "./pricing.js";

export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";

  constructor(
    readonly spentNanoUsd: number,
    readonly reservedNanoUsd: number,
    readonly neededNanoUsd: number,
    readonly limitNanoUsd: number,
  ) {
    super(
      `Budzet ${formatUsd(limitNanoUsd)}: wydano ${formatUsd(spentNanoUsd)}, zarezerwowano ` +
        `${formatUsd(reservedNanoUsd)}, zapytanie moze kosztowac do ${formatUsd(neededNanoUsd)}`,
    );
  }
}

/** Zapas na tokeny, ktorych nie widac w tekscie: znaczniki rol, tagi dokumentow, opakowanie formatu. */
export const OVERHEAD_TOKENS = 1000;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/**
 * Najdrozszy mozliwy koszt zapytania, zanim je wyslemy:
 * - tokenizer dzieli bajty UTF-8, wiec tokenow wejscia nie ma wiecej niz bajtow tekstu i schematu;
 * - kazdy token wejscia liczymy po stawce zapisu do cache (1,25x zwyklego wejscia) — to najdrozsza
 *   stawka wejscia, a poczatek promptu przy chybionym cache naprawde jest zapisywany;
 * - wyjscia nie wiecej niz maxTokens.
 */
export function worstCaseCostNanoUsd(request: StructuredRequest<unknown>): number {
  const texts = [
    request.rules,
    ...request.documents.flatMap((d) => [d.name, d.text]),
    request.instructions,
    request.task,
    request.retry?.previousOutput ?? "",
    ...(request.retry?.problems ?? []),
    JSON.stringify(zodOutputFormat(request.schema).schema),
  ];
  const promptTokens = texts.reduce((sum, t) => sum + bytes(t), 0) + OVERHEAD_TOKENS;
  return costNanoUsd(request.model, {
    inputTokens: 0,
    cacheWriteTokens: promptTokens,
    cacheReadTokens: 0,
    outputTokens: request.maxTokens,
  });
}

/**
 * Twardy limit kosztu, np. jednej rozprawy. Przed zapytaniem rezerwuje najgorszy koszt — pieciu
 * krytykow pytajacych naraz nie przebije limitu, bo kazdy widzi rezerwacje pozostalych.
 * Po zapytaniu rozlicza:
 * - odpowiedz (takze odrzucona przez schemat) — koszt faktyczny z liczby tokenow;
 * - brak odpowiedzi, ktory mogl kosztowac (przerwanie, timeout, 5xx) albo nieznany blad — cala
 *   rezerwacje, bo zuzycia nie znamy, a limit ma byc twardy;
 * - odmowe API przed praca modelu (429, 529, inne 4xx) — zero.
 */
export class BudgetedLlmClient implements LlmClient {
  private spent = 0;
  private reserved = 0;

  constructor(
    private readonly inner: LlmClient,
    readonly limitNanoUsd: number,
  ) {}

  get spentNanoUsd(): number {
    return this.spent;
  }

  async generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    const worst = worstCaseCostNanoUsd(request);
    if (this.spent + this.reserved + worst > this.limitNanoUsd) {
      throw new BudgetExceededError(this.spent, this.reserved, worst, this.limitNanoUsd);
    }
    this.reserved += worst;
    try {
      const result = await this.inner.generate(request, signal);
      this.spent += result.costNanoUsd;
      return result;
    } catch (error) {
      const charge = chargeFor(error, worst);
      this.spent += charge;
      // Rejestr wywolan (a z niego dzienny limit) musi zobaczyc te sama kwote co budzet rozprawy.
      throw error instanceof LlmTransportError && charge > 0 ? error.charged(charge) : error;
    } finally {
      this.reserved -= worst;
    }
  }
}

function chargeFor(error: unknown, worst: number): number {
  if (error instanceof LlmError) {
    return error.costNanoUsd;
  }
  if (error instanceof LlmTransportError && !error.mayHaveBeenBilled) {
    return 0;
  }
  return worst;
}
