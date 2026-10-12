import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlmClient, type MessagesApi } from "./anthropic.js";
import { IncompleteOutputError, InvalidOutputError, type StructuredRequest } from "./client.js";
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
function fakeApi(reply: Reply) {
  const sent: { body: MessageCreateParamsNonStreaming; options: unknown }[] = [];
  const api: MessagesApi = {
    create(body, options) {
      sent.push({ body, options });
      const message = {
        content: reply.content ?? [{ type: "text", text: '{"score":7}', citations: null }],
        stop_reason: reply.stop_reason ?? "end_turn",
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

  it.each(["max_tokens", "refusal", "model_context_window_exceeded"] as const)(
    "odpowiedz przerwana przez %s to IncompleteOutputError z kosztem",
    async (stopReason) => {
      const { api } = fakeApi({ stop_reason: stopReason });
      const error: unknown = await new AnthropicLlmClient(api).generate(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IncompleteOutputError);
      expect(error).toMatchObject({ stopReason, usage: { inputTokens: 300, outputTokens: 40 } });
    },
  );

  it.each(["end_turn", null] as const)("zakonczenie %s z odpowiedzia spoza schematu to InvalidOutputError", async (stopReason) => {
    const content = [{ type: "text", text: '{"score":99}', citations: null }] as Message["content"];
    const { api } = fakeApi({ stop_reason: stopReason, content });
    await expect(new AnthropicLlmClient(api).generate(request)).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it("fromApiKey ustawia klucz, 2 ponowienia i timeout 120 s w kliencie SDK", () => {
    const llm = AnthropicLlmClient.fromApiKey("sk-test");
    // Zagladamy do SDK: messages trzyma klienta, ktory przechowuje opcje.
    const sdk = (llm as unknown as { messages: { _client: Record<string, unknown> } }).messages._client;
    expect(sdk).toMatchObject({ apiKey: "sk-test", maxRetries: 2, timeout: 120_000 });
  });
});
