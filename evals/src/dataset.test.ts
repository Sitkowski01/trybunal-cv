import { describe, expect, it } from "vitest";
import { EvalCaseSchema, loadDataset, ManifestSchema } from "./dataset.js";

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
