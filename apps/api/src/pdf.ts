import { Worker } from "node:worker_threads";
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

/** Odpowiedz watku: tekst albo blad (UnreadablePdfError przechodzi z komunikatem, inne — jako ogolne). */
export type PdfWorkerReply = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly readable: boolean; readonly message: string };

export interface IsolatedPdfOptions {
  /** Po tylu ms watek jest zabijany, a plik odrzucony. */
  readonly timeoutMs?: number;
  /** Plik watku — w testach podmieniany na taki, ktory nie odpowiada albo pada. */
  readonly workerUrl?: URL;
}

/** Limit pamieci watku: CV do 2 MB nie potrzebuje wiecej, a "bomba" w PDF nie zje pamieci serwera. */
const WORKER_HEAP_MB = 256;

const defaultWorkerUrl = () => new URL(import.meta.url.endsWith(".ts") ? "./pdf-worker.ts" : "./pdf-worker.js", import.meta.url);

/**
 * pdfToText w osobnym watku z limitem czasu i pamieci. Spreparowany PDF (petla w strukturze,
 * tysiace obiektow) zajalby w glownym watku procesor serwera i zatrzymal strumienie wszystkich rozpraw.
 */
export async function readPdfIsolated(bytes: Uint8Array, options: IsolatedPdfOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  // execArgv: []: watek nie dziedziczy flag procesu (np. --input-type), ktore moglyby go zepsuc.
  const worker = new Worker(options.workerUrl ?? defaultWorkerUrl(), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new UnreadablePdfError(`PDF czyta sie dluzej niz ${String(timeoutMs / 1000)} s — wklej tresc CV jako tekst`));
      }, timeoutMs);
      worker.once("message", (reply: PdfWorkerReply) => {
        if (reply.ok) resolve(reply.text);
        else reject(reply.readable ? new UnreadablePdfError(reply.message) : new Error(reply.message));
      });
      // Pad watku, np. przekroczony limit pamieci.
      worker.once("error", (error: Error) => {
        reject(new UnreadablePdfError(`Nie mozna odczytac PDF: ${error.message}`));
      });
      worker.once("exit", () => {
        reject(new UnreadablePdfError("Nie mozna odczytac PDF: watek zakonczyl sie bez odpowiedzi"));
      });
      worker.postMessage(new Uint8Array(bytes));
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
