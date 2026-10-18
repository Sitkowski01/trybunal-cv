import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readPdfIsolated, UnreadablePdfError } from "./pdf.js";

async function pdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]).drawText(text, { x: 20, y: 350, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

// Atrapy watku jako kod w data: URL — bez plikow pomocniczych.
const workerOf = (code: string) => new URL(`data:text/javascript,${encodeURIComponent(code)}`);

describe("readPdfIsolated — PDF w osobnym watku", () => {
  it("tekst z prawdziwego watku (ten sam wynik co pdfToText)", async () => {
    expect(await readPdfIsolated(await pdf("Anna Nowak, Java"))).toBe("Anna Nowak, Java");
  });

  it("nieczytelny plik: UnreadablePdfError z komunikatem z watku", async () => {
    await expect(readPdfIsolated(new TextEncoder().encode("to nie PDF"))).rejects.toEqual(new UnreadablePdfError("Plik nie jest PDF-em"));
  });

  it("watek, ktory nie odpowiada (petla w PDF): odrzucenie po limicie czasu", async () => {
    const hanging = workerOf("import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => { for (;;) {} });");
    const started = Date.now();
    await expect(readPdfIsolated(await pdf("x"), { timeoutMs: 300, workerUrl: hanging })).rejects.toEqual(
      new UnreadablePdfError("PDF czyta sie dluzej niz 0.3 s — wklej tresc CV jako tekst"),
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("pad watku i zakonczenie bez odpowiedzi to nieczytelny PDF, a nie blad serwera", async () => {
    const crashing = workerOf("throw new Error('brak pamieci');");
    await expect(readPdfIsolated(await pdf("x"), { workerUrl: crashing })).rejects.toEqual(new UnreadablePdfError("Nie mozna odczytac PDF: brak pamieci"));
    const silent = workerOf("process.exit(0);");
    await expect(readPdfIsolated(await pdf("x"), { workerUrl: silent })).rejects.toEqual(
      new UnreadablePdfError("Nie mozna odczytac PDF: watek zakonczyl sie bez odpowiedzi"),
    );
  });

  it("inny blad w watku przechodzi jako zwykly blad (500), a nie UnreadablePdfError", async () => {
    const failing = workerOf("import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => parentPort.postMessage({ ok: false, readable: false, message: 'cos innego' }));");
    const error = await readPdfIsolated(await pdf("x"), { workerUrl: failing }).catch((e: unknown) => e);
    expect(error).toEqual(new Error("cos innego"));
    expect(error).not.toBeInstanceOf(UnreadablePdfError);
  });
});
