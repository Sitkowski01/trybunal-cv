import type { TrialRun } from "@trybunal/court";
import { CRITIC_IDS, currentScores, initialScores, ScoreSchema } from "@trybunal/domain";
import { z } from "zod";
import { DecisionSchema, type EvalCase, TAGS } from "./dataset.js";

/**
 * Wynik jednej rozprawy w ewaluacji — tylko to, czego potrzebuja metryki. Zapisywany wiersz po
 * wierszu (JSONL) zaraz po rozprawie: przerwany przebieg da sie wznowic bez placenia drugi raz,
 * a raport odtworzyc z pliku bez klucza API.
 */
const count = z.number().int().min(0);
const ScoresSchema = z.record(z.enum(CRITIC_IDS), ScoreSchema);

export const OutcomeSchema = z.strictObject({
  caseId: z.string().min(1),
  variant: z.string().min(1),
  repeat: count,
  expected: DecisionSchema,
  tags: z.array(z.enum(TAGS)),
  /** null: rozprawa przerwana (budzet, odmowa modelu, brak poprawnej odpowiedzi). */
  decision: DecisionSchema.nullable(),
  abortReason: z.string().nullable(),
  juryAverage: z.number().nullable(),
  initialScores: ScoresSchema.nullable(),
  finalScores: ScoresSchema.nullable(),
  costNanoUsd: count,
  attempts: count,
  failedAttempts: count,
  inputTokens: count,
  outputTokens: count,
  cacheWriteTokens: count,
  cacheReadTokens: count,
});

export type TrialOutcome = z.infer<typeof OutcomeSchema>;

/** Klucz przebiegu: ten sam przypadek, wariant i powtorzenie liczymy raz. */
export const outcomeKey = (o: Pick<TrialOutcome, "caseId" | "variant" | "repeat">) => `${o.variant}/${o.caseId}/${String(o.repeat)}`;

export function toOutcome(evalCase: EvalCase, variant: string, repeat: number, run: TrialRun): TrialOutcome {
  const { state, calls } = run;
  const verdict = state.verdict;
  const sum = (pick: (u: NonNullable<(typeof calls)[number]["usage"]>) => number) => calls.reduce((s, c) => s + (c.usage === null ? 0 : pick(c.usage)), 0);
  return {
    caseId: evalCase.id,
    variant,
    repeat,
    expected: evalCase.expected,
    tags: [...evalCase.tags],
    decision: verdict?.decision ?? null,
    abortReason: state.abortReason,
    juryAverage: verdict?.juryAverage ?? null,
    initialScores: verdict === null ? null : initialScores(state),
    finalScores: verdict === null ? null : currentScores(state),
    costNanoUsd: calls.reduce((s, c) => s + c.costNanoUsd, 0),
    attempts: calls.length,
    failedAttempts: calls.filter((c) => c.outcome !== "ok").length,
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    cacheWriteTokens: sum((u) => u.cacheWriteTokens),
    cacheReadTokens: sum((u) => u.cacheReadTokens),
  };
}

/**
 * Plik JSONL z wynikami; puste linie pomijane. Ostatni wiersz bez znaku konca linii to zapis
 * urwany przez zabicie procesu — pomijamy go, a wznowienie powtorzy te rozprawe.
 */
export function parseOutcomes(text: string): TrialOutcome[] {
  const lines = text.split("\n");
  if (!text.endsWith("\n")) lines.pop();
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (error) {
      throw new Error(`Wiersz ${String(index + 1)}: ${(error as Error).message}`, { cause: error });
    }
    const parsed = OutcomeSchema.safeParse(json);
    if (!parsed.success) throw new Error(`Wiersz ${String(index + 1)}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return [parsed.data];
  });
}

/** Powtorzona rozprawa (--retry-aborted) zastepuje wczesniejszy wynik o tym samym kluczu. */
export function latestOutcomes(outcomes: readonly TrialOutcome[]): TrialOutcome[] {
  return [...new Map(outcomes.map((o) => [outcomeKey(o), o])).values()];
}

/** Oczekiwany werdykt i tagi z biezacego zbioru — poprawiona etykieta dziala bez powtarzania rozpraw. */
export function relabel(outcomes: readonly TrialOutcome[], cases: readonly EvalCase[]): TrialOutcome[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return outcomes.map((o) => {
    const c = byId.get(o.caseId);
    return c === undefined ? o : { ...o, expected: c.expected, tags: [...c.tags] };
  });
}
