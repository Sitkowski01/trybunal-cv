/** Co przegladarka pozwala pokazac: scena 3D wymaga WebGL 2, a ruch szanuje prefers-reduced-motion. */
export interface SceneSupport {
  readonly reducedMotion: boolean;
  /** WebGL bez karty graficznej (liczy procesor): scena bez cieni i w rozdzielczosci 1x. */
  readonly lowPower: boolean;
}

/** Kontekst WebGL — potrzebujemy tylko tego, by go od razu zwolnic (przegladarka ma limit kontekstow). */
interface ProbeContext {
  getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null;
}

/** Fragment okna, ktorego potrzebujemy — testy podaja atrape zamiast prawdziwego WebGL. */
export interface SceneEnvironment {
  readonly document: {
    createElement(tag: "canvas"): { getContext(kind: "webgl2", options: { failIfMajorPerformanceCaveat: boolean }): ProbeContext | null };
  };
  matchMedia(query: string): { readonly matches: boolean };
}

/** Czy da sie utworzyc kontekst; proba nie zostawia otwartego kontekstu. */
const probe = (env: SceneEnvironment, failIfMajorPerformanceCaveat: boolean): boolean => {
  const context = env.document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat });
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return context !== null;
};

/**
 * null: brak WebGL 2 — zostaje widok 2D, ktory i tak pokazuje cala rozprawe. Najpierw pytamy o WebGL
 * "bez powaznego spadku wydajnosci"; odmowa przy dzialajacym zwyklym WebGL oznacza renderowanie programowe.
 */
export function detectSceneSupport(env: SceneEnvironment): SceneSupport | null {
  const fast = probe(env, true);
  if (!fast && !probe(env, false)) return null;
  return { reducedMotion: env.matchMedia("(prefers-reduced-motion: reduce)").matches, lowPower: !fast };
}
