import { parentPort } from "node:worker_threads";
// Rozszerzenie .ts: watek uruchamia ten plik takze wprost ze zrodel (testy) — Node usuwa typy,
// ale nie zamienia .js na .ts; tsc przepisuje import na .js w dist (rewriteRelativeImportExtensions).
import { pdfToText, UnreadablePdfError } from "./pdf.ts";

/** Odpowiedz watku: tekst albo blad (UnreadablePdfError przechodzi z komunikatem, inne — jako ogolne). */
export type PdfWorkerReply = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly readable: boolean; readonly message: string };

/** Watek do czytania PDF (zob. readPdfIsolated): jedno zadanie, jedna odpowiedz. */
parentPort?.once("message", (bytes: Uint8Array) => {
  pdfToText(bytes).then(
    (text) => parentPort?.postMessage({ ok: true, text } satisfies PdfWorkerReply),
    (error: unknown) =>
      parentPort?.postMessage({ ok: false, readable: error instanceof UnreadablePdfError, message: (error as Error).message } satisfies PdfWorkerReply),
  );
});
