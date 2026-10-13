import { PublicTrialEventSchema } from "@trybunal/domain";
import { z } from "zod";

/**
 * Zdarzenie ze strumienia SSE w kopercie serwera. Dane przychodza z sieci, wiec przechodza przez
 * schemat — zdarzenie domeny ten sam co na serwerze (PublicTrialEventSchema), a z metadanych
 * wywolan modelu bierzemy tylko koszt. Reszta koperty (np. tokeny) nas tu nie obchodzi.
 */
export const EnvelopeSchema = z.object({
  seq: z.number().int().min(1),
  occurredAt: z.string(),
  event: PublicTrialEventSchema,
  calls: z.array(z.object({ costNanoUsd: z.number().int().min(0) })),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export class BadEnvelopeError extends Error {
  override readonly name = "BadEnvelopeError";
}

/** Tekst z pola data zdarzenia SSE -> koperta; blad, gdy serwer przyslal cos innego. */
export function parseEnvelope(data: string): Envelope {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new BadEnvelopeError("Zdarzenie rozprawy nie jest poprawnym JSON-em");
  }
  const result = EnvelopeSchema.safeParse(json);
  if (!result.success) throw new BadEnvelopeError(`Nieznany ksztalt zdarzenia rozprawy: ${result.error.issues.map((i) => i.message).join("; ")}`);
  return result.data;
}
