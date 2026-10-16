import { describe, expect, it } from "vitest";
import { UsageError } from "./args.js";
import { readDataset, readOptional } from "./io.js";
import { type Meta, MetaSchema, reportMeta } from "./meta.js";
import { memoryIo } from "./test/memory-io.js";

const meta: Meta = { llm: "anthropic", repeats: 3, debateRounds: 1, startedAt: "2026-10-16T10:00:00.000Z", dataset: "ds", spentNanoUsd: 5 };

describe("reportMeta", () => {
  it("naglowek raportu z parametrow przebiegu", () => {
    expect(reportMeta(meta, "evals/results/v1")).toEqual({
      title: "Ewaluacja Trybunału CV — v1",
      date: "2026-10-16",
      repeats: 3,
      debateRounds: 1,
      spentNanoUsd: 5,
      llm: "Claude (modele z konfiguracji sądu)",
    });
    expect(reportMeta({ ...meta, llm: "heuristic" }, "x").llm).toBe("heurystyka słów kluczowych (bez modelu)");
  });

  it("tytul z nazwy katalogu takze przy ukosnikach Windows", () => {
    expect(reportMeta(meta, "C:\\wyniki\\r2").title).toBe("Ewaluacja Trybunału CV — r2");
  });

  it("schemat odrzuca ujemny wydatek i nieznany model", () => {
    expect(MetaSchema.safeParse({ ...meta, spentNanoUsd: -1 }).success).toBe(false);
    expect(MetaSchema.safeParse({ ...meta, llm: "gpt" }).success).toBe(false);
  });
});

describe("odczyt plikow", () => {
  it("readOptional: brak pliku to null, nie blad", async () => {
    const { io } = memoryIo();
    expect(await readOptional(io, "brak")).toBeNull();
    expect(await readOptional(io, "ds/cvs/a.md")).toBe("Java, Spring Boot, PostgreSQL");
  });

  it("readDataset: blad zbioru to blad wywolania z nazwa katalogu", async () => {
    const { io } = memoryIo();
    expect(await readDataset(io, "ds")).toHaveLength(2);
    const failure = readDataset(io, "brak");
    await expect(failure).rejects.toThrow(UsageError);
    await expect(failure).rejects.toThrow("Nie mozna wczytac zbioru brak: ENOENT brak/cases.json");
  });
});
