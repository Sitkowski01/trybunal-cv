import { FakeLlmClient, formatUsd, type LlmClient, LlmTransportError } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { UsageError } from "./args.js";
import { evaluate } from "./evaluate.js";
import { heuristicScript } from "./heuristic.js";
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
    expect(JSON.parse(files.get("wyniki/r1/meta.json") ?? "")).toEqual({
      llm: "anthropic",
      repeats: 2,
      debateRounds: 1,
      startedAt: "2026-10-16T10:00:00.000Z",
      dataset: "ds",
      spentNanoUsd: spent,
      datasetHash: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
    });
    expect(spent).toBe(outcomes.reduce((sum, o) => sum + o.costNanoUsd, 0));
    const report = files.get("wyniki/r1/report.md") ?? "";
    expect(report).toContain("# Ewaluacja Trybunału CV — r1");
    expect(report).toContain("2026-10-16 · Claude (modele z konfiguracji sądu) · przypadki: 2 · powtórzenia: 2 · rundy debaty: 1");
    expect(report).toContain(`Wydano łącznie: ${formatUsd(spent)} (z rozprawami przerwanymi`);
    expect(logs[0]).toBe("Ewaluacja: 2 przypadkow x 2 wariantow x 2 powtorzen; gotowe wczesniej: 0");
    expect(logs).toContain("v1 a #1: invite, oczekiwano invite");
    expect(logs.at(-1)).toBe(`Wydano ${formatUsd(spent)} (w katalogu lacznie ${formatUsd(spent)}). Raport: wyniki/r1/report.md`);
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

  it("--cases zaweza zbior; domyslnie 3 powtorzenia promptow sadu", async () => {
    const { io, files } = memoryIo();
    expect(await evaluate([...RUN, "--cases", "b"], io)).toBe(0);
    expect(saved(files)).toHaveLength(3);
    expect(new Set(saved(files).map((o) => o.variant))).toEqual(new Set(["v4"]));
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

describe("evaluate — wznowienie, budzet i przerwania", () => {
  it("wznowienie: gotowe rozprawy pominiete, wiecej powtorzen dopisuje kolejne", async () => {
    const { io, files, logs } = memoryIo();
    await evaluate([...RUN, "--repeats", "1", "--variants", "v1"], io);
    logs.length = 0;
    expect(await evaluate([...RUN, "--repeats", "2", "--variants", "v1"], io)).toBe(0);
    expect(logs[0]).toContain("gotowe wczesniej: 2");
    expect(saved(files).map((o) => o.repeat)).toEqual([0, 0, 1, 1]);
    expect(JSON.parse(files.get("wyniki/r1/meta.json") ?? "")).toMatchObject({ repeats: 2, startedAt: "2026-10-16T10:00:00.000Z" });
    // Mniej powtorzen niz zapisano nie zmniejsza liczby w parametrach.
    await evaluate([...RUN, "--repeats", "1", "--variants", "v1"], io);
    expect(JSON.parse(files.get("wyniki/r1/meta.json") ?? "")).toMatchObject({ repeats: 2 });
  });

  it("wznowienie z innymi parametrami rozprawy to blad — wyniki nie bylyby porownywalne", async () => {
    const { io } = memoryIo();
    await evaluate([...RUN, "--repeats", "1", "--variants", "v1"], io);
    await expect(evaluate([...RUN, "--rounds", "2"], io)).rejects.toThrow("wyniki/r1 zawiera przebieg z innymi parametrami (llm anthropic, rundy 1) — wybierz inny katalog");
    await expect(evaluate([...RUN, "--llm", "heuristic"], io)).rejects.toThrow(UsageError);
  });

  it("wznowienie na zmienionym zbiorze (inne CV) to blad; zmiana --cases i przebieg sprzed odcisku przechodza", async () => {
    const { io, files } = memoryIo();
    await evaluate([...RUN, "--repeats", "1", "--variants", "v1", "--cases", "a"], io);
    // Inny wycinek tego samego zbioru — ten sam odcisk.
    expect(await evaluate([...RUN, "--repeats", "1", "--variants", "v1", "--cases", "b"], io)).toBe(0);
    files.set("ds/cvs/b.md", "Lubię gotować i piec.");
    await expect(evaluate([...RUN, "--repeats", "1", "--variants", "v1"], io)).rejects.toThrow(
      "wyniki/r1 zaczeto na innym zbiorze (zmienily sie CV albo oferty) — wyniki nie bylyby porownywalne, wybierz inny katalog",
    );
    // Katalog sprzed odcisku (meta bez datasetHash) wznawia sie jak dawniej.
    const meta = JSON.parse(files.get("wyniki/r1/meta.json") ?? "") as Record<string, unknown>;
    delete meta.datasetHash;
    files.set("wyniki/r1/meta.json", JSON.stringify(meta));
    expect(await evaluate([...RUN, "--repeats", "1", "--variants", "v1"], io)).toBe(0);
  });

  it("wyczerpany budzet przebiegu: kod 1, raport bez wynikow i podpowiedz", async () => {
    // Budzet rezerwuje najgorszy koszt zapytania, wiec zadna rozprawa sie nie zmiesci.
    const { io, files, logs } = memoryIo();
    expect(await evaluate([...RUN, "--variants", "v1", "--repeats", "1", "--budget-usd", "0.0000001"], io)).toBe(1);
    expect(files.get("wyniki/r1/outcomes.jsonl")).toBeUndefined();
    expect(files.get("wyniki/r1/report.md")).toContain("Brak wyników — żadna rozprawa nie została zapisana.");
    expect(logs.at(-1)).toContain("Budzet przebiegu wyczerpany");
    expect(logs.at(-1)).toContain("limit liczy sie dla calego katalogu");
  });

  it("limit budzetu dotyczy calego katalogu: wznowienie dostaje tylko reszte", async () => {
    const { io, files } = memoryIo();
    await evaluate([...RUN, "--variants", "v1", "--repeats", "1"], io);
    const spent = spentOf(files);
    expect(spent).toBeGreaterThan(0);
    const limit = (spent / 1e9).toFixed(9);
    await expect(evaluate([...RUN, "--variants", "v1", "--repeats", "2", "--budget-usd", limit], io)).rejects.toThrow(
      `Budzet wyczerpany: w wyniki/r1 wydano juz ${formatUsd(spent)} z limitu ${formatUsd(spent)} — podnies --budget-usd`,
    );
    // Wiekszy limit: wydatki sie sumuja.
    expect(await evaluate([...RUN, "--variants", "v1", "--repeats", "2"], io)).toBe(0);
    expect(spentOf(files)).toBe(2 * spent);
  });

  it("budzet jednej rozprawy przerywa tylko ja; --retry-aborted powtarza przerwane, a nie zakonczone", async () => {
    const { io, files, logs } = memoryIo();
    const once = (...extra: string[]) => evaluate([...RUN, "--variants", "v1", "--repeats", "1", ...extra], io);
    expect(await once("--trial-budget-usd", "0.0000001")).toBe(0);
    expect(saved(files).every((o) => o.decision === null && (o.abortReason ?? "").includes("Budzet"))).toBe(true);
    // Bez flagi przerwane licza sie jako gotowe.
    logs.length = 0;
    expect(await once()).toBe(0);
    expect(logs[0]).toContain("gotowe wczesniej: 2");
    logs.length = 0;
    expect(await once("--retry-aborted")).toBe(0);
    expect(logs[0]).toContain("gotowe wczesniej: 0");
    expect(saved(files)).toHaveLength(4);
    expect(files.get("wyniki/r1/report.md")).toContain("| Rozprawy (zakończone / wszystkie) | 2 / 2 |");
    logs.length = 0;
    expect(await once("--retry-aborted")).toBe(0);
    expect(logs[0]).toContain("gotowe wczesniej: 2");
  });

  it("tytul raportu z nazwy katalogu, takze przy sciezce z ukosnikami Windows", async () => {
    const { io, files } = memoryIo();
    await evaluate(["--dataset", "ds", "--out", "wyniki\\r2", "--variants", "v1", "--repeats", "1"], io);
    expect(files.get("wyniki\\r2/report.md")).toContain("# Ewaluacja Trybunału CV — r2\n");
  });

  it("Ctrl+C przed startem: kod 1 i podpowiedz o wznowieniu", async () => {
    const controller = new AbortController();
    controller.abort();
    const { io, logs } = memoryIo({ signal: controller.signal });
    expect(await evaluate(RUN, io)).toBe(1);
    expect(logs.at(-1)).toBe("Przebieg niepelny — uruchom to samo polecenie, zeby dokonczyc.");
  });

  it("Ctrl+C w polowie: zapisane zostaja, kod 1", async () => {
    const controller = new AbortController();
    let calls = 0;
    const interrupting: LlmClient = {
      generate: (request, signal) => {
        if (++calls === 15) controller.abort();
        return new FakeLlmClient(heuristicScript).generate(request, signal);
      },
    };
    const { io, files } = memoryIo({ signal: controller.signal, createLlm: () => interrupting });
    expect(await evaluate([...RUN, "--variants", "v1", "--repeats", "1"], io)).toBe(1);
    expect(saved(files)).toHaveLength(1);
  });
});
