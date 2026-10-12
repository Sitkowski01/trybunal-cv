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

/**
 * Tekst z PDF i tekst od modelu roznia sie zapisem, nie trescia: litery zlozone albo rozlozone
 * na znak i ogonek, miekkie laczniki, typograficzne cudzyslowy i myslniki. Sprowadzamy oba do
 * jednej postaci. Dwa przypadki znalazl test wlasnosci na pelnym Unicode:
 * - rozkladamy (NFKD) i usuwamy znaki diakrytyczne zamiast skladac (NFKC): skladanie potrafi
 *   polaczyc sasiednie znaki w jeden (koreanskie "\u3141" + "\u314f" -> "\ub9c8"), wtedy fragment tekstu
 *   przestaje byc fragmentem. Przy okazji "Zarzadzalem" od modelu pasuje do "Zarz\u0105dza\u0142em";
 * - toLowerCase zalezy od kontekstu: wielka sigma na koncu slowa to "\u03c2", a sama \u2014 "\u03c3".
 *   Jak w case folding z Unicode traktujemy obie jako "\u03c3".
 */
const normalize = (s: string) =>
  s
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

/**
 * Cytaty i poprawiane fragmenty, ktorych nie ma w CV. Model bywa przekonany, ze cytuje,
 * a parafrazuje albo zmysla — rozprawa takiej oceny nie przyjmie (zob. trial.ts).
 */
export function findInventedQuotes(assessment: Assessment, cvText: string): string[] {
  const cv = normalize(cvText);
  return [
    ...assessment.concerns.map((c) => c.quote),
    ...assessment.rewrites.map((r) => r.original),
  ].filter((quote) => !cv.includes(normalize(quote)));
}
