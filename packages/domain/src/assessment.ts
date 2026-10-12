import { z } from "zod";
import { CRITIC_IDS } from "./critics.js";

/**
 * Ocena jednego krytyka. Ten sam schemat sprawdza odpowiedz modelu, zanim trafi do rozprawy —
 * model potrafi zwrocic ocene 11, pusta liste albo cytat, ktorego nie ma w CV.
 */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const MAX_ITEMS = 5;

const text = (max: number) => z.string().trim().min(1).max(max);

export const ScoreSchema = z.number().int().min(SCORE_MIN).max(SCORE_MAX);

export const ConcernSchema = z.object({
  quote: text(500),
  issue: text(1000),
  severity: z.enum(["low", "medium", "high"]),
});

export const RewriteSchema = z
  .object({
    original: text(500),
    proposed: text(500),
    reason: text(500),
  })
  .refine((r) => r.original !== r.proposed, { message: "Poprawka niczego nie zmienia" });

export const AssessmentSchema = z.object({
  criticId: z.enum(CRITIC_IDS),
  score: ScoreSchema,
  recommendation: z.enum(["invite", "reject"]),
  summary: text(1000),
  strengths: z.array(text(500)).max(MAX_ITEMS),
  concerns: z.array(ConcernSchema).max(MAX_ITEMS),
  rewrites: z.array(RewriteSchema).max(MAX_ITEMS),
});

export type Concern = z.infer<typeof ConcernSchema>;
export type Rewrite = z.infer<typeof RewriteSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Cytaty i poprawiane fragmenty, ktorych nie ma w CV. Model bywa przekonany, ze cytuje,
 * a parafrazuje albo zmysla — taka ocena nie moze trafic do werdyktu bez poprawki.
 * Porownanie ignoruje wielkosc liter i biale znaki (PDF lamie linie w dowolnych miejscach).
 */
export function findInventedQuotes(assessment: Assessment, cvText: string): string[] {
  const cv = normalize(cvText);
  return [
    ...assessment.concerns.map((c) => c.quote),
    ...assessment.rewrites.map((r) => r.original),
  ].filter((quote) => !cv.includes(normalize(quote)));
}
