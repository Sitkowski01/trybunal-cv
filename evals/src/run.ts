import { type CourtConfig, type PromptSet, runTrial } from "@trybunal/court";
import type { LlmClient } from "@trybunal/llm";
import type { EvalCase } from "./dataset.js";
import { outcomeKey, type TrialOutcome, toOutcome } from "./outcome.js";

export interface EvalPlan {
  readonly cases: readonly EvalCase[];
  readonly variants: readonly PromptSet[];
  readonly repeats: number;
  readonly debateRounds: number;
}

export interface EvalJob {
  readonly evalCase: EvalCase;
  readonly prompts: PromptSet;
  readonly repeat: number;
}

/**
 * Kolejnosc rozpraw: najpierw pierwsze powtorzenie wszystkich przypadkow we wszystkich wariantach,
 * potem drugie itd. Przebieg przerwany w polowie (budzet, Ctrl+C) daje porownywalne warianty
 * na pelnym zbiorze, tylko z mniejsza liczba powtorzen.
 */
export function planJobs(plan: EvalPlan): EvalJob[] {
  return Array.from({ length: plan.repeats }, (_, repeat) =>
    plan.cases.flatMap((evalCase) => plan.variants.map((prompts) => ({ evalCase, prompts, repeat }))),
  ).flat();
}

export const jobKey = (job: EvalJob) => outcomeKey({ caseId: job.evalCase.id, variant: job.prompts.version, repeat: job.repeat });

export interface EvalRunOptions {
  /** Nowy klient na kazda rozprawe — np. z wlasnym limitem kosztu jednej rozprawy. */
  readonly llmFor: (job: EvalJob) => LlmClient;
  readonly config?: CourtConfig;
  /** Ile rozpraw naraz; kazda i tak pyta piecioma krytykami rownolegle. */
  readonly concurrency: number;
  /** Klucze przebiegow juz zapisanych — wznowienie nie placi drugi raz. */
  readonly done?: ReadonlySet<string>;
  /** Zapis wyniku zaraz po rozprawie; czekamy na niego, zanim ruszy kolejna. */
  readonly onOutcome: (outcome: TrialOutcome) => Promise<void> | void;
  /**
   * true: przestan zaczynac nowe rozprawy, a przerwanej przez to rozprawy nie zapisuj — jej wynik
   * mowi o budzecie calego przebiegu albo o Ctrl+C, a nie o promptach. Wznowienie ja powtorzy.
   */
  readonly halted?: () => boolean;
  readonly signal?: AbortSignal;
}

export async function runEvals(plan: EvalPlan, options: EvalRunOptions): Promise<TrialOutcome[]> {
  // Nieoczekiwany blad (np. zapis wyniku) zatrzymuje wszystkich pracownikow, a nie tylko jednego —
  // reszta nie placi dalej za rozprawy, ktorych wyniku i tak nikt nie zapisze.
  const failures: unknown[] = [];
  const halted = () => failures.length > 0 || options.signal?.aborted === true || options.halted?.() === true;
  const pending = planJobs(plan).filter((job) => !(options.done?.has(jobKey(job)) ?? false));
  const outcomes: TrialOutcome[] = [];

  const worker = async () => {
    try {
      await work();
    } catch (error) {
      failures.push(error);
    }
  };
  const work = async () => {
    for (let job = pending.shift(); job !== undefined && !halted(); job = pending.shift()) {
      const { evalCase, prompts, repeat } = job;
      const run = await runTrial(
        { trialId: `${prompts.version}-${evalCase.id}-${String(repeat)}`, cvText: evalCase.cvText, jobOffer: evalCase.offerText, debateRounds: plan.debateRounds },
        {
          llm: options.llmFor(job),
          prompts,
          ...(options.config === undefined ? {} : { config: options.config }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      if (run.state.phase === "aborted" && halted()) return;
      const outcome = toOutcome(evalCase, prompts.version, repeat, run);
      outcomes.push(outcome);
      await options.onOutcome(outcome);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  if (failures.length > 0) throw failures[0];
  return outcomes;
}
