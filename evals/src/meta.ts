import { posix } from "node:path";
import { z } from "zod";
import { LLM_KINDS } from "./args.js";
import type { ReportMeta } from "./report.js";

/** Parametry przebiegu zapisane obok wynikow — wznowienie i raport musza uzyc tych samych. */
export const MetaSchema = z.strictObject({
  llm: z.enum(LLM_KINDS),
  repeats: z.number().int().min(1),
  debateRounds: z.number().int().min(0),
  startedAt: z.string(),
  /** Zbior, z ktorego raport bierze oczekiwane werdykty — poprawka etykiety nie wymaga powtorki rozpraw. */
  dataset: z.string().min(1),
  /** Wszystko, co zaplacono w tym katalogu, rowniez za rozprawy odrzucone przy przerwaniu. */
  spentNanoUsd: z.number().int().min(0),
});
export type Meta = z.infer<typeof MetaSchema>;

/** Naglowek raportu; tytul z nazwy katalogu, takze gdy sciezka ma ukosniki Windows. */
export function reportMeta(meta: Meta, dir: string): ReportMeta {
  return {
    title: `Ewaluacja Trybunału CV — ${posix.basename(dir.replaceAll("\\", "/"))}`,
    date: meta.startedAt.slice(0, 10),
    repeats: meta.repeats,
    debateRounds: meta.debateRounds,
    spentNanoUsd: meta.spentNanoUsd,
    llm: meta.llm === "heuristic" ? "heurystyka słów kluczowych (bez modelu)" : "Claude (modele z konfiguracji sądu)",
  };
}
