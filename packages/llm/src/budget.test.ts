import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BudgetedLlmClient, BudgetExceededError, OVERHEAD_TOKENS, worstCaseCostNanoUsd } from "./budget.js";
import { InvalidOutputError, type LlmClient, type LlmResult, type StructuredRequest } from "./client.js";
import { FAKE_USAGE, FakeLlmClient } from "./fake.js";
import { costNanoUsd } from "./pricing.js";

const Answer = z.object({ ok: z.boolean() });
const request: StructuredRequest<z.infer<typeof Answer>> = {
  label: "a",
  model: "claude-haiku-5-5",
  maxTokens: 100,
  sharedContext: "CV",
  instructions: "HR",
  task: "Ocen",
  schema: Answer,
};
const worst = worstCaseCostNanoUsd(request);
const actual = costNanoUsd("claude-haiku-5-5", FAKE_USAGE);
const answering = () => new FakeLlmClient(() => ({ ok: true }));

describe("worstCaseCostNanoUsd", () => {
  it("liczy bajty UTF-8 promptu i schematu plus zapas, wyjscie po maxTokens, bez cache", () => {
    const schemaBytes = JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } }, additionalProperties: false, required: ["ok"], description: '{$schema: "https://json-schema.org/draft/2020-12/schema"}' }).length;
    const inputTokens = "CV".length + "HR".length + "Ocen".length + schemaBytes + OVERHEAD_TOKENS;
    expect(worst).toBe(inputTokens * 100 + 100 * 500);
  });

  it("polska litera to dwa bajty, wiec dwa tokeny w najgorszym przypadku", () => {
    const ascii = worstCaseCostNanoUsd({ ...request, task: "zaz" });
    const polish = worstCaseCostNanoUsd({ ...request, task: "żaż" });
    expect(polish - ascii).toBe(2 * 100);
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

  it("nieudana odpowiedz modelu tez kosztuje", async () => {
    const llm = new BudgetedLlmClient(new FakeLlmClient(() => "nie JSON"), 10 * worst);
    await expect(llm.generate(request)).rejects.toBeInstanceOf(InvalidOutputError);
    expect(llm.spentNanoUsd).toBe(actual);
  });

  it("blad spoza modelu (np. sieci) nie zmienia wydatkow i zwalnia rezerwacje", async () => {
    const failing: LlmClient = { generate: () => Promise.reject(new Error("ECONNRESET")) };
    const llm = new BudgetedLlmClient(failing, worst);
    await expect(llm.generate(request)).rejects.toThrow("ECONNRESET");
    await expect(llm.generate(request)).rejects.toThrow("ECONNRESET");
    expect(llm.spentNanoUsd).toBe(0);
  });

  it("rownolegle zapytania widza swoje rezerwacje: drugie nie wejdzie, poki pierwsze trwa", async () => {
    let finish: (r: LlmResult<unknown>) => void = () => undefined;
    const slow: LlmClient = { generate: () => new Promise((resolve) => (finish = resolve as typeof finish)) };
    const llm = new BudgetedLlmClient(slow, 2 * worst - 1);
    const first = llm.generate(request);
    await expect(llm.generate(request)).rejects.toMatchObject({ reservedNanoUsd: worst });
    finish({ data: { ok: true }, model: "claude-haiku-5-5", usage: FAKE_USAGE, costNanoUsd: actual });
    await first;
    expect(llm.spentNanoUsd).toBe(actual);
  });
});
