import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import {
  IncompleteOutputError,
  type LlmClient,
  type LlmResult,
  LlmTransportError,
  parseOutput,
  type StructuredRequest,
} from "./client.js";
import { costNanoUsd, type TokenUsage } from "./pricing.js";

/** Tyle z SDK, ile potrzebujemy — w testach podstawiamy wlasna implementacje bez sieci. */
export interface MessagesApi {
  create(body: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<Message>;
}

/**
 * Bez automatycznych ponowien w SDK: ponowienie po timeoucie to drugi rachunek, ktorego budzet
 * by nie zobaczyl. Ponawia orkiestracja, kazda proba przechodzi przez budzet.
 */
export function sdkOptions(apiKey: string): ClientOptions {
  return { apiKey, maxRetries: 0, timeout: 120_000 };
}

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

  static fromApiKey(apiKey: string): AnthropicLlmClient {
    return new AnthropicLlmClient(new Anthropic(sdkOptions(apiKey)).messages);
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
    let message: Message;
    try {
      message = await this.messages.create(body, signal === undefined ? undefined : { signal });
    } catch (error) {
      throw toTransportError(error);
    }
    const usage = toUsage(message);
    if (message.stop_reason !== "end_turn") {
      throw new IncompleteOutputError(String(message.stop_reason), request.model, usage);
    }
    const raw = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const data = parseOutput(raw, request.schema, request.model, usage);
    return { data, model: request.model, usage, costNanoUsd: costNanoUsd(request.model, usage) };
  }
}

/**
 * Blad SDK -> LlmTransportError. Czy mogl kosztowac: 429 i 529 (przeciazenie) oraz inne 4xx sa
 * odrzucane, zanim model zacznie pracowac; przerwanie, timeout, zerwane polaczenie i 5xx moga
 * przyjsc po wygenerowaniu odpowiedzi.
 */
export function toTransportError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new LlmTransportError("Zapytanie przerwane", false, true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmTransportError(`Brak odpowiedzi: ${error.message}`, true, true);
  }
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    // SDK typuje status i naglowki jako any (parametry generyczne APIError) — nadajemy typy wprost.
    const status = error.status as number;
    const headers = error.headers as Headers | undefined;
    const overloaded = status === 429 || status === 529;
    const retryAfter = Number(headers?.get("retry-after"));
    return new LlmTransportError(
      `API odrzucilo zapytanie (${String(status)}): ${error.message}`,
      overloaded || status >= 500,
      status >= 500 && !overloaded,
      status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    );
  }
  return error;
}

function toUsage({ usage }: Message): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
