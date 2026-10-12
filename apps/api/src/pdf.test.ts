import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES, pdfToText, UnreadablePdfError } from "./pdf.js";

/** PDF z podanymi stronami tekstu; pusta strona = strona bez warstwy tekstowej (jak skan). */
async function pdf(pages: readonly string[], options: { password?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([400, 400]);
    if (text !== "") page.drawText(text, { x: 20, y: 350, size: 12, font });
  }
  // Klasyczna tablica xref (bez strumieni obiektow), zeby dalo sie dopisac slownik do trailera.
  const bytes = await doc.save({ useObjectStreams: false });
  if (options.password === undefined) return bytes;
  // pdf-lib nie szyfruje — wystarczy slownik /Encrypt w trailerze, zeby pdf.js zazadal hasla.
  const text = Buffer.from(bytes).toString("latin1");
  const encrypted = text.replace("trailer\n<<", "trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>");
  if (encrypted === text) throw new Error("brak trailera w PDF z pdf-lib");
  return new Uint8Array(Buffer.from(encrypted, "latin1"));
}

describe("pdfToText", () => {
  it("wyciaga tekst stron w kolejnosci, oddzielony pusta linia", async () => {
    expect(await pdfToText(await pdf(["Anna Nowak, Java", "Projekty: sklep"]))).toBe("Anna Nowak, Java\n\nProjekty: sklep");
  });

  it("pomija puste strony i nie zmienia bufora wywolujacego", async () => {
    const bytes = await pdf(["", "  Java  ", ""]);
    const copy = bytes.slice();
    expect(await pdfToText(bytes)).toBe("Java");
    expect(bytes).toEqual(copy);
  });

  it("odrzuca plik, ktory nie jest PDF-em", async () => {
    await expect(pdfToText(new TextEncoder().encode("Anna Nowak, Java"))).rejects.toThrow(new UnreadablePdfError("Plik nie jest PDF-em"));
  });

  it("odrzuca PDF bez tekstu (skan) z podpowiedzia", async () => {
    await expect(pdfToText(await pdf(["", ""]))).rejects.toThrow(/warstwy tekstowej/);
  });

  it("odrzuca uszkodzony PDF jako nieczytelny, a nie bledem serwera", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\nto nie jest pdf");
    await expect(pdfToText(broken)).rejects.toThrow(/^Nie mozna odczytac PDF: /);
    await expect(pdfToText(broken)).rejects.toBeInstanceOf(UnreadablePdfError);
  });

  it("odrzuca zaszyfrowany PDF", async () => {
    await expect(pdfToText(await pdf(["tajne"], { password: "x" }))).rejects.toThrow(/^Nie mozna odczytac PDF: .*(password|encrypt)/i);
  });

  it(`odrzuca wiecej niz ${String(MAX_PDF_PAGES)} stron, przyjmuje dokladnie tyle`, async () => {
    await expect(pdfToText(await pdf(Array<string>(MAX_PDF_PAGES + 1).fill("x")))).rejects.toThrow(
      `CV ma ${String(MAX_PDF_PAGES + 1)} stron, limit to ${String(MAX_PDF_PAGES)}`,
    );
    await expect(pdfToText(await pdf(Array<string>(MAX_PDF_PAGES).fill("x")))).resolves.toContain("x");
  });
});
