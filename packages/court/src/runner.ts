import {
  type Assessment,
  CRITIC_IDS,
  type CriticId,
  criticById,
  evolve,
  fileTrial,
  findInventedQuotes,
  type TrialEvent,
  TrialEventSchema,
  type TrialState,
} from "@trybunal/domain";
import type { LlmClient, StructuredRequest } from "@trybunal/llm";
import type { z } from "zod";
import { ask, type CallRecord } from "./ask.js";
import { abortReason, allOrNothing, sleep } from "./control.js";
import { AssessmentOutput, type CourtConfig, DEFAULT_CONFIG } from "./config.js";
import {
  ASSESSMENT_TASK,
  documents,
  instructionsFor,
  RULES,
} from "./prompts.js";

export interface TrialInput {
  readonly trialId: string;
  readonly cvText: string;
  readonly jobOffer: string;
  readonly debateRounds: number;
}

export interface RunOptions {
  readonly llm: LlmClient;
  readonly config?: CourtConfig;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Kazde zdarzenie zaraz po zastosowaniu — tu podlaczy sie API (SSE) i scena. */
  readonly onEvent?: (event: TrialEvent, state: TrialState) => void;
}

export interface TrialRun {
  readonly state: TrialState;
  readonly events: readonly TrialEvent[];
  readonly calls: readonly CallRecord[];
}

/**
 * Rozprawa — na razie faza niezaleznych ocen; oskarzenie, debata i werdykt w kolejnym kroku. Kazde zdarzenie przechodzi przez schemat
 * i reguly domeny, zanim trafi do dziennika. Blad, ktorego nie da sie naprawic ponowieniem
 * (budzet, odmowa modelu, anulowanie), konczy rozprawe zdarzeniem TrialAborted z powodem.
 */
export async function runTrial(input: TrialInput, options: RunOptions): Promise<TrialRun> {
  const config = options.config ?? DEFAULT_CONFIG;
  const calls: CallRecord[] = [];
  // Niepoprawne wejscie (np. puste CV) to blad wywolujacego, a nie przerwana rozprawa.
  const filed = TrialEventSchema.parse({ type: "TrialFiled", ...input });
  let state = fileTrial(filed);
  const events: TrialEvent[] = [filed];
  options.onEvent?.(filed, state);

  const emit = (event: TrialEvent) => {
    const parsed = TrialEventSchema.parse(event);
    state = evolve(state, parsed);
    events.push(parsed);
    options.onEvent?.(parsed, state);
  };

  const question = <T>(signal: AbortSignal | undefined, request: Omit<StructuredRequest<T>, "rules" | "documents">, validate?: (d: T) => string[]) =>
    ask(options.llm, { ...request, rules: RULES, documents: documents(state) }, {
      maxAttempts: config.maxAttempts,
      sleep: options.sleep ?? sleep,
      record: (call) => calls.push(call),
      ...(signal === undefined ? {} : { signal }),
      ...(validate === undefined ? {} : { validate }),
    });

  const assess = async (criticId: CriticId, signal: AbortSignal | undefined) => {
    const output = await question<z.infer<typeof AssessmentOutput>>(
      signal,
      {
        label: `assessment:${criticId}`,
        model: config.models.assessment[criticId],
        maxTokens: config.maxTokens.assessment,
        instructions: instructionsFor(criticById(criticId)),
        task: ASSESSMENT_TASK,
        schema: AssessmentOutput,
      },
      (o) => findInventedQuotes({ ...o, criticId }, state.cvText).map((q) => `Cytat "${q}" nie wystepuje doslownie w CV`),
    );
    const assessment: Assessment = { ...output, criticId };
    emit({ type: "AssessmentSubmitted", assessment });
  };

  try {
    // Pierwszy krytyk sam: cache wspolnego poczatku powstaje dopiero, gdy jego odpowiedz ruszy.
    const [first, ...rest] = CRITIC_IDS;
    await assess(first, options.signal);
    await allOrNothing(rest, (id, signal) => assess(id, signal), options.signal);
  } catch (error) {
    emit({ type: "TrialAborted", reason: abortReason(error, options.signal) });
  }
  return { state, events, calls };
}
