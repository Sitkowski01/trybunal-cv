import { CRITIC_IDS, type CriticId, nextSpeaker } from "@trybunal/domain";
import { type Court, phaseOf } from "../trial/court.js";
import { seats } from "../trial/seats.js";
import type { CharacterId } from "./characters.js";
import type { Shot } from "./courtroom.js";

/**
 * Rezyser sceny: ze stanu sali (te same zdarzenia co widok 2D) wylicza, co robi kazda postac,
 * gdzie patrzy kamera i czyj dymek widac. Czysta funkcja — scena 3D tylko to wyswietla.
 */
export type Action =
  | "idle" // czeka na rozprawe
  | "reading" // czyta akta, zanim zlozy ocene
  | "assessed" // ocena zlozona, czeka
  | "thinking" // za chwile mowi (model pisze wypowiedz)
  | "speaking" // jego wypowiedz jest w dymku
  | "listening" // ktos inny mowi
  | "pointing" // prokurator oskarza
  | "deliberating" // sedzia sie naradza
  | "gavel"; // sedzia oglasza wyrok

export interface Bubble {
  readonly who: CharacterId;
  readonly text: string;
  /** Wypowiedz ze zmiana zdania — dymek pokazuje nowa ocene. */
  readonly revisedScore: number | null;
}

/** Ocena nad glowa krytyka: aktualna (po zmianie zdania) i ta, od ktorej zaczynal. */
export interface ScoreTag {
  readonly who: CriticId;
  readonly score: number;
  /** Ocena przed zmiana zdania; null, gdy krytyk jej nie zmienial. */
  readonly from: number | null;
}

export interface Direction {
  readonly shot: Shot;
  readonly actions: Readonly<Record<CharacterId, Action>>;
  readonly bubble: Bubble | null;
  readonly verdict: "invite" | "reject" | null;
  /** Oceny nad glowami — widz widzi spor bez czytania kart pod scena. */
  readonly scores: readonly ScoreTag[];
}

/**
 * Dluzsze wypowiedzi skracamy w dymku — pelny tekst jest w protokole pod scena. Wypowiedz w debacie
 * ma do ok. 350 znakow (prompt), wiec miesci sie cala; dluga mowa oskarzenia — poczatek.
 */
export const BUBBLE_LIMIT = 450;

export const clip = (text: string): string => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= BUBBLE_LIMIT ? flat : `${flat.slice(0, BUBBLE_LIMIT - 1).trimEnd()}…`;
};

/** Sentencja: pierwszy akapit uzasadnienia — sedzia oglasza ja na sali, reszta jest w raporcie. */
export const sentenceOf = (justification: string): string => clip(justification.trim().replace(/\n\s*\n[\s\S]*$/u, ""));

/** Ujecie, w ktorym widac danego mowce. */
export const shotOf = (who: CharacterId): Shot => (who === "judge" ? "judge" : who === "prosecutor" ? "prosecutor" : "jury");

const everyone = (action: Action): Record<CharacterId, Action> => ({
  ...(Object.fromEntries(CRITIC_IDS.map((id) => [id, action])) as Record<CriticId, Action>),
  judge: action,
});

/** Oceny zlozonych krytykow w kolejnosci miejsc; zmiana zdania pokazuje ocene poczatkowa. */
export function scoreTags(court: Court): ScoreTag[] {
  return seats(court).flatMap((seat) =>
    seat.assessment === null || seat.score === null
      ? []
      : [{ who: seat.criticId, score: seat.score, from: seat.score === seat.assessment.score ? null : seat.assessment.score }],
  );
}

export function direct(court: Court): Direction {
  const trial = court.trial;
  const phase = phaseOf(court);
  if (trial === null || phase === null || phase === "aborted") {
    return { shot: "wide", actions: everyone("idle"), bubble: null, verdict: null, scores: [] };
  }
  const actions = everyone("assessed");
  actions.judge = "idle";
  const scores = scoreTags(court);

  switch (phase) {
    case "assessing": {
      for (const id of CRITIC_IDS) if (!trial.assessments.some((a) => a.criticId === id)) actions[id] = "reading";
      return { shot: "wide", actions, bubble: null, verdict: null, scores };
    }
    case "prosecution":
      actions.prosecutor = "thinking";
      return { shot: "prosecutor", actions, bubble: null, verdict: null, scores };
    case "debate":
    case "deliberation": {
      // W dymku ostatnia wypowiedz (na poczatku debaty: mowa oskarzenia); nastepny mowca mysli.
      // Narada zaczyna sie zaraz po ostatnim slowie debaty — bez tego ostatnia wypowiedz nie mialaby czasu na ekranie.
      const last = trial.statements.at(-1);
      const bubble: Bubble | null =
        last === undefined
          ? trial.prosecution === null
            ? null
            : { who: "prosecutor", text: clip(trial.prosecution), revisedScore: null }
          : { who: last.criticId, text: clip(last.statement), revisedScore: last.revisedScore };
      for (const id of CRITIC_IDS) actions[id] = "listening";
      actions.judge = phase === "deliberation" ? "deliberating" : "listening";
      // Bez wypowiedzi w dymku jest mowa oskarzenia — prokurator wskazuje lawe. Nastepny mowca nigdy nie jest
      // tym z dymka: w rundzie mowi pieciu roznych krytykow, a nowa runda zaczyna sie od ATS, nie od prokuratora.
      if (bubble !== null) actions[bubble.who] = last === undefined ? "pointing" : "speaking";
      const next = nextSpeaker(trial);
      if (next !== null) actions[next] = "thinking";
      return { shot: shotOf(bubble?.who ?? next ?? "prosecutor"), actions, bubble, verdict: null, scores };
    }
    case "closed":
      actions.judge = "gavel";
      // Sedzia oglasza sentencje — pierwszy akapit uzasadnienia; cale jest w raporcie pod scena.
      return {
        shot: "judge",
        actions,
        bubble: trial.justification === null ? null : { who: "judge", text: sentenceOf(trial.justification), revisedScore: null },
        verdict: trial.verdict?.decision ?? null,
        scores,
      };
  }
}
