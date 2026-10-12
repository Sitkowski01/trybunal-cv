import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type CassetteEntry, CassetteSchema, RecordingLlmClient, ReplayLlmClient } from "./cassette.js";
import { IncompleteOutputError, InvalidOutputError, type LlmClient, type StructuredRequest } from "./client.js";
import { FAKE_USAGE, FakeLlmClient, raw } from "./fake.js";
import { costNanoUsd } from "./pricing.js";

const Answer = z.object({ score: z.number().int().min(1).max(10) });
const request = (label: string): StructuredRequest<z.infer<typeof Answer>> => ({
  label,
  model: "claude-sonnet-5-5",
  maxTokens: 100,
  rules: "Zasady",
  documents: [],
  instructions: "rola",
  task: "zadanie",
  schema: Answer,
});
const cost = costNanoUsd("claude-sonnet-5-5", FAKE_USAGE);
const ok = (label: string, score: number, model = "claude-sonnet-5-5" as const): CassetteEntry => ({
  kind: "ok",
  label,
  model,
  data: { score },
  usage: FAKE_USAGE,
  costNanoUsd: cost,
  requestId: `msg_${label}`,
  durationMs: 1200,
});

/** HR za pierwszym razem odpowiada zle, za drugim dobrze; ATS od razu dobrze. */
async function record() {
  const recorder = new RecordingLlmClient(new FakeLlmClient((r, i) => (r.label === "hr" && i === 0 ? raw("{zly") : { score: 9 })));
  await recorder.generate(request("hr")).catch(() => undefined);
  await recorder.generate(request("ats"));
  await recorder.generate(request("hr"));
  return recorder;
}

describe("RecordingLlmClient", () => {
  it("zapisuje udane i odrzucone odpowiedzi w kolejnosci, z kosztem", async () => {
    const cassette = (await record()).cassette();
    expect(cassette.map((e) => [e.kind, e.label])).toEqual([
      ["invalid", "hr"],
      ["ok", "ats"],
      ["ok", "hr"],
    ]);
    expect(cassette[0]).toMatchObject({ rawOutput: "{zly", problems: ["odpowiedz nie jest poprawnym JSON-em"], costNanoUsd: cost });
    expect(cassette[1]).toMatchObject({ data: { score: 9 }, model: "claude-sonnet-5-5", usage: FAKE_USAGE, requestId: null });
  });

  it("zapisuje odpowiedz przerwana przez limit tokenow", async () => {
    const truncating: LlmClient = {
      generate: () => Promise.reject(new IncompleteOutputError("max_tokens", "claude-sonnet-5-5", FAKE_USAGE)),
    };
    const recorder = new RecordingLlmClient(truncating);
    await expect(recorder.generate(request("hr"))).rejects.toBeInstanceOf(IncompleteOutputError);
    expect(recorder.cassette()).toEqual([
      { kind: "incomplete", label: "hr", model: "claude-sonnet-5-5", usage: FAKE_USAGE, costNanoUsd: cost, stopReason: "max_tokens" },
    ]);
  });

  it("bledu bez odpowiedzi modelu (np. sieci) nie zapisuje", async () => {
    const recorder = new RecordingLlmClient({ generate: () => Promise.reject(new Error("ECONNRESET")) });
    await expect(recorder.generate(request("hr"))).rejects.toThrow("ECONNRESET");
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
    ["nieznany rodzaj", { kind: "maybe" }],
  ])("odrzuca wpis: %s", (_, change) => {
    expect(CassetteSchema.safeParse([{ ...ok("hr", 5), ...change }]).success).toBe(false);
  });

  it("mowi, ze model jest nieznany", () => {
    expect(CassetteSchema.safeParse([{ ...ok("hr", 5), model: "gpt-9" }]).error?.issues[0]?.message).toBe("Nieznany model");
  });
});

describe("ReplayLlmClient", () => {
  it("odtwarza kazda etykiete w nagranej kolejnosci, razem z porazkami", async () => {
    const replay = new ReplayLlmClient((await record()).cassette());
    expect(await replay.generate(request("ats"))).toMatchObject({ data: { score: 9 }, usage: FAKE_USAGE, costNanoUsd: cost });
    await expect(replay.generate(request("hr"))).rejects.toMatchObject({ name: "InvalidOutputError", rawOutput: "{zly" });
    expect((await replay.generate(request("hr"))).data).toEqual({ score: 9 });
  });

  it("odtwarza id zapytania i czas odpowiedzi (tempo powtorki)", async () => {
    const replay = new ReplayLlmClient([ok("hr", 5)]);
    expect(await replay.generate(request("hr"))).toMatchObject({ requestId: "msg_hr", durationMs: 1200 });
  });

  it("odpowiedz przerwana wraca jako IncompleteOutputError z powodem", async () => {
    const entry: CassetteEntry = { kind: "incomplete", label: "hr", model: "claude-sonnet-5-5", usage: FAKE_USAGE, costNanoUsd: cost, stopReason: "refusal" };
    await expect(new ReplayLlmClient([entry]).generate(request("hr"))).rejects.toMatchObject({ name: "IncompleteOutputError", stopReason: "refusal" });
  });

  it("gdy odpowiedzi sie skoncza, mowi to wprost", async () => {
    const replay = new ReplayLlmClient([ok("ats", 9)]);
    await replay.generate(request("ats"));
    await expect(replay.generate(request("ats"))).rejects.toThrow('Nagranie nie ma (wiecej) odpowiedzi dla "ats"');
    await expect(replay.generate(request("judge"))).rejects.toThrow('dla "judge"');
  });

  it("stare nagranie, ktore nie pasuje do nowego schematu, nie przechodzi po cichu", async () => {
    await expect(new ReplayLlmClient([ok("hr", 42)]).generate(request("hr"))).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it("nagranie innym modelem to blad, a nie koszt z innego cennika", async () => {
    await expect(new ReplayLlmClient([ok("hr", 5, "claude-haiku-5-5" as never)]).generate(request("hr"))).rejects.toThrow(
      'Nagranie "hr" zrobiono modelem claude-haiku-5-5, a nie claude-sonnet-5-5',
    );
  });

  it("przerwane zapytanie nie zuzywa nagrania", async () => {
    const replay = new ReplayLlmClient([ok("hr", 5)]);
    const controller = new AbortController();
    controller.abort(new Error("anulowano"));
    await expect(replay.generate(request("hr"), controller.signal)).rejects.toThrow("anulowano");
    expect((await replay.generate(request("hr"))).data).toEqual({ score: 5 });
  });
});
