import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetedLlmClient, BudgetExceededError, OVERHEAD_TOKENS, worstCaseCostNanoUsd } from "./budget.js";
import { InvalidOutputError, type LlmClient, type LlmResult, LlmTransportError, type StructuredRequest } from "./client.js";
import { FAKE_USAGE, FakeLlmClient, raw } from "./fake.js";
import { costNanoUsd, MODELS } from "./pricing.js";

const Answer = z.object({ ok: z.boolean() });
const request: StructuredRequest<z.infer<typeof Answer>> = {
  label: "a",
  model: "claude-haiku-5-5",
  maxTokens: 100,
  rules: "Zasady",
  documents: [{ name: "cv", text: "CV" }],
  instructions: "HR",
  task: "Ocen",
  schema: Answer,
};
const worst = worstCaseCostNanoUsd(request);
const actual = costNanoUsd("claude-haiku-5-5", FAKE_USAGE);
const answering = () => new FakeLlmClient(() => ({ ok: true }));
const failing = (error: Error): LlmClient => ({ generate: () => Promise.reject(error) });

describe("worstCaseCostNanoUsd", () => {
  const haiku = MODELS["claude-haiku-5-5"].standard;

  it("kazdy bajt promptu i schematu jako token po stawce zapisu do cache, wyjscie po maxTokens", () => {
    const schemaBytes = JSON.stringify(zodOutputFormat(Answer).schema).length;
    const promptBytes = "Zasady".length + "cv".length + "CV".length + "HR".length + "Ocen".length;
    expect(worst).toBe((promptBytes + schemaBytes + OVERHEAD_TOKENS) * haiku.cacheWrite + 100 * haiku.output);
  });

  it("zapis do cache to najdrozsza stawka wejscia w kazdym modelu", () => {
    for (const { standard } of Object.values(MODELS)) {
      expect(standard.cacheWrite).toBeGreaterThan(standard.input);
    }
  });

  it("polska litera to dwa bajty, wiec dwa tokeny w najgorszym przypadku", () => {
    const ascii = worstCaseCostNanoUsd({ ...request, task: "zaz" });
    const polish = worstCaseCostNanoUsd({ ...request, task: "żaż" });
    expect(polish - ascii).toBe(2 * haiku.cacheWrite);
  });

  it("ponowienie kosztuje wiecej: odrzucona odpowiedz i problemy wracaja do promptu", () => {
    const retry = worstCaseCostNanoUsd({ ...request, retry: { previousOutput: "1234", problems: ["ab", "c"] } });
    expect(retry - worst).toBe(7 * haiku.cacheWrite);
  });
});

describe("BudgetedLlmClient", () => {
  it("przepuszcza zapytanie mieszczace sie w limicie i liczy koszt faktyczny, nie najgorszy", async () => {
    const llm = new BudgetedLlmClient(answering(), worst);
    await llm.generate(request);
    expect(llm.spentNanoUsd).toBe(actual);
  });

  it("odmawia, zanim zapyta model, gdy najgorszy koszt przebilby limit", async () => {
    const inner = answering();
    const llm = new BudgetedLlmClient(inner, worst - 1);
    const error: unknown = await llm.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetExceededError);
    expect((error as Error).name).toBe("BudgetExceededError");
    expect(error).toMatchObject({ spentNanoUsd: 0, reservedNanoUsd: 0, neededNanoUsd: worst, limitNanoUsd: worst - 1 });
    expect((error as Error).message).toMatch(/^Budzet \$0\.\d{4}: wydano \$0\.0000, zarezerwowano \$0\.0000, zapytanie moze kosztowac do \$0\.\d{4}$/);
    expect(inner.calls).toEqual([]);
  });

  it("wydane pieniadze zmniejszaja to, co zostalo", async () => {
    const llm = new BudgetedLlmClient(answering(), worst + actual - 1);
    await llm.generate(request);
    await expect(llm.generate(request)).rejects.toMatchObject({ spentNanoUsd: actual });
  });

  it("odrzucona odpowiedz modelu kosztuje tyle, ile zuzyla", async () => {
    const llm = new BudgetedLlmClient(new FakeLlmClient(() => raw("nie JSON")), 10 * worst);
    await expect(llm.generate(request)).rejects.toBeInstanceOf(InvalidOutputError);
    expect(llm.spentNanoUsd).toBe(actual);
  });

  it("odmowa API przed praca modelu (np. 429) nie kosztuje", async () => {
    const llm = new BudgetedLlmClient(failing(new LlmTransportError("429", true, false, 429)), worst);
    await expect(llm.generate(request)).rejects.toBeInstanceOf(LlmTransportError);
    await expect(llm.generate(request)).rejects.toBeInstanceOf(LlmTransportError);
    expect(llm.spentNanoUsd).toBe(0);
  });

  it("brak odpowiedzi, ktory mogl kosztowac (przerwanie, timeout), liczy cala rezerwacje", async () => {
    const llm = new BudgetedLlmClient(failing(new LlmTransportError("timeout", true, true)), 10 * worst);
    await expect(llm.generate(request)).rejects.toThrow("timeout");
    expect(llm.spentNanoUsd).toBe(worst);
  });

  it("nieznany blad tez liczy cala rezerwacje — limit ma byc twardy", async () => {
    const llm = new BudgetedLlmClient(failing(new Error("ECONNRESET")), 10 * worst);
    await expect(llm.generate(request)).rejects.toThrow("ECONNRESET");
    expect(llm.spentNanoUsd).toBe(worst);
  });

  it("rownolegle zapytania widza swoje rezerwacje: drugie nie wejdzie, poki pierwsze trwa", async () => {
    let finish: (r: LlmResult<unknown>) => void = () => undefined;
    const slow: LlmClient = { generate: () => new Promise((resolve) => (finish = resolve as typeof finish)) };
    const llm = new BudgetedLlmClient(slow, 2 * worst - 1);
    const first = llm.generate(request);
    await expect(llm.generate(request)).rejects.toMatchObject({ reservedNanoUsd: worst });
    finish({ data: { ok: true }, model: "claude-haiku-5-5", usage: FAKE_USAGE, costNanoUsd: actual, requestId: null, durationMs: 0 });
    await first;
    expect(llm.spentNanoUsd).toBe(actual);
  });
});
