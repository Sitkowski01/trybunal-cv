import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlmClient, type MessagesApi, sdkOptions, toTransportError } from "./anthropic.js";
import { IncompleteOutputError, InvalidOutputError, LlmTransportError, type StructuredRequest } from "./client.js";
import { costNanoUsd } from "./pricing.js";

const Answer = z.object({ score: z.number().int().min(1).max(10) });

const request: StructuredRequest<z.infer<typeof Answer>> = {
  label: "assessment:hr",
  model: "claude-sonnet-5-5",
  maxTokens: 800,
  sharedContext: "Zasady rozprawy, CV, oferta",
  instructions: "Jestes HR screenerem",
  task: "Ocen CV",
  schema: Answer,
};

interface Reply {
  readonly content?: Message["content"];
  readonly stop_reason?: Message["stop_reason"];
  readonly usage?: Partial<Message["usage"]>;
}

/** Podstawione API: zapamietuje zapytanie i zwraca przygotowana odpowiedz. */
function fakeApi(reply: Reply | Error = {}) {
  const sent: { body: MessageCreateParamsNonStreaming; options: unknown }[] = [];
  const api: MessagesApi = {
    create(body, options) {
      sent.push({ body, options });
      if (reply instanceof Error) return Promise.reject(reply);
      const message = {
        content: reply.content ?? [{ type: "text", text: '{"score":7}', citations: null }],
        stop_reason: reply.stop_reason === undefined ? "end_turn" : reply.stop_reason,
        usage: { input_tokens: 300, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000, ...reply.usage },
      };
      return Promise.resolve(message as unknown as Message);
    },
  };
  return { api, sent };
}

describe("AnthropicLlmClient — zapytanie", () => {
  it("wspolny kontekst idzie pierwszy z punktem cache, rola za nim, zadanie jako wiadomosc", async () => {
    const { api, sent } = fakeApi({});
    await new AnthropicLlmClient(api).generate(request);
    const body = sent[0]?.body;
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 800,
      system: [
        { type: "text", text: "Zasady rozprawy, CV, oferta", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Jestes HR screenerem" },
      ],
      messages: [{ role: "user", content: "Ocen CV" }],
    });
    expect(body?.system?.[1]).not.toHaveProperty("cache_control");
  });

  it("prosi o odpowiedz w formacie JSON Schema zbudowanym ze schematu zod", async () => {
    const { api, sent } = fakeApi({});
    await new AnthropicLlmClient(api).generate(request);
    const format = sent[0]?.body.output_config?.format;
    expect(format?.type).toBe("json_schema");
    expect(format?.schema).toMatchObject({ type: "object", properties: { score: { type: "integer" } }, required: ["score"] });
  });

  it("przekazuje sygnal anulowania tylko, gdy jest", async () => {
    const { api, sent } = fakeApi({});
    const signal = new AbortController().signal;
    await new AnthropicLlmClient(api).generate(request, signal);
    await new AnthropicLlmClient(api).generate(request);
    expect(sent.map((s) => s.options)).toEqual([{ signal }, undefined]);
  });
});

describe("AnthropicLlmClient — odpowiedz", () => {
  it("zwraca dane po schemacie, tokeny z cache i koszt", async () => {
    const { api } = fakeApi({ usage: { cache_creation_input_tokens: 500 } });
    const result = await new AnthropicLlmClient(api).generate(request);
    const usage = { inputTokens: 300, outputTokens: 40, cacheWriteTokens: 500, cacheReadTokens: 2000 };
    expect(result).toEqual({ data: { score: 7 }, model: "claude-sonnet-5-5", usage, costNanoUsd: costNanoUsd("claude-sonnet-5-5", usage) });
  });

  it("brak liczby tokenow cache w odpowiedzi to zero", async () => {
    const { api } = fakeApi({ usage: { cache_creation_input_tokens: null, cache_read_input_tokens: null } });
    const { usage } = await new AnthropicLlmClient(api).generate(request);
    expect(usage).toMatchObject({ cacheWriteTokens: 0, cacheReadTokens: 0 });
  });

  it("skleja bloki tekstu i pomija inne bloki (np. rozumowanie)", async () => {
    const content = [
      { type: "thinking", thinking: "hmm", signature: "s" },
      { type: "text", text: '{"sco', citations: null },
      { type: "text", text: 're":3}', citations: null },
    ] as unknown as Message["content"];
    const { api } = fakeApi({ content });
    expect((await new AnthropicLlmClient(api).generate(request)).data).toEqual({ score: 3 });
  });

  it.each(["max_tokens", "refusal", "model_context_window_exceeded", "pause_turn", "stop_sequence", null] as const)(
    "zakonczenie inne niz end_turn (%s) to IncompleteOutputError z kosztem",
    async (stopReason) => {
      const { api } = fakeApi({ stop_reason: stopReason });
      const error: unknown = await new AnthropicLlmClient(api).generate(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IncompleteOutputError);
      expect(error).toMatchObject({ stopReason: String(stopReason), usage: { inputTokens: 300, outputTokens: 40 } });
    },
  );

  it("odpowiedz spoza schematu to InvalidOutputError", async () => {
    const { api } = fakeApi({ content: [{ type: "text", text: '{"score":99}', citations: null }] as Message["content"] });
    await expect(new AnthropicLlmClient(api).generate(request)).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it("blad SDK wychodzi jako LlmTransportError", async () => {
    const { api } = fakeApi(new Anthropic.APIConnectionTimeoutError());
    await expect(new AnthropicLlmClient(api).generate(request)).rejects.toBeInstanceOf(LlmTransportError);
  });
});

describe("toTransportError", () => {
  const apiError = (status: number, headers: Record<string, string> = {}) =>
    Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", new Headers(headers));

  it.each([
    ["przerwanie", new Anthropic.APIUserAbortError(), { retryable: false, mayHaveBeenBilled: true, status: null }],
    ["timeout", new Anthropic.APIConnectionTimeoutError(), { retryable: true, mayHaveBeenBilled: true, status: null }],
    ["zerwane polaczenie", new Anthropic.APIConnectionError({ message: "reset" }), { retryable: true, mayHaveBeenBilled: true }],
    ["429", apiError(429), { retryable: true, mayHaveBeenBilled: false, status: 429 }],
    ["529 przeciazenie", apiError(529), { retryable: true, mayHaveBeenBilled: false, status: 529 }],
    ["500", apiError(500), { retryable: true, mayHaveBeenBilled: true, status: 500 }],
    ["400", apiError(400), { retryable: false, mayHaveBeenBilled: false, status: 400 }],
  ] as const)("%s", (_, error, expected) => {
    const mapped = toTransportError(error);
    expect(mapped).toBeInstanceOf(LlmTransportError);
    expect(mapped).toMatchObject(expected);
  });

  it("czyta retry-after w sekundach, a bez niego zostawia null", () => {
    expect(toTransportError(apiError(429, { "retry-after": "7" }))).toMatchObject({ retryAfterMs: 7000 });
    expect(toTransportError(apiError(429, { "retry-after": "zaraz" }))).toMatchObject({ retryAfterMs: null });
    expect(toTransportError(apiError(429, { "retry-after": "0" }))).toMatchObject({ retryAfterMs: null });
    expect(toTransportError(apiError(429))).toMatchObject({ retryAfterMs: null });
  });

  it("komunikat mowi, co sie stalo", () => {
    expect((toTransportError(apiError(400)) as Error).message).toMatch(/^API odrzucilo zapytanie \(400\): /);
    expect((toTransportError(new Anthropic.APIUserAbortError()) as Error).message).toBe("Zapytanie przerwane");
    expect((toTransportError(new Anthropic.APIConnectionError({ message: "reset" })) as Error).message).toBe("Brak odpowiedzi: reset");
  });

  it("blad spoza SDK (np. nasz) przechodzi bez zmian", () => {
    const ours = new TypeError("bug");
    expect(toTransportError(ours)).toBe(ours);
  });

  it("blad SDK bez kodu HTTP (nie przerwanie, nie polaczenie) przechodzi bez zmian", () => {
    const odd = new Anthropic.APIError(undefined, undefined, "dziwny", undefined);
    expect(toTransportError(odd)).toBe(odd);
  });
});

describe("konfiguracja SDK", () => {
  it("bez automatycznych ponowien (kazda proba przez budzet), timeout 120 s", () => {
    expect(sdkOptions("sk-test")).toEqual({ apiKey: "sk-test", maxRetries: 0, timeout: 120_000 });
  });

  it("fromApiKey buduje klienta bez wysylania czegokolwiek", () => {
    expect(AnthropicLlmClient.fromApiKey("sk-test")).toBeInstanceOf(AnthropicLlmClient);
  });
});
