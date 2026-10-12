import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { anonymize } from "./pii.js";

describe("anonymize — dane kontaktowe", () => {
  it.each([
    ["anna.nowak+cv@gmail.com", "[EMAIL]", "email"],
    ["łukasz@poczta.example.pl", "[EMAIL]", "email"],
    ["https://github.com/annanowak", "[LINK]", "link"],
    ["www.annanowak.dev/portfolio", "[LINK]", "link"],
    ["linkedin.com/in/anna-nowak", "[LINK]", "link"],
    ["+48 601 234 567", "[TELEFON]", "phone"],
    ["601-234-567", "[TELEFON]", "phone"],
    ["(22) 123 45 67", "[TELEFON]", "phone"],
    ["0048601234567", "[TELEFON]", "phone"],
    ["95031212345", "[PESEL]", "pesel"],
    ["Data urodzenia: 12.03.1995", "[DATA URODZENIA]", "birthDate"],
    ["ur. 1-3-1995", "[DATA URODZENIA]", "birthDate"],
    ["00-950", "[KOD POCZTOWY]", "postalCode"],
    ["ul. Kwiatowa 5/12", "[ADRES]", "street"],
    ["al. Jana Pawła 12a", "[ADRES]", "street"],
  ])("%s -> %s", (input, replacement, kind) => {
    const result = anonymize(`Kontakt: ${input}, dalej tekst`);
    expect(result.text).toBe(`Kontakt: ${replacement}, dalej tekst`);
    expect(result.found).toEqual({ [kind]: 1 });
  });

  it("liczy kazdy rodzaj osobno", () => {
    const result = anonymize("a@b.pl, c@d.pl, tel. 601 234 567");
    expect(result.text).toBe("[EMAIL], [EMAIL], tel. [TELEFON]");
    expect(result.found).toEqual({ email: 2, phone: 1 });
  });
});

describe("anonymize — tresc zawodowa zostaje", () => {
  it.each([
    "2019 - 2023: Java, Spring Boot 3.2",
    "Zespol 12 osob, 150 000 uzytkownikow",
    "Wersje 1.2.3.4.5.6.7.8.9",
    "Certyfikat AWS SAA-C03",
    "Obsluga 3000000 zamowien",
    "Python 3.12, Node 24.15.0",
    "ul. bez numeru",
    "Kod 1234-567",
  ])("%s", (text) => {
    expect(anonymize(text)).toEqual({ text, found: {} });
  });

  it("tekst bez danych osobowych przechodzi bez zmian (wlasciwosc)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z ,;:!?]{0,200}$/), (text) => {
        expect(anonymize(text).text).toBe(text);
      }),
    );
  });

  it("anonimizacja jest idempotentna (wlasciwosc)", () => {
    const piece = fc.constantFrom("Java", " ", "a@b.pl", "601 234 567", "00-950", "95031212345", "https://x.dev", "2019-2023", "\n");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (pieces) => {
        const once = anonymize(pieces.join("")).text;
        expect(anonymize(once).text).toBe(once);
      }),
    );
  });
});

describe("anonymize — imie i nazwisko", () => {
  it("zamienia calosc jako jedno, a czesci osobno, bez wzgledu na wielkosc liter", () => {
    const result = anonymize("Anna Nowak\nPani NOWAK prowadzila zespol. Anna lubi Jave.", "Anna Nowak");
    expect(result.text).toBe("[KANDYDAT]\nPani [KANDYDAT] prowadzila zespol. [KANDYDAT] lubi Jave.");
    expect(result.found).toEqual({ name: 3 });
  });

  it("nie rusza slow, ktore tylko zawieraja imie", () => {
    expect(anonymize("Annapurna i Nowakowski", "Anna Nowak").text).toBe("Annapurna i Nowakowski");
  });

  it("znaki specjalne w nazwisku nie psuja wyrazenia", () => {
    expect(anonymize("O'Brien (Jr.) pisze", "O'Brien (Jr.)").text).toBe("[KANDYDAT] pisze");
  });

  it("puste albo jednoliterowe imie niczego nie zmienia", () => {
    expect(anonymize("A B C", "  ")).toEqual({ text: "A B C", found: {} });
    expect(anonymize("A B C", "A")).toEqual({ text: "A B C", found: {} });
  });
});
