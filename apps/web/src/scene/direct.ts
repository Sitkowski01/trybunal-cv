import { CRITIC_IDS, type CriticId, nextSpeaker } from "@trybunal/domain";
import { type Court, phaseOf } from "../trial/court.js";
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

export interface Direction {
  readonly shot: Shot;
  readonly actions: Readonly<Record<CharacterId, Action>>;
  readonly bubble: Bubble | null;
  readonly verdict: "invite" | "reject" | null;
}

/** Dluzsze wypowiedzi skracamy w dymku — pelny tekst jest w protokole pod scena. */
export const BUBBLE_LIMIT = 160;

export const clip = (text: string): string => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= BUBBLE_LIMIT ? flat : `${flat.slice(0, BUBBLE_LIMIT - 1).trimEnd()}…`;
};

/** Ujecie, w ktorym widac danego mowce. */
export const shotOf = (who: CharacterId): Shot => (who === "judge" ? "judge" : who === "prosecutor" ? "prosecutor" : "jury");

const everyone = (action: Action): Record<CharacterId, Action> => ({
  ...(Object.fromEntries(CRITIC_IDS.map((id) => [id, action])) as Record<CriticId, Action>),
  judge: action,
});

export function direct(court: Court): Direction {
  const trial = court.trial;
  const phase = phaseOf(court);
  if (trial === null || phase === null || phase === "aborted") {
    return { shot: "wide", actions: everyone("idle"), bubble: null, verdict: null };
  }
  const actions = everyone("assessed");
  actions.judge = "idle";

  switch (phase) {
    case "assessing": {
      for (const id of CRITIC_IDS) if (!trial.assessments.some((a) => a.criticId === id)) actions[id] = "reading";
      return { shot: "wide", actions, bubble: null, verdict: null };
    }
    case "prosecution":
      actions.prosecutor = "thinking";
      return { shot: "prosecutor", actions, bubble: null, verdict: null };
    case "debate": {
      // W dymku ostatnia wypowiedz (na poczatku debaty: mowa oskarzenia); nastepny mowca mysli.
      const last = trial.statements.at(-1);
      const bubble: Bubble | null =
        last === undefined
          ? trial.prosecution === null
            ? null
            : { who: "prosecutor", text: clip(trial.prosecution), revisedScore: null }
          : { who: last.criticId, text: clip(last.statement), revisedScore: last.revisedScore };
      for (const id of CRITIC_IDS) actions[id] = "listening";
      actions.judge = "listening";
      // Bez wypowiedzi w dymku jest mowa oskarzenia — prokurator wskazuje lawe. Nastepny mowca nigdy nie jest
      // tym z dymka: w rundzie mowi pieciu roznych krytykow, a nowa runda zaczyna sie od ATS, nie od prokuratora.
      if (bubble !== null) actions[bubble.who] = last === undefined ? "pointing" : "speaking";
      const next = nextSpeaker(trial);
      if (next !== null) actions[next] = "thinking";
      return { shot: shotOf(bubble?.who ?? next ?? "prosecutor"), actions, bubble, verdict: null };
    }
    case "deliberation":
      actions.judge = "deliberating";
      return { shot: "judge", actions, bubble: null, verdict: null };
    case "closed":
      actions.judge = "gavel";
      return { shot: "judge", actions, bubble: null, verdict: trial.verdict?.decision ?? null };
  }
}
