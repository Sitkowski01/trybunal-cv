import { extractText, getDocumentProxy } from "unpdf";

/** Plik nie nadaje sie na CV: to nie PDF, jest zaszyfrowany albo nie ma warstwy tekstowej (skan). */
export class UnreadablePdfError extends Error {
  override readonly name = "UnreadablePdfError";
}

/** Zbyt dlugie CV i tak odrzuci schemat zdarzenia — tu tylko nie parsujemy setek stron. */
export const MAX_PDF_PAGES = 10;

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

/** Tekst CV z PDF: strony w kolejnosci, oddzielone pusta linia, bez bialych znakow na brzegach. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  if (!isPdf(bytes)) {
    throw new UnreadablePdfError("Plik nie jest PDF-em");
  }
  let pages: string[];
  try {
    // Kopia: pdf.js przejmuje bufor, a wywolujacy moze go jeszcze potrzebowac.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // Zwolnienie pamieci pdf.js zawsze, takze po odrzuceniu — serwer dziala dlugo.
    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new UnreadablePdfError(`CV ma ${String(pdf.numPages)} stron, limit to ${String(MAX_PDF_PAGES)}`);
      }
      pages = (await extractText(pdf, { mergePages: false })).text;
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof UnreadablePdfError) {
      throw error;
    }
    throw new UnreadablePdfError(`Nie mozna odczytac PDF: ${(error as Error).message}`);
  }
  const text = pages.map((p) => p.trim()).filter((p) => p !== "").join("\n\n");
  if (text === "") {
    throw new UnreadablePdfError("PDF nie ma warstwy tekstowej (skan?) — wklej tresc CV jako tekst");
  }
  return text;
}
