import { formatUsd, type LlmClient, LlmTransportError } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { UsageError } from "./args.js";
import { evaluate } from "./evaluate.js";
import { parseOutcomes } from "./outcome.js";
import { memoryIo, RUN } from "./test/memory-io.js";

const saved = (files: ReadonlyMap<string, string>, dir = "wyniki/r1") => parseOutcomes(files.get(`${dir}/outcomes.jsonl`) ?? "");
const spentOf = (files: ReadonlyMap<string, string>) => (JSON.parse(files.get("wyniki/r1/meta.json") ?? "") as { spentNanoUsd: number }).spentNanoUsd;

describe("evaluate — przebieg", () => {
  it("prowadzi wszystkie rozprawy, zapisuje wyniki, parametry i raport", async () => {
    const { io, files, logs, dirs, keys } = memoryIo();
    expect(await evaluate([...RUN, "--repeats", "2", "--variants", "v1, v2-kotwice"], io)).toBe(0);
    expect(keys).toEqual(["klucz"]);
    expect(dirs).toEqual(["wyniki/r1"]);
    const outcomes = saved(files);
    expect(outcomes).toHaveLength(8);
    expect(new Set(outcomes.map((o) => o.variant))).toEqual(new Set(["v1", "v2-kotwice"]));
    const spent = spentOf(files);
    expect(JSON.parse(files.get("wyniki/r1/meta.json") ?? "")).toEqual({ llm: "anthropic", repeats: 2, debateRounds: 1, startedAt: "2026-10-16T10:00:00.000Z", dataset: "ds", spentNanoUsd: spent });
    expect(spent).toBe(outcomes.reduce((sum, o) => sum + o.costNanoUsd, 0));
    const report = files.get("wyniki/r1/report.md") ?? "";
    expect(report).toContain("# Ewaluacja Trybunału CV — r1");
    expect(report).toContain("2026-10-16 · Claude (modele z konfiguracji sądu) · przypadki: 2 · powtórzenia: 2 · rundy debaty: 1");
    expect(report).toContain(`Wydano łącznie: ${formatUsd(spent)} (z rozprawami przerwanymi`);
    expect(logs[0]).toBe("Ewaluacja: 2 przypadkow x 2 wariantow x 2 powtorzen");
    expect(logs).toContain("v1 a #1: invite, oczekiwano invite");
    expect(logs.at(-1)).toBe(`Wydano ${formatUsd(spent)}. Raport: wyniki/r1/report.md`);
  });

  it("heurystyka: bez klucza, jeden wariant o wlasnej nazwie", async () => {
    const { io, files } = memoryIo({ apiKey: undefined });
    expect(await evaluate([...RUN, "--llm", "heuristic", "--repeats", "1"], io)).toBe(0);
    expect(saved(files).map((o) => [o.variant, o.caseId, o.decision])).toEqual([
      ["heurystyka", "a", "invite"],
      ["heurystyka", "b", "reject"],
    ]);
    expect(files.get("wyniki/r1/report.md")).toContain("heurystyka słów kluczowych (bez modelu)");
  });

  it("--cases zaweza zbior; domyslnie 3 powtorzenia i oba warianty", async () => {
    const { io, files } = memoryIo();
    expect(await evaluate([...RUN, "--cases", "b"], io)).toBe(0);
    expect(saved(files)).toHaveLength(6);
    expect(saved(files).every((o) => o.caseId === "b")).toBe(true);
  });

  it("blad modelu inny niz budzet nie zatrzymuje ewaluacji — rozprawa zapisana jako przerwana", async () => {
    const refusing: LlmClient = { generate: () => Promise.reject(new LlmTransportError("400", false, false, 400)) };
    const { io, files, logs } = memoryIo({ createLlm: () => refusing });
    expect(await evaluate([...RUN, "--variants", "v1", "--repeats", "1"], io)).toBe(0);
    expect(saved(files).map((o) => o.decision)).toEqual([null, null]);
    expect(logs.some((l) => l.startsWith("v1 a #1: przerwana (") && l.includes("400"))).toBe(true);
  });

  it.each([
    ["nieznany przypadek", [...RUN, "--cases", "a,zz,yy"], {}, "Nieznane przypadki: zz, yy"],
    ["domyslny zbior evals/dataset", ["--out", "x"], {}, "Nie mozna wczytac zbioru evals/dataset: ENOENT evals/dataset/cases.json"],
    ["bez klucza API", RUN, { apiKey: undefined }, "Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza: --llm heuristic albo pnpm evals report."],
    ["katalog nie do utworzenia", RUN, { makeDir: () => Promise.reject(new Error("EACCES")) }, "Nie mozna utworzyc katalogu wyniki/r1: EACCES"],
  ])("blad wywolania (%s) przed jakimkolwiek zapisem", async (_, argv, over, message) => {
    const { io, files } = memoryIo(over);
    const run = evaluate(argv, io);
    await expect(run).rejects.toThrow(UsageError);
    await expect(run).rejects.toThrow(message);
    expect(files.has("wyniki/r1/meta.json")).toBe(false);
  });

  it("inny blad (np. zapis wyniku) nie jest bledem wywolania — leci dalej", async () => {
    const { io } = memoryIo({ appendText: () => Promise.reject(new Error("dysk pelny")) });
    await expect(evaluate(RUN, io)).rejects.toThrow(new Error("dysk pelny"));
  });
});
