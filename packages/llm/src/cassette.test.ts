import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CassetteSchema, RecordingLlmClient, ReplayLlmClient } from "./cassette.js";
import { InvalidOutputError, type StructuredRequest } from "./client.js";
import { FAKE_USAGE, FakeLlmClient, raw } from "./fake.js";

const Answer = z.object({ score: z.number().int().min(1).max(10) });
const request = (label: string): StructuredRequest<z.infer<typeof Answer>> => ({
  label,
  model: "claude-sonnet-5-5",
  maxTokens: 100,
  rules: "Zasady",
  documents: [{ name: "cv", text: "CV" }],
  instructions: "rola",
  task: "zadanie",
  schema: Answer,
});

async function record() {
  const recorder = new RecordingLlmClient(new FakeLlmClient((r, i) => ({ score: r.label === "hr" ? 4 + i : 9 })));
  await recorder.generate(request("hr"));
  await recorder.generate(request("ats"));
  await recorder.generate(request("hr"));
  return recorder;
}

describe("RecordingLlmClient", () => {
  it("zapisuje udane odpowiedzi w kolejnosci, z kosztem, i zwraca je bez zmian", async () => {
    const recorder = await record();
    expect(recorder.cassette().map((e) => [e.label, e.data])).toEqual([
      ["hr", { score: 4 }],
      ["ats", { score: 9 }],
      ["hr", { score: 6 }],
    ]);
    expect(recorder.cassette()[0]).toMatchObject({ model: "claude-sonnet-5-5", usage: FAKE_USAGE });
  });

  it("nie zapisuje nieudanych odpowiedzi", async () => {
    const recorder = new RecordingLlmClient(new FakeLlmClient(() => raw("zle")));
    await expect(recorder.generate(request("hr"))).rejects.toBeInstanceOf(InvalidOutputError);
    expect(recorder.cassette()).toEqual([]);
  });

  it("kaseta przechodzi przez JSON (plik) i schemat bez zmian", async () => {
    const cassette = (await record()).cassette();
    expect(CassetteSchema.parse(JSON.parse(JSON.stringify(cassette)))).toEqual(cassette);
  });
});

describe("CassetteSchema", () => {
  it.each([
    ["nieznany model", { model: "gpt-9" }],
    ["ujemne tokeny", { usage: { ...FAKE_USAGE, inputTokens: -1 } }],
    ["pusta etykieta", { label: "" }],
  ])("odrzuca wpis: %s", (_, change) => {
    const entry = { label: "hr", model: "claude-haiku-5-5", data: {}, usage: FAKE_USAGE, costNanoUsd: 1, requestId: null, durationMs: 0, ...change };
    expect(CassetteSchema.safeParse([entry]).success).toBe(false);
  });

  it("mowi, ze model jest nieznany", () => {
    const entry = { label: "hr", model: "gpt-9", data: {}, usage: FAKE_USAGE, costNanoUsd: 1, requestId: null, durationMs: 0 };
    expect(CassetteSchema.safeParse([entry]).error?.issues[0]?.message).toBe("Nieznany model");
  });
});

describe("ReplayLlmClient", () => {
  it("odtwarza odpowiedzi kazdej etykiety w nagranej kolejnosci, niezaleznie od innych etykiet", async () => {
    const replay = new ReplayLlmClient((await record()).cassette());
    expect((await replay.generate(request("hr"))).data).toEqual({ score: 4 });
    expect((await replay.generate(request("hr"))).data).toEqual({ score: 6 });
    expect(await replay.generate(request("ats"))).toMatchObject({ data: { score: 9 }, usage: FAKE_USAGE });
  });

  it("gdy odpowiedzi sie skoncza, mowi to wprost", async () => {
    const replay = new ReplayLlmClient((await record()).cassette());
    await replay.generate(request("ats"));
    await expect(replay.generate(request("ats"))).rejects.toThrow('Nagranie nie ma (wiecej) odpowiedzi dla "ats"');
    await expect(replay.generate(request("judge"))).rejects.toThrow('dla "judge"');
  });

  it("stare nagranie, ktore nie pasuje do nowego schematu, nie przechodzi po cichu", async () => {
    const replay = new ReplayLlmClient([{ label: "hr", model: "claude-sonnet-5-5", data: { score: 42 }, usage: FAKE_USAGE, costNanoUsd: 1, requestId: null, durationMs: 0 }]);
    await expect(replay.generate(request("hr"))).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it("nagranie innym modelem to blad, a nie koszt z innego cennika", async () => {
    const replay = new ReplayLlmClient([{ label: "hr", model: "claude-haiku-5-5", data: { score: 5 }, usage: FAKE_USAGE, costNanoUsd: 1, requestId: null, durationMs: 0 }]);
    await expect(replay.generate(request("hr"))).rejects.toThrow(
      'Nagranie "hr" zrobiono modelem claude-haiku-5-5, a nie claude-sonnet-5-5',
    );
  });
});
