import { MAX_CV_CHARS, MAX_JOB_OFFER_CHARS, MAX_PDF_BYTES } from "@trybunal/domain";

export type CvMode = "text" | "pdf";

/** Bledy formularza przed wyslaniem; pusta lista — mozna wnosic. */
export function validate(input: { cvMode: CvMode; cvText: string; file: File | null; jobOffer: string }): string[] {
  const problems: string[] = [];
  if (input.cvMode === "text") {
    if (input.cvText.trim() === "") problems.push("Wklej treść CV.");
    else if (input.cvText.length > MAX_CV_CHARS) problems.push(`CV jest za długie (maks. ${String(MAX_CV_CHARS)} znaków).`);
  } else if (input.file === null) {
    problems.push("Wybierz plik PDF z CV.");
  } else if (input.file.size > MAX_PDF_BYTES) {
    // Za duzy plik odrzucamy, zanim poleci przez siec (ten sam limit co na serwerze).
    problems.push(`Plik PDF jest za duży (maks. ${String(MAX_PDF_BYTES / 1024 / 1024)} MB).`);
  }
  if (input.jobOffer.trim() === "") problems.push("Wklej treść ogłoszenia.");
  else if (input.jobOffer.length > MAX_JOB_OFFER_CHARS) problems.push(`Ogłoszenie jest za długie (maks. ${String(MAX_JOB_OFFER_CHARS)} znaków).`);
  return problems;
}
