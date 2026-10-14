import { describe, expect, it } from "vitest";
import { detectSceneSupport, type SceneEnvironment } from "./support.js";

type Gpu = "none" | "software" | "hardware";

/** Atrapa okna: zapisuje, o jaki kontekst i jakie media query pytano, oraz ile kontekstow zwolniono. */
function env(gpu: Gpu, reduce: boolean) {
  const asked: string[] = [];
  let released = 0;
  const fake: SceneEnvironment = {
    document: {
      createElement: (tag) => ({
        getContext: (kind, { failIfMajorPerformanceCaveat }) => {
          asked.push(`${tag}:${kind}${failIfMajorPerformanceCaveat ? ":fast" : ""}`);
          const works = gpu === "hardware" || (gpu === "software" && !failIfMajorPerformanceCaveat);
          return works
            ? {
                getExtension: () => ({
                  loseContext: () => {
                    released += 1;
                  },
                }),
              }
            : null;
        },
      }),
    },
    matchMedia: (query) => {
      asked.push(query);
      return { matches: reduce && query === "(prefers-reduced-motion: reduce)" };
    },
  };
  return { fake, asked, released: () => released };
}

describe("detectSceneSupport", () => {
  it("bez WebGL 2 nie ma sceny — zostaje widok 2D", () => {
    const { fake, asked } = env("none", false);
    expect(detectSceneSupport(fake)).toBeNull();
    expect(asked).toEqual(["canvas:webgl2:fast", "canvas:webgl2"]);
  });

  it("z karta graficzna pelna scena, a ruch zalezy od prefers-reduced-motion", () => {
    const moving = env("hardware", false);
    expect(detectSceneSupport(moving.fake)).toEqual({ reducedMotion: false, lowPower: false });
    expect(moving.asked).toEqual(["canvas:webgl2:fast", "(prefers-reduced-motion: reduce)"]);
    expect(moving.released()).toBe(1);
    expect(detectSceneSupport(env("hardware", true).fake)).toEqual({ reducedMotion: true, lowPower: false });
  });

  it("WebGL liczony przez procesor: scena w trybie oszczednym, oba konteksty proby zwolnione", () => {
    const software = env("software", false);
    expect(detectSceneSupport(software.fake)).toEqual({ reducedMotion: false, lowPower: true });
    expect(software.asked).toEqual(["canvas:webgl2:fast", "canvas:webgl2", "(prefers-reduced-motion: reduce)"]);
    expect(software.released()).toBe(1);
  });

  it("kontekst bez rozszerzenia do zwolnienia tez sie liczy", () => {
    const fake: SceneEnvironment = {
      document: { createElement: () => ({ getContext: () => ({ getExtension: () => null }) }) },
      matchMedia: () => ({ matches: false }),
    };
    expect(detectSceneSupport(fake)).toEqual({ reducedMotion: false, lowPower: false });
  });
});
