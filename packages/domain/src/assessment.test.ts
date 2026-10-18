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

  it("sigma koncowa w cytacie i ta sama sigma w srodku tekstu CV to ta sama litera", () => {
    // Matematyczne "A" i "Σ". toLowerCase daje "ς" na koncu slowa, a "σ", gdy za apostrofem idzie litera.
    const cv = `${char(0x1d400)}${char(0x1d6f4)}'B`;
    expect(findInventedQuotes(quoting(`${char(0x1d400)}${char(0x1d6f4)}`), cv)).toEqual([]);
  });

  it("fragment slowa nie jest cytatem: Java z JavaScript, 5 lat z 15 lat", () => {
    const cv = "JavaScript, React. 15 lat (w tym Java) i Spring-Boot";
    expect(findInventedQuotes(quoting("Java", "Script", "5 lat", "ava"), "JavaScript i 15 lat")).toEqual(["Java", "Script", "5 lat", "ava"]);
    expect(findInventedQuotes(quoting("Java", "15 lat", "(w tym Java)", "Spring", "Boot", "React."), cv)).toEqual([]);
    // Litery w zgodnosciowej postaci (kontrprzyklad z fast-check): po normalizacji to wciaz srodek slowa.
    expect(findInventedQuotes(quoting(char(0x314f)), `${char(0x3141)}${char(0x314f)} `)).toEqual([char(0x314f)]);
  });

  it("slowo przeniesione do nastepnej linii w PDF pasuje do calego slowa; zwykly lacznik zostaje", () => {
    const pdf = "Odpowiadalem za wdro-\nzenie i wdro\u2010  \r\n  zenia, flaga bialo-\nczerwona";
    expect(findInventedQuotes(quoting("za wdrozenie", "wdrozenia", "bialo-czerwona"), pdf)).toEqual([]);
    const nfd = "zarzą-\ndzanie".normalize("NFD");
    expect(findInventedQuotes(quoting("zarządzanie"), nfd)).toEqual([]);
    // Lacznik bez konca linii to zwykly lacznik, a konca linii po cyfrze nie sklejamy.
    expect(findInventedQuotes(quoting("wdrozenie", "2020"), "wdro- zenie 20-\n20")).toEqual(["wdrozenie", "2020"]);
  });

  it("cytat bez polskich znakow pasuje do CV z nimi, ale l to nie l z kreska", () => {
    expect(findInventedQuotes(quoting("Zarzadzalem zespolem"), "Zarządzałem zespołem")).toEqual(["Zarzadzalem zespolem"]);
    expect(findInventedQuotes(quoting("Zarzadzałem zespołem"), "Zarządzałem zespołem")).toEqual([]);
  });

  it("ogonek i kropka jako osobne znaki z odstępem (niektóre PDF) nie psują cytatu", () => {
    // Ekstraktor PDF z LaTeX-a: "a" + ogonek z odstepem, kropka z odstepem + "z".
    const pdf = `Zarza${char(0x02db)}dzałem, ${char(0x02d9)}zaden problem`;
    expect(findInventedQuotes(quoting("Zarządzałem, żaden problem"), pdf)).toEqual([]);
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

  it("cytat z calych slow CV zawsze jest uznany, takze poza ASCII", () => {
    // Slowa z dowolnych grafemow (model cytuje cale znaki), miedzy nimi zwykle separatory.
    const separator = fc.constantFrom(" ", "\n", ", ", ". ", " - ", "\t");
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.string({ minLength: 1, unit: "grapheme" }), separator), { minLength: 1 }), fc.nat(), fc.nat(), (parts, a, b) => {
        const text = parts.map(([word, sep]) => word + sep).join("");
        const start = a % parts.length;
        const words = parts.slice(start, start + 1 + (b % (parts.length - start)));
        const quote = words.map(([word, sep], i) => (i === words.length - 1 ? word : word + sep)).join("");
        fc.pre(quote.trim().length > 0);
        const assessment = { ...valid, concerns: [{ quote, issue: "x", severity: "low" as const }], rewrites: [] };
        return findInventedQuotes(assessment, text).length === 0;
      }),
    );
  });

  it("slowo przeniesione w dowolnym miejscu pasuje do calego slowa", () => {
    const letter = fc.constantFrom(...Array.from("abcąćęłńóśźżXYZĄŻ"));
    fc.assert(
      fc.property(fc.string({ minLength: 2, maxLength: 15, unit: letter }), fc.nat(), (word, k) => {
        const cut = 1 + (k % (word.length - 1));
        const pdf = `CV: ${word.slice(0, cut)}-\n${word.slice(cut)} koniec`;
        return findInventedQuotes({ ...valid, concerns: [{ quote: word, issue: "x", severity: "low" }], rewrites: [] }, pdf).length === 0;
      }),
    );
  });
});
