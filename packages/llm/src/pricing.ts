/**
 * Cennik z platform.claude.com/docs/en/about-claude/pricing (stan na 12.10.2026).
 * Stawki w nanodolarach za token = USD za milion tokenow * 1000. Wtedy kazda stawka jest liczba
 * calkowita (odczyt cache Haiku to 10 n$), a koszt to mnozenie liczb calkowitych — bez floatow
 * w pieniadzach. Zapis do cache: stawka 5-minutowa.
 */
export interface Rates {
  readonly input: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  readonly output: number;
}

export interface ModelPricing {
  readonly standard: Rates;
  /** Dluzszy prompt (wejscie lacznie z cache) liczony drozej — tylko Haiku 5.5, powyzej 100 tys. tokenow. */
  readonly longContext?: { readonly aboveInputTokens: number; readonly rates: Rates };
}

export const MODELS = {
  "claude-opus-5-5": { standard: { input: 4000, cacheWrite: 5000, cacheRead: 200, output: 20_000 } },
  "claude-sonnet-5-5": { standard: { input: 2000, cacheWrite: 2500, cacheRead: 100, output: 10_000 } },
  "claude-haiku-5-5": {
    standard: { input: 100, cacheWrite: 125, cacheRead: 10, output: 500 },
    longContext: { aboveInputTokens: 100_000, rates: { input: 500, cacheWrite: 625, cacheRead: 50, output: 2500 } },
  },
} as const satisfies Record<string, ModelPricing>;

export type ModelId = keyof typeof MODELS;

export function isModelId(value: string): value is ModelId {
  return Object.hasOwn(MODELS, value);
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
}

export function totalInputTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
}

function ratesFor(model: ModelId, usage: TokenUsage): Rates {
  const pricing: ModelPricing = MODELS[model];
  const long = pricing.longContext;
  return long !== undefined && totalInputTokens(usage) > long.aboveInputTokens ? long.rates : pricing.standard;
}

export function costNanoUsd(model: ModelId, usage: TokenUsage): number {
  const r = ratesFor(model, usage);
  return (
    usage.inputTokens * r.input +
    usage.cacheWriteTokens * r.cacheWrite +
    usage.cacheReadTokens * r.cacheRead +
    usage.outputTokens * r.output
  );
}

/** Do wyswietlania: 1 234 567 n$ -> "$0.0012" (zaokraglenie w gore, zeby nie zanizac kosztu). */
export function formatUsd(nanoUsd: number): string {
  const tenThousandths = Math.ceil(nanoUsd / 100_000);
  const dollars = Math.floor(tenThousandths / 10_000);
  const rest = String(tenThousandths % 10_000).padStart(4, "0");
  return `$${String(dollars)}.${rest}`;
}
