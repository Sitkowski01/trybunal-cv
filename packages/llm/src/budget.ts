import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type LlmClient, LlmError, type LlmResult, type StructuredRequest } from "./client.js";
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

/** Zapas na tokeny, ktorych nie widac w tekscie: znaczniki rol, opakowanie formatu odpowiedzi. */
export const OVERHEAD_TOKENS = 1000;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/**
 * Najdrozszy mozliwy koszt zapytania, zanim je wyslemy. Tokenizer dzieli bajty UTF-8, wiec
 * tokenow wejscia nie ma wiecej niz bajtow promptu i schematu; wyjscia nie wiecej niz maxTokens.
 * Liczymy bez cache — tak, jakby nic nie trafilo.
 */
export function worstCaseCostNanoUsd(request: StructuredRequest<unknown>): number {
  const schema = JSON.stringify(zodOutputFormat(request.schema).schema);
  const prompt = bytes(request.sharedContext) + bytes(request.instructions) + bytes(request.task) + bytes(schema);
  return costNanoUsd(request.model, {
    inputTokens: prompt + OVERHEAD_TOKENS,
    outputTokens: request.maxTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  });
}

/**
 * Twardy limit kosztu, np. jednej rozprawy. Przed zapytaniem rezerwuje najgorszy koszt — pieciu
 * krytykow pytajacych naraz nie przebije limitu, bo kazdy widzi rezerwacje pozostalych. Po
 * odpowiedzi rozlicza koszt faktyczny, takze nieudanej (tokeny zuzyte, odpowiedz do niczego).
 * Anulowane zapytanie nie podaje zuzycia — liczymy je jako zero.
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
      if (error instanceof LlmError) {
        this.spent += error.costNanoUsd;
      }
      throw error;
    } finally {
      this.reserved -= worst;
    }
  }
}
