import { parseArgs } from "node:util";
import { PROMPTS, type PromptSet } from "@trybunal/court";
import { DEFAULT_VARIANTS, VARIANTS, variantByVersion } from "./variants.js";

export const USAGE = `Uzycie:
  pnpm evals run --out <katalog> [--llm anthropic|heuristic] [--variants v1,v3-scena] [--repeats 3]
                 [--rounds 1] [--cases id,id] [--concurrency 2] [--budget-usd 15] [--trial-budget-usd 1]
                 [--dataset evals/dataset] [--retry-aborted]
  pnpm evals report <katalog>`;

/** Blad wywolania: zle argumenty, pliki albo stan katalogu. Wykryty, zanim zaplacimy za pierwsze zapytanie. */
export class UsageError extends Error {}

export const LLM_KINDS = ["anthropic", "heuristic"] as const;
export type LlmKind = (typeof LLM_KINDS)[number];

/** Heurystyka nie czyta promptow — jej wyniki dostaja wlasna nazwe, zeby nie udawaly wersji v1. */
export const HEURISTIC_VARIANT: PromptSet = { ...PROMPTS, version: "heurystyka" };

export interface RunArgs {
  readonly out: string;
  readonly llm: LlmKind;
  readonly variants: readonly PromptSet[];
  readonly repeats: number;
  readonly debateRounds: number;
  /** null: caly zbior. */
  readonly cases: readonly string[] | null;
  readonly concurrency: number;
  /** Limit calego katalogu wynikow, lacznie z poprzednimi uruchomieniami. */
  readonly totalLimitNanoUsd: number;
  readonly trialLimitNanoUsd: number;
  readonly dataset: string;
  readonly retryAborted: boolean;
}

function positiveInt(value: string, name: string, min: number): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n) || n < min) throw new UsageError(`--${name}: liczba calkowita >= ${String(min)}\n${USAGE}`);
  return n;
}

function usdToNano(value: string, name: string): number {
  const n = Number(value);
  if (!(n > 0)) throw new UsageError(`--${name}: kwota w USD wieksza od zera\n${USAGE}`);
  return Math.round(n * 1e9);
}

function pickVariant(version: string): PromptSet {
  const variant = variantByVersion(version);
  if (variant === undefined) throw new UsageError(`Nieznany wariant: ${version}. Dostepne: ${VARIANTS.map((v) => v.version).join(", ")}`);
  return variant;
}

const isLlmKind = (value: string): value is LlmKind => (LLM_KINDS as readonly string[]).includes(value);

/** Argumenty `pnpm evals run`; kazdy blad to UsageError z podpowiedzia. */
export function parseRunArgs(argv: readonly string[]): RunArgs {
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      options: {
        out: { type: "string" },
        llm: { type: "string", default: "anthropic" },
        variants: { type: "string", default: DEFAULT_VARIANTS.map((v) => v.version).join(",") },
        repeats: { type: "string", default: "3" },
        rounds: { type: "string", default: "1" },
        cases: { type: "string" },
        concurrency: { type: "string", default: "2" },
        "budget-usd": { type: "string", default: "15" },
        "trial-budget-usd": { type: "string", default: "1" },
        dataset: { type: "string", default: "evals/dataset" },
        "retry-aborted": { type: "boolean", default: false },
      },
    }).values;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
  if (args.out === undefined) throw new UsageError(USAGE);
  const llm = args.llm;
  if (!isLlmKind(llm)) throw new UsageError(`--llm: anthropic albo heuristic\n${USAGE}`);
  return {
    out: args.out,
    llm,
    repeats: positiveInt(args.repeats, "repeats", 1),
    debateRounds: positiveInt(args.rounds, "rounds", 0),
    concurrency: positiveInt(args.concurrency, "concurrency", 1),
    totalLimitNanoUsd: usdToNano(args["budget-usd"], "budget-usd"),
    trialLimitNanoUsd: usdToNano(args["trial-budget-usd"], "trial-budget-usd"),
    variants: llm === "heuristic" ? [HEURISTIC_VARIANT] : args.variants.split(",").map((v) => pickVariant(v.trim())),
    cases: args.cases === undefined ? null : args.cases.split(",").map((c) => c.trim()),
    dataset: args.dataset,
    retryAborted: args["retry-aborted"],
  };
}
