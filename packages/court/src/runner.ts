import {
  type Assessment,
  announceVerdict,
  CRITIC_IDS,
  type CriticId,
  criticById,
  evolve,
  fileTrial,
  findInventedQuotes,
  nextSpeaker,
  pendingVerdict,
  type TrialEvent,
  TrialEventSchema,
  type TrialState,
} from "@trybunal/domain";
import type { LlmClient, StructuredRequest } from "@trybunal/llm";
import type { z } from "zod";
import { ask, type CallRecord } from "./ask.js";
import { abortReason, allOrNothing, sleep } from "./control.js";
import { AssessmentOutput, cacheLeader, type CourtConfig, DEFAULT_CONFIG, JustificationOutput, ProsecutionOutput, StatementOutput } from "./config.js";
import {
  ASSESSMENT_TASK,
  debateTask,
  documents,
  instructionsFor,
  JUDGE_INSTRUCTIONS,
  judgeTask,
  prosecutionTask,
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
  /** Blad obserwatora (np. zerwany strumien SSE) nie przerywa rozprawy — trafia tutaj. */
  readonly onObserverError?: (error: unknown) => void;
}

export interface TrialRun {
  readonly state: TrialState;
  readonly events: readonly TrialEvent[];
  readonly calls: readonly CallRecord[];
}

/**
 * Cala rozprawa: oceny -> oskarzenie -> debata -> werdykt. Kazde zdarzenie przechodzi przez schemat
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
  // Rozprawa jest juz oplacona i zapisana w dzienniku — obserwator nie moze jej przerwac.
  const notify = (event: TrialEvent) => {
    try {
      options.onEvent?.(event, state);
    } catch (error) {
      options.onObserverError?.(error);
    }
  };
  notify(filed);

  const emit = (event: TrialEvent) => {
    const parsed = TrialEventSchema.parse(event);
    state = evolve(state, parsed);
    events.push(parsed);
    notify(parsed);
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
    // Lider sam: cache wspolnego poczatku powstaje dopiero, gdy jego odpowiedz ruszy.
    const leader = cacheLeader(config.models.assessment);
    await assess(leader, options.signal);
    const rest = CRITIC_IDS.filter((id) => id !== leader);
    await allOrNothing(rest, (id, signal) => assess(id, signal), options.signal);

    const { speech } = await question(options.signal, {
      label: "prosecution",
      model: config.models.prosecution,
      maxTokens: config.maxTokens.prosecution,
      instructions: instructionsFor(criticById("prosecutor")),
      task: prosecutionTask(state),
      schema: ProsecutionOutput,
    });
    emit({ type: "ProsecutionDelivered", speech });

    for (let speaker = nextSpeaker(state); speaker !== null; speaker = nextSpeaker(state)) {
      const { statement, revisedScore } = await question(options.signal, {
        label: `statement:${String(state.round)}:${speaker}`,
        model: config.models.statement,
        maxTokens: config.maxTokens.statement,
        instructions: instructionsFor(criticById(speaker)),
        task: debateTask(state, speaker),
        schema: StatementOutput,
      });
      emit({ type: "StatementMade", round: state.round, criticId: speaker, statement, revisedScore });
    }

    const { justification } = await question(options.signal, {
      label: "justification",
      model: config.models.justification,
      maxTokens: config.maxTokens.justification,
      instructions: JUDGE_INSTRUCTIONS,
      task: judgeTask(state, pendingVerdict(state)),
      schema: JustificationOutput,
    });
    emit(announceVerdict(state, justification));
  } catch (error) {
    if (state.phase !== "closed" && state.phase !== "aborted") {
      emit({ type: "TrialAborted", reason: abortReason(error, options.signal) });
    }
  }
  return { state, events, calls };
}
