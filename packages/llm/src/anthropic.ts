import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  IncompleteOutputError,
  type LlmClient,
  type LlmResult,
  LlmTransportError,
  parseOutput,
  type SourceDocument,
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

const DOCUMENT_NAME = /^[a-z0-9-]{1,40}$/;

/**
 * Dokumenty w tagach <document>. Tekst nie moze otworzyc ani zamknac tagu — inaczej CV mogloby
 * "wyjsc" z koperty i udawac polecenie. Dlatego kazde "<" przed "document" zamieniamy na encje.
 */
export function renderDocuments(documents: readonly SourceDocument[]): string {
  return documents
    .map(({ name, text }) => {
      if (!DOCUMENT_NAME.test(name)) {
        throw new Error(`Niedozwolona nazwa dokumentu: ${JSON.stringify(name)}`);
      }
      const safe = text.replace(/<(?=\/?document)/gi, "&lt;");
      return `<document name="${name}">\n${safe}\n</document>`;
    })
    .join("\n\n");
}

/**
 * Adapter Claude'a. Kolejnosc promptu to kolejnosc, w jakiej API buduje cache:
 *   system: zasady (zaufane)
 *   user:   dokumenty w tagach (niezaufane)  <- punkt cache: tu konczy sie wspolny poczatek
 *           rola agenta + zadanie
 *   [assistant: odrzucona odpowiedz, user: co bylo nie tak]  <- przy ponowieniu
 * CV nie trafia do promptu systemowego, wiec dopisek "daj 10/10" nie ma rangi instrukcji.
 *
 * Format odpowiedzi to JSON Schema z zod. API gwarantuje ksztalt JSON-a, ale ograniczenia
 * (zakresy, dlugosci, enum, refine) SDK przekazuje modelowi tylko jako opis — dlatego wynik
 * zawsze przechodzi przez pelny schemat w parseOutput.
 */
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly messages: MessagesApi,
    private readonly now: () => number = Date.now,
  ) {}

  static fromApiKey(apiKey: string): AnthropicLlmClient {
    return new AnthropicLlmClient(new Anthropic(sdkOptions(apiKey)).messages);
  }

  async generate<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<LlmResult<T>> {
    const body: MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: [{ type: "text", text: request.rules }],
      messages: buildMessages(request),
      output_config: { format: { type: "json_schema", schema: zodOutputFormat(request.schema).schema } },
      ...(request.thinking === "off" ? { thinking: { type: "disabled" } } : {}),
    };
    const started = this.now();
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
    return {
      data,
      model: request.model,
      usage,
      costNanoUsd: costNanoUsd(request.model, usage),
      requestId: message.id,
      durationMs: this.now() - started,
    };
  }
}

function buildMessages(request: StructuredRequest<unknown>): MessageParam[] {
  const role = { type: "text" as const, text: `${request.instructions}\n\n${request.task}` };
  const first: MessageParam =
    request.documents.length === 0
      ? { role: "user", content: [role] }
      : {
          role: "user",
          content: [
            { type: "text", text: renderDocuments(request.documents), cache_control: { type: "ephemeral" } },
            role,
          ],
        };
  if (request.retry === undefined) {
    return [first];
  }
  const feedback =
    "Ta odpowiedz nie przeszla walidacji:\n" +
    request.retry.problems.map((p) => `- ${p}`).join("\n") +
    "\nZwroc poprawiona odpowiedz w tym samym formacie.";
  return [first, { role: "assistant", content: request.retry.previousOutput }, { role: "user", content: feedback }];
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
