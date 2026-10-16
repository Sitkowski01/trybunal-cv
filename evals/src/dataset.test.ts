import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_CV_CHARS, MAX_JOB_OFFER_CHARS } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { EvalCaseSchema, loadDataset, ManifestSchema, TAGS } from "./dataset.js";

const entry = { id: "a-1", cv: "cvs/a-1.md", offer: "offers/o.md", expected: "invite", tags: ["mocne"], note: "bo tak" };

describe("schemat przypadku", () => {
  it("przyjmuje poprawny wpis", () => {
    expect(EvalCaseSchema.parse(entry)).toEqual(entry);
  });

  it.each([
    ["id z wielka litera", { id: "A" }],
    ["sciezka wychodzaca poza zbior", { cv: "../sekret.md" }],
    ["sciezka bez katalogu", { offer: "o.md" }],
    ["nieznany werdykt", { expected: "maybe" }],
    ["nieznany tag", { tags: ["swietne"] }],
    ["bez tagow", { tags: [] }],
    ["za duzo tagow", { tags: ["mocne", "liczby", "luka", "ats"] }],
    ["pusta notatka", { note: "  " }],
    ["dodatkowe pole", { score: 7 }],
  ])("odrzuca: %s", (_, change) => {
    expect(EvalCaseSchema.safeParse({ ...entry, ...change }).success).toBe(false);
  });

  it("manifest: niepusty i bez powtorzonych id", () => {
    expect(ManifestSchema.safeParse([]).success).toBe(false);
    const dup = ManifestSchema.safeParse([entry, { ...entry, cv: "cvs/b.md" }]);
    expect(dup.error?.issues).toMatchObject([{ path: [1, "id"], message: "Powtorzone id: a-1" }]);
    expect(ManifestSchema.safeParse([entry, { ...entry, id: "b" }]).success).toBe(true);
  });
});

describe("loadDataset", () => {
  it("czyta manifest i pliki wzgledem katalogu zbioru", async () => {
    const files: Record<string, string> = {
      "ds/cases.json": JSON.stringify([entry]),
      "ds/cvs/a-1.md": "CV",
      "ds/offers/o.md": "Oferta",
    };
    const read = (path: string) => (path in files ? Promise.resolve(files[path] ?? "") : Promise.reject(new Error(`brak ${path}`)));
    expect(await loadDataset("ds", read)).toEqual([{ ...entry, cvText: "CV", offerText: "Oferta" }]);
    await expect(loadDataset("inny", read)).rejects.toThrow("brak inny/cases.json");
  });
});

describe("zbior w repozytorium", () => {
  const dir = fileURLToPath(new URL("../dataset", import.meta.url));
  const load = () => loadDataset(dir, (path) => readFile(path, "utf8"));

  it("wczytuje sie, a CV i oferty mieszcza sie w limitach rozprawy", async () => {
    const cases = await load();
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const c of cases) {
      expect(c.cvText.length, c.id).toBeLessThanOrEqual(MAX_CV_CHARS);
      expect(c.offerText.length, c.id).toBeLessThanOrEqual(MAX_JOB_OFFER_CHARS);
    }
  });

  it("same fikcyjne osoby i oferty — zbior jest publiczny", async () => {
    for (const c of await load()) {
      expect(c.cvText, c.id).toContain("Osoba fikcyjna");
      expect(c.offerText, c.id).toContain("Oferta fikcyjna");
      expect(c.cvText, c.id).not.toMatch(/@|\+48|\d{3}[ -]\d{3}[ -]\d{3}/);
    }
  });

  it("pokrywa kazdy tag i oba werdykty", async () => {
    const cases = await load();
    expect(new Set(cases.flatMap((c) => c.tags))).toEqual(new Set(TAGS));
    expect(new Set(cases.map((c) => c.expected))).toEqual(new Set(["invite", "reject"]));
  });
});
