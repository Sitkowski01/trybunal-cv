import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { IncompleteOutputError, type LlmClient, type LlmResult, parseOutput, type StructuredRequest } from "./client.js";
import { costNanoUsd, type TokenUsage } from "./pricing.js";

/** Tyle z SDK, ile potrzebujemy — w testach podstawiamy wlasna implementacje bez sieci. */
export interface MessagesApi {
  create(body: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<Message>;
}

const INCOMPLETE = new Set(["max_tokens", "refusal", "model_context_window_exceeded"]);

/**
 * Adapter Claude'a. Prompt ma trzy czesci w kolejnosci, w jakiej API buduje cache (system przed
 * wiadomosciami): wspolny kontekst z punktem cache, rola agenta, zadanie. Pieciu krytykow tej
 * samej rozprawy ma identyczny poczatek, wiec od drugiego placi sie za niego 5% ceny.
 *
 * Format odpowiedzi to JSON Schema z zod. API gwarantuje ksztalt JSON-a, ale ograniczenia
 * (zakresy, dlugosci, enum, refine) SDK przekazuje modelowi tylko jako opis — dlatego wynik
 * zawsze przechodzi przez pelny schemat w parseOutput.
 */
export class AnthropicLlmClient implements LlmClient {
  constructor(private readonly messages: MessagesApi) {}

  /** Ponawianie przy 429/5xx i timeout zostawiamy SDK, ktore zna naglowki retry-after. */
  static fromApiKey(apiKey: string): AnthropicLlmClient {
    return new AnthropicLlmClient(new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }).messages);
  }

  async generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    const body: MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: [
        { type: "text", text: request.sharedContext, cache_control: { type: "ephemeral" } },
        { type: "text", text: request.instructions },
      ],
      messages: [{ role: "user", content: request.task }],
      output_config: { format: { type: "json_schema", schema: zodOutputFormat(request.schema).schema } },
    };
    const message = await this.messages.create(body, signal === undefined ? undefined : { signal });
    const usage = toUsage(message);

    if (message.stop_reason !== null && INCOMPLETE.has(message.stop_reason)) {
      throw new IncompleteOutputError(message.stop_reason, request.model, usage);
    }
    const raw = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const data = parseOutput(raw, request.schema, request.model, usage);
    return { data, model: request.model, usage, costNanoUsd: costNanoUsd(request.model, usage) };
  }
}

function toUsage({ usage }: Message): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
