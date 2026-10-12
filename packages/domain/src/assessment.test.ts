import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Assessment, AssessmentSchema, findInventedQuotes, ScoreSchema } from "./assessment.js";

const valid: Assessment = {
  criticId: "techLead",
  score: 6,
  summary: "Solidny backend, slabo udokumentowany frontend.",
  strengths: ["Projekt gieldy z testami mutacyjnymi"],
  concerns: [{ quote: "Ekspert React", issue: "brak projektu w React", severity: "high" }],
  rewrites: [
    {
      original: "Odpowiadalem za API",
      proposed: "Zbudowalem API obslugujace 1000 zlecen/s",
      reason: "liczby zamiast obowiazkow",
    },
  ],
};

const parse = (overrides: Record<string, unknown>) =>
  AssessmentSchema.safeParse({ ...valid, ...overrides }).success;

describe("AssessmentSchema", () => {
  it("przyjmuje poprawna ocene", () => {
    expect(AssessmentSchema.parse(valid)).toEqual(valid);
  });

  it("przycina biale znaki w tekstach", () => {
    expect(AssessmentSchema.parse({ ...valid, summary: "  ok  " }).summary).toBe("ok");
  });

  it.each([
    ["nieznany krytyk", { criticId: "judge" }],
    ["ocena 0", { score: 0 }],
    ["ocena 11", { score: 11 }],
    ["ocena ulamkowa", { score: 6.5 }],
    ["cytat krotszy niz 3 znaki", { concerns: [{ quote: "AI", issue: "b", severity: "low" }] }],
    ["cytat bez liter", { concerns: [{ quote: "2020 - 2024", issue: "b", severity: "low" }] }],
    ["poprawiany fragment bez liter", { rewrites: [{ original: "...", proposed: "x", reason: "r" }] }],
    ["puste podsumowanie", { summary: "   " }],
    ["za dlugie podsumowanie", { summary: "x".repeat(1001) }],
    ["szesc mocnych stron", { strengths: Array.from({ length: 6 }, () => "x") }],
    ["pusta mocna strona", { strengths: [""] }],
    ["nieznana waga zastrzezenia", { concerns: [{ quote: "Java", issue: "b", severity: "x" }] }],
    ["zastrzezenie bez cytatu", { concerns: [{ quote: "", issue: "b", severity: "low" }] }],
    ["poprawka bez zmian", { rewrites: [{ original: "Java", proposed: "Java", reason: "r" }] }],
  ])("odrzuca: %s", (_, overrides) => {
    expect(parse(overrides)).toBe(false);
  });

  it.each(["low", "medium", "high"])("przyjmuje wage zastrzezenia %s", (severity) => {
    expect(parse({ concerns: [{ quote: "Java", issue: "b", severity }] })).toBe(true);
  });

  it("mowi, dlaczego poprawka jest odrzucona", () => {
    const result = AssessmentSchema.safeParse({ ...valid, rewrites: [{ original: "Java", proposed: "Java", reason: "r" }] });
    expect(result.error?.issues[0]?.message).toBe("Poprawka niczego nie zmienia");
  });

  it("mowi, dlaczego cytat jest odrzucony", () => {
    const result = AssessmentSchema.safeParse({ ...valid, concerns: [{ quote: "2020", issue: "b", severity: "low" }] });
    expect(result.error?.issues[0]?.message).toBe("Cytat musi zawierac litery");
  });

  it("dopuszcza puste listy", () => {
    expect(parse({ strengths: [], concerns: [], rewrites: [] })).toBe(true);
  });

  it("dopuszcza tekst na granicy dlugosci", () => {
    expect(parse({ summary: "x".repeat(1000) })).toBe(true);
  });
});

describe("ScoreSchema", () => {
  it("przyjmuje kazda calkowita od 1 do 10", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), (s) => ScoreSchema.safeParse(s).success));
  });

  it("odrzuca kazda calkowita spoza 1..10", () => {
    const outside = fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 11 }));
    fc.assert(fc.property(outside, (s) => !ScoreSchema.safeParse(s).success));
  });
});

describe("findInventedQuotes", () => {
  const cv = "Mikolaj Kowalski\nEkspert   React\nOdpowiadalem za\nAPI gieldy.";

  it("nie zglasza cytatow, ktore sa w CV mimo innych bialych znakow i wielkosci liter", () => {
    expect(findInventedQuotes(valid, cv)).toEqual([]);
    expect(findInventedQuotes(valid, cv.toUpperCase())).toEqual([]);
  });

  const quoting = (...quotes: string[]): Assessment => ({
    ...valid,
    concerns: quotes.map((quote) => ({ quote, issue: "x", severity: "low" })),
    rewrites: [],
  });

  it("cytat z bialym znakiem na koncu pasuje do konca CV", () => {
    expect(findInventedQuotes(quoting("API gieldy.\n"), cv)).toEqual([]);
  });

  it("sklejone slowa nie sa cytatem slow rozdzielonych", () => {
    expect(findInventedQuotes(quoting("EkspertReact"), cv)).toEqual(["EkspertReact"]);
  });

  it("porownanie po malych literach: ss nie jest cytatem ß", () => {
    expect(findInventedQuotes(quoting("STRASSE"), "Mieszkam przy Straße")).toEqual(["STRASSE"]);
  });

  const char = (code: number) => String.fromCodePoint(code);

  it("polskie litery rozlozone na znak i ogonek (NFD, czesto z PDF) pasuja do zlozonych", () => {
    const pdf = "Zarządzałem zespołem".normalize("NFD");
    expect(findInventedQuotes(quoting("zarządzałem zespołem"), pdf)).toEqual([]);
  });

  it("miekki lacznik i znak zerowej szerokosci z PDF nie psuja cytatu", () => {
    const pdf = `Odpowie${char(0xad)}dzialny za wdro${char(0x200b)}zenie`;
    expect(findInventedQuotes(quoting("odpowiedzialny za wdrozenie"), pdf)).toEqual([]);
  });

  it("typograficzne cudzyslowy i myslniki to te same znaki co proste", () => {
    const cv = `Projekt ${char(0x201e)}Parkiet${char(0x201d)} ${char(0x2013)} gielda`;
    expect(findInventedQuotes(quoting('Projekt "Parkiet" - gielda'), cv)).toEqual([]);
    expect(findInventedQuotes(quoting(`Projekt ${char(0x2018)}Parkiet${char(0x2019)}`), "Projekt 'Parkiet'")).toEqual([]);
  });

  it("zglasza zmyslony cytat zastrzezenia i zmyslony fragment poprawki", () => {
    const invented: Assessment = {
      ...valid,
      concerns: [{ quote: "10 lat w Google", issue: "x", severity: "low" }],
      rewrites: [{ original: "Kierowalem zespolem", proposed: "Prowadzilem 5 osob", reason: "r" }],
    };
    expect(findInventedQuotes(invented, cv)).toEqual(["10 lat w Google", "Kierowalem zespolem"]);
  });

  it("cytat bedacy fragmentem CV zawsze jest uznany, takze poza ASCII", () => {
    // Model cytuje cale znaki, wiec tniemy po grafemach, nie po jednostkach UTF-16.
    const segmenter = new Intl.Segmenter("pl", { granularity: "grapheme" });
    fc.assert(
      fc.property(fc.string({ minLength: 1, unit: "grapheme" }), fc.nat(), fc.nat(), (text, a, b) => {
        const graphemes = [...segmenter.segment(text)].map((s) => s.segment);
        const start = a % graphemes.length;
        const quote = graphemes.slice(start, start + 1 + (b % (graphemes.length - start))).join("");
        fc.pre(quote.trim().length > 0);
        const assessment = { ...valid, concerns: [{ quote, issue: "x", severity: "low" as const }], rewrites: [] };
        return findInventedQuotes(assessment, text).length === 0;
      }),
    );
  });
});
