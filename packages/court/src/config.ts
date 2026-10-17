import { AssessmentSchema, boundedText, CRITIC_IDS, type CriticId, ScoreSchema } from "@trybunal/domain";
import type { ModelId } from "@trybunal/llm";
import { z } from "zod";

/**
 * Ktory model do czego i ile tokenow. ATS sprawdza slowa kluczowe — wystarczy najtanszy Haiku;
 * krytycy i debata — Sonnet; uzasadnienie sedziego, ktore czyta kandydat — Opus.
 */
export interface CourtConfig {
  readonly models: {
    readonly assessment: Readonly<Record<CriticId, ModelId>>;
    readonly prosecution: ModelId;
    readonly statement: ModelId;
    readonly justification: ModelId;
  };
  readonly maxTokens: {
    /** Osobno dla krytyka, jak model: Haiku mysli dluzej przy tym samym zadaniu. */
    readonly assessment: Readonly<Record<CriticId, number>>;
    readonly prosecution: number;
    readonly statement: number;
    readonly justification: number;
  };
  /** Ile razy pytamy o to samo, zanim rozprawa zostanie przerwana. */
  readonly maxAttempts: number;
  /**
   * Krytycy oceniajacy bez ukrytego rozumowania. Domyslnie nikt — ewaluacja 17.10 (60 rozpraw): Bot ATS
   * bez myslenia nie byl ucinany limitem, ale 10 razy czesciej zmyslal cytaty i 3 rozprawy przerwal brak
   * poprawnej odpowiedzi, przy tym samym koszcie. Zamiast tego wiekszy limit oceny ATS (maxTokens.assessment).
   */
  readonly assessmentWithoutThinking: readonly CriticId[];
}

export const DEFAULT_CONFIG: CourtConfig = {
  models: {
    assessment: {
      ats: "claude-haiku-5-5",
      hr: "claude-sonnet-5-5",
      techLead: "claude-sonnet-5-5",
      hiringManager: "claude-sonnet-5-5",
      prosecutor: "claude-sonnet-5-5",
    },
    prosecution: "claude-sonnet-5-5",
    statement: "claude-sonnet-5-5",
    justification: "claude-opus-5-5",
  },
  maxTokens: {
    // Bot ATS z miejscem na ukryte rozumowanie: Haiku 5.5 mysli przez ok. polowe wyjscia, a przy 3000 byl
    // ucinany w ok. 60% rozpraw (pierwsza proba w kosz). Na Haiku zapas kosztuje grosze; Sonnetom wiekszy
    // limit podnioslby rezerwacje najgorszego kosztu ponad budzet rozprawy przy dlugim CV.
    assessment: { ats: 6000, hr: 3000, techLead: 3000, hiringManager: 3000, prosecutor: 3000 },
    prosecution: 1500,
    statement: 800,
    justification: 2000,
  },
  maxAttempts: 3,
  assessmentWithoutThinking: [],
};

/**
 * Krytyk, ktory pyta pierwszy, zeby pozostali trafili w cache. Cache jest osobny dla kazdego modelu,
 * wiec liderem musi byc krytyk z modelem, ktorego uzywa najwiecej krytykow (przy remisie — pierwszy
 * przy stole). ATS na Haiku jako pierwszy nie dalby nic czterem krytykom na Sonnecie.
 */
export function cacheLeader(models: Readonly<Record<CriticId, ModelId>>): CriticId {
  const users = (id: CriticId) => CRITIC_IDS.filter((other) => models[other] === models[id]).length;
  return CRITIC_IDS.reduce((best, id) => (users(id) > users(best) ? id : best));
}

/** Co model zwraca w kazdej fazie. Id krytyka dopisuje orkiestracja — model go nie wybiera. */
export const AssessmentOutput = AssessmentSchema.omit({ criticId: true });
export const ProsecutionOutput = z.object({ speech: boundedText(3000) });
export const StatementOutput = z.object({ statement: boundedText(2000), revisedScore: ScoreSchema.nullable() });
export const JustificationOutput = z.object({ justification: boundedText(3000) });
