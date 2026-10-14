/** Co przegladarka pozwala pokazac: scena 3D wymaga WebGL 2, a ruch szanuje prefers-reduced-motion. */
export interface SceneSupport {
  readonly reducedMotion: boolean;
}

/** Fragment okna, ktorego potrzebujemy — testy podaja atrape zamiast prawdziwego WebGL. */
export interface SceneEnvironment {
  readonly document: { createElement(tag: "canvas"): { getContext(kind: "webgl2"): unknown } };
  matchMedia(query: string): { readonly matches: boolean };
}

/** null: brak WebGL 2 — zostaje widok 2D, ktory i tak pokazuje cala rozprawe. */
export function detectSceneSupport(env: SceneEnvironment): SceneSupport | null {
  if (env.document.createElement("canvas").getContext("webgl2") === null) return null;
  return { reducedMotion: env.matchMedia("(prefers-reduced-motion: reduce)").matches };
}
