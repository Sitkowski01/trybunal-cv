import { z } from "zod";
import { CRITIC_IDS } from "./critics.js";

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const MAX_ITEMS = 5;

/** Niepusty tekst z limitem dlugosci — wspolny dla ocen i zdarzen rozprawy. */
export const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const ScoreSchema = z.number().int().min(SCORE_MIN).max(SCORE_MAX);

/** Cytat z jednej litery albo kropki prawie zawsze "jest w CV" — wiec cytat musi cos znaczyc. */
const QuoteSchema = boundedText(500).min(3).regex(/\p{L}/u, "Cytat musi zawierac litery");

export const ConcernSchema = z.object({
  quote: QuoteSchema,
  issue: boundedText(1000),
  severity: z.enum(["low", "medium", "high"]),
});

export const RewriteSchema = z
  .object({
    original: QuoteSchema,
    proposed: boundedText(500),
    reason: boundedText(500),
  })
  .refine((r) => r.original !== r.proposed, { message: "Poprawka niczego nie zmienia" });

/**
 * Ocena jednego krytyka. Ten sam schemat sprawdza odpowiedz modelu, zanim trafi do rozprawy —
 * model potrafi zwrocic ocene 11, pusta liste albo cytat, ktorego nie ma w CV.
 * Nie ma tu "zapraszam / odrzucam": o decyzji przesadza regula z ocen, nie deklaracja modelu.
 */
export const AssessmentSchema = z.object({
  criticId: z.enum(CRITIC_IDS),
  score: ScoreSchema,
  summary: boundedText(1000),
  strengths: z.array(boundedText(500)).max(MAX_ITEMS),
  concerns: z.array(ConcernSchema).max(MAX_ITEMS),
  rewrites: z.array(RewriteSchema).max(MAX_ITEMS),
});

export type Concern = z.infer<typeof ConcernSchema>;
export type Rewrite = z.infer<typeof RewriteSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;

const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const FINAL_SIGMA = /\u03c2/g;
/** Ogonek, kropka, kreska itp. jako osobny znak z odstepem \u2014 tak niektore ekstraktory PDF zapisuja "\u0105". */
const SPACING_MARKS = /[\u00a8\u00b4\u00b8\u02c7\u02d8-\u02dd]/g;

/**
 * Tekst z PDF i tekst od modelu roznia sie zapisem, nie trescia: litery zlozone albo rozlozone
 * na litere i ogonek, ogonek jako osobny znak, miekkie laczniki, typograficzne cudzyslowy
 * i myslniki. Sprowadzamy oba do jednej postaci. Dwa przypadki znalazl test wlasnosci na pelnym Unicode:
 * - rozkladamy (NFKD) i usuwamy znaki diakrytyczne zamiast skladac (NFKC): skladanie potrafi
 *   polaczyc sasiednie znaki w jeden (dwie koreanskie litery w jedna sylabe), wtedy fragment
 *   tekstu przestaje byc fragmentem. Skutek: "a" z ogonkiem i "a" sa tym samym, ale "l" z kreska
 *   nie rozklada sie na "l" \u2014 "Zarzadzalem" nie pasuje do wersji z polskimi znakami;
 * - toLowerCase zalezy od kontekstu: wielka sigma na koncu slowa daje sigme koncowa, a sama \u2014
 *   zwykla. Jak w case folding z Unicode traktujemy obie jako zwykla.
 */
const normalize = (s: string) =>
  s
    .replace(SPACING_MARKS, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(FINAL_SIGMA, "\u03c3");

/** Slowo przeniesione do nastepnej linii w PDF: "wdro-\nzenie". Litera moze konczyc sie ogonkiem (NFD). */
const HYPHENATED = /([\p{L}\p{M}])[-\u2010\u2011][^\S\n]*\r?\n\s*(?=\p{L})/gu;
const WORD_CHAR = /^[\p{L}\p{N}]$/u;

const isWordChar = (char: string | undefined) => char !== undefined && WORD_CHAR.test(char);
// Po punktach kodowych (litera spoza BMP to dwie jednostki UTF-16), wystarcza dwie jednostki.
const firstChar = (text: string) => Array.from(text.slice(0, 2))[0];
const lastChar = (text: string) => Array.from(text.slice(-2)).at(-1);

/**
 * Cytat konczy sie i zaczyna na granicy slowa: "Java" nie jest cytatem z "JavaScript", a "5 lat"
 * z "15 lat". Granica liczy sie tylko przy literze albo cyfrze na brzegu cytatu ("(React" moze
 * zaczynac sie w srodku tekstu).
 */
function containsAsWords(text: string, quote: string): boolean {
  const checkStart = isWordChar(firstChar(quote));
  const checkEnd = isWordChar(lastChar(quote));
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const startsWord = !checkStart || !isWordChar(lastChar(text.slice(Math.max(0, at - 2), at)));
    const endsWord = !checkEnd || !isWordChar(firstChar(text.slice(at + quote.length, at + quote.length + 2)));
    if (startsWord && endsWord) return true;
  }
  return false;
}

/**
 * Cytaty i poprawiane fragmenty, ktorych nie ma w CV. Model bywa przekonany, ze cytuje,
 * a parafrazuje albo zmysla — rozprawa takiej oceny nie przyjmie (zob. trial.ts).
 * Slowo przeniesione w PDF model cytuje w calosci, ale lacznik na koncu linii bywa tez zwyklym
 * ("bialo-\nczerwony") — dlatego CV porownujemy w trzech postaciach: bez zmian, sklejone bez lacznika i z nim.
 */
export function findInventedQuotes(assessment: Assessment, cvText: string): string[] {
  const versions = [...new Set([cvText, cvText.replace(HYPHENATED, "$1"), cvText.replace(HYPHENATED, "$1-")].map(normalize))];
  return [
    ...assessment.concerns.map((c) => c.quote),
    ...assessment.rewrites.map((r) => r.original),
  ].filter((quote) => !versions.some((cv) => containsAsWords(cv, normalize(quote))));
}
