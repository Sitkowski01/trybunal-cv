import { z } from "zod";
import { AssessmentSchema, boundedText, ScoreSchema } from "./assessment.js";
import { CRITIC_IDS } from "./critics.js";
import type { Verdict } from "./verdict.js";

/**
 * Schemat zdarzen rozprawy. Zdarzenia przychodza z bazy (jsonb) i sa budowane z odpowiedzi
 * modelu — typ TypeScriptu niczego tam nie gwarantuje, wiec kazde zdarzenie z zewnatrz
 * przechodzi przez ten schemat. Typ TrialEvent jest z niego wyprowadzony: jedno zrodlo prawdy.
 */
export const MAX_DEBATE_ROUNDS = 3;
export const MAX_CV_CHARS = 30_000;
export const MAX_JOB_OFFER_CHARS = 10_000;

const CriticIdSchema = z.enum(CRITIC_IDS);

export const VerdictSchema = z.object({
  decision: z.enum(["invite", "reject"]),
  juryAverage: z.number().min(1).max(10),
  atsGateFailed: z.boolean(),
  spread: z.number().int().min(0).max(9),
  disputed: z.boolean(),
  harshest: z.array(CriticIdSchema).readonly(),
  mildest: z.array(CriticIdSchema).readonly(),
  mindChanges: z.array(z.object({ criticId: CriticIdSchema, from: ScoreSchema, to: ScoreSchema })).readonly(),
}) satisfies z.ZodType<Verdict>;

const TrialFiledSchema = z.object({
  type: z.literal("TrialFiled"),
  trialId: boundedText(100),
  cvText: boundedText(MAX_CV_CHARS),
  jobOffer: boundedText(MAX_JOB_OFFER_CHARS),
  debateRounds: z.number().int().min(0).max(MAX_DEBATE_ROUNDS),
});

/** Zdarzenia bez danych kandydata — te same w dzienniku i poza serwerem. */
const PROCEEDINGS = [
  z.object({ type: z.literal("AssessmentSubmitted"), assessment: AssessmentSchema }),
  z.object({ type: z.literal("ProsecutionDelivered"), speech: boundedText(3000) }),
  z.object({
    type: z.literal("StatementMade"),
    round: z.number().int().min(1).max(MAX_DEBATE_ROUNDS),
    criticId: CriticIdSchema,
    statement: boundedText(2000),
    revisedScore: ScoreSchema.nullable(),
  }),
  z.object({
    type: z.literal("VerdictAnnounced"),
    ruleVersion: z.number().int().min(0),
    verdict: VerdictSchema,
    justification: boundedText(3000),
  }),
  z.object({ type: z.literal("TrialAborted"), reason: boundedText(500) }),
] as const;

export const TrialEventSchema = z.discriminatedUnion("type", [TrialFiledSchema, ...PROCEEDINGS]);

export type TrialEvent = z.infer<typeof TrialEventSchema>;

/**
 * Zdarzenie, ktore opuszcza serwer (strumien SSE, przegladarka): wniesienie bez tekstu CV
 * i oferty, tylko ich dlugosci. Kandydat je zna, a strumien laduje w pamieci przegladarki,
 * narzedziach deweloperskich i logach proxy. Jeden schemat dla serwera i frontendu.
 */
export const PublicTrialEventSchema = z.discriminatedUnion("type", [
  TrialFiledSchema.omit({ cvText: true, jobOffer: true }).extend({
    cvChars: z.number().int().min(0),
    jobOfferChars: z.number().int().min(0),
  }),
  ...PROCEEDINGS,
]);

export type PublicTrialEvent = z.infer<typeof PublicTrialEventSchema>;

export function toPublicEvent(event: TrialEvent): PublicTrialEvent {
  if (event.type !== "TrialFiled") return event;
  const { cvText, jobOffer, ...rest } = event;
  return { ...rest, cvChars: cvText.length, jobOfferChars: jobOffer.length };
}
