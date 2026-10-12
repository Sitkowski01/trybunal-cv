import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InvalidOutputError, type StructuredRequest } from "./client.js";
import { byLabel, FAKE_USAGE, FakeLlmClient } from "./fake.js";
import { costNanoUsd } from "./pricing.js";

const Answer = z.object({ score: z.number().int().min(1).max(10), note: z.string().trim().min(1) });

const request = (label: string): StructuredRequest<z.infer<typeof Answer>> => ({
  label,
  model: "claude-haiku-5-5",
  maxTokens: 500,
  sharedContext: "CV i oferta",
  instructions: "Jestes HR",
  task: "Ocen",
  schema: Answer,
});

describe("FakeLlmClient", () => {
  it("odpowiada po etykiecie, liczy koszt i zapisuje zapytania", async () => {
    const llm = new FakeLlmClient(byLabel({ "assessment:hr": { score: 6, note: "ok" } }));
    const result = await llm.generate(request("assessment:hr"));
    expect(result).toEqual({
      data: { score: 6, note: "ok" },
      model: "claude-haiku-5-5",
      usage: FAKE_USAGE,
      costNanoUsd: costNanoUsd("claude-haiku-5-5", FAKE_USAGE),
    });
    expect(llm.calls.map((c) => c.label)).toEqual(["assessment:hr"]);
  });

  it("odpowiedz atrapy przechodzi przez schemat jak odpowiedz modelu", async () => {
    const llm = new FakeLlmClient(() => ({ score: 42, note: "x" }));
    await expect(llm.generate(request("a"))).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it("odpowiedz jako tekst trafia do parsera bez zmian", async () => {
    const llm = new FakeLlmClient(() => "to nie JSON");
    await expect(llm.generate(request("a"))).rejects.toMatchObject({ rawOutput: "to nie JSON" });
  });

  it("skrypt dostaje numer wywolania i wlasne zuzycie tokenow", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 7 };
    const llm = new FakeLlmClient((_, i) => ({ score: i + 1, note: "n" }), usage);
    await llm.generate(request("a"));
    expect((await llm.generate(request("a"))).data.score).toBe(2);
    expect((await llm.generate(request("a"))).usage).toBe(usage);
  });

  it("skrypt rzucajacy napisem daje zwykly Error", async () => {
    const llm = new FakeLlmClient(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- celowo: skrypt testu moze rzucic czymkolwiek
      throw "awaria";
    });
    await expect(llm.generate(request("a"))).rejects.toThrow(new Error("awaria"));
  });

  it("nieznana etykieta to blad testu, a nie cicha pusta odpowiedz", async () => {
    const llm = new FakeLlmClient(byLabel({}));
    await expect(llm.generate(request("verdict"))).rejects.toThrow('Atrapa nie zna odpowiedzi dla "verdict"');
  });

  it("przerwane zapytanie nie dochodzi do modelu", async () => {
    const llm = new FakeLlmClient(() => ({ score: 1, note: "n" }));
    const controller = new AbortController();
    controller.abort(new Error("anulowano"));
    await expect(llm.generate(request("a"), controller.signal)).rejects.toThrow("anulowano");
    expect(llm.calls).toEqual([]);
  });
});
