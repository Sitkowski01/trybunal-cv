import { MAX_CV_CHARS, MAX_JOB_OFFER_CHARS, MAX_PDF_BYTES } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { validate } from "./validate.js";

const pdf = (size: number) => new File([new Uint8Array(size)], "cv.pdf", { type: "application/pdf" });
const ok = { cvMode: "text" as const, cvText: "Java", file: null, jobOffer: "Junior" };

describe("validate", () => {
  it("poprawne dane: brak problemow", () => {
    expect(validate(ok)).toEqual([]);
    expect(validate({ ...ok, cvMode: "pdf", cvText: "", file: pdf(MAX_PDF_BYTES) })).toEqual([]);
    expect(validate({ ...ok, cvText: "x".repeat(MAX_CV_CHARS), jobOffer: "x".repeat(MAX_JOB_OFFER_CHARS) })).toEqual([]);
  });

  it.each<[string, Parameters<typeof validate>[0], string[]]>([
    ["puste pola (same spacje)", { ...ok, cvText: "  ", jobOffer: " " }, ["Wklej treść CV.", "Wklej treść ogłoszenia."]],
    ["za dlugie teksty", { ...ok, cvText: "x".repeat(MAX_CV_CHARS + 1), jobOffer: "x".repeat(MAX_JOB_OFFER_CHARS + 1) }, ["CV jest za długie (maks. 30000 znaków).", "Ogłoszenie jest za długie (maks. 10000 znaków)."]],
    ["PDF bez pliku", { ...ok, cvMode: "pdf" }, ["Wybierz plik PDF z CV."]],
    ["za duzy PDF", { ...ok, cvMode: "pdf", file: pdf(MAX_PDF_BYTES + 1) }, ["Plik PDF jest za duży (maks. 2 MB)."]],
  ])("%s", (_, input, problems) => {
    expect(validate(input)).toEqual(problems);
  });
});
