import { describe, expect, it } from "vitest";
import { detectSceneSupport, type SceneEnvironment } from "./support.js";

/** Atrapa okna: zapisuje, o jaki kontekst i jakie media query pytano. */
function env(webgl: boolean, reduce: boolean) {
  const asked: string[] = [];
  const fake: SceneEnvironment = {
    document: {
      createElement: (tag) => ({
        getContext: (kind) => {
          asked.push(`${tag}:${kind}`);
          return webgl ? {} : null;
        },
      }),
    },
    matchMedia: (query) => {
      asked.push(query);
      return { matches: reduce && query === "(prefers-reduced-motion: reduce)" };
    },
  };
  return { fake, asked };
}

describe("detectSceneSupport", () => {
  it("bez WebGL 2 nie ma sceny — zostaje widok 2D", () => {
    const { fake, asked } = env(false, false);
    expect(detectSceneSupport(fake)).toBeNull();
    expect(asked).toEqual(["canvas:webgl2"]);
  });

  it("z WebGL 2 scena jest, a ruch zalezy od prefers-reduced-motion", () => {
    const moving = env(true, false);
    expect(detectSceneSupport(moving.fake)).toEqual({ reducedMotion: false });
    expect(moving.asked).toEqual(["canvas:webgl2", "(prefers-reduced-motion: reduce)"]);
    expect(detectSceneSupport(env(true, true).fake)).toEqual({ reducedMotion: true });
  });
});
