import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BUBBLE_MARGIN, damp, dampVec, EDGE, keepInside, toScreen } from "./camera.js";

describe("damp", () => {
  it("rusza z miejsca w strone celu, a przy dt = nieskonczonosc przeskakuje", () => {
    expect(damp(0, 10, 2, 0)).toBe(0);
    expect(damp(0, 10, 2, 0.5)).toBeCloseTo(10 * (1 - Math.exp(-1)), 9);
    expect(damp(0, 10, 2, Number.POSITIVE_INFINITY)).toBe(10);
  });

  it("nie zalezy od liczby klatek: dwa kroki po dt/2 = jeden krok po dt", () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), fc.double({ min: -50, max: 50, noNaN: true }), fc.double({ min: 0, max: 2, noNaN: true }), (from, to, dt) => {
        const half = damp(damp(from, to, 3, dt / 2), to, 3, dt / 2);
        expect(half).toBeCloseTo(damp(from, to, 3, dt), 9);
      }),
    );
  });

  it("wektor wygladza kazda os osobno", () => {
    expect(dampVec([0, 10, -4], [10, 10, 4], 2, Number.POSITIVE_INFINITY)).toEqual([10, 10, 4]);
    const [x, y, z] = dampVec([0, 10, -4], [10, 10, 4], 2, 0.5);
    expect([x, y, z].map((v) => Number(v.toFixed(6)))).toEqual([damp(0, 10, 2, 0.5), 10, damp(-4, 4, 2, 0.5)].map((v) => Number(v.toFixed(6))));
  });
});

describe("keepInside", () => {
  const stage = { width: 360, height: 200 };
  const bubble = { width: 200, height: 80 };

  it("dymek mieszczacy sie w sali zostaje nad glowa", () => {
    expect(keepInside({ x: 180, y: 120 }, bubble, stage)).toEqual({ x: 180, y: 120 });
    expect(BUBBLE_MARGIN).toBe(8);
  });

  it("wysoki dymek nad gorna krawedzia schodzi w dol; przy bokach przesuwa sie do srodka", () => {
    expect(keepInside({ x: 180, y: 30 }, bubble, stage)).toEqual({ x: 180, y: 88 });
    expect(keepInside({ x: 20, y: 120 }, bubble, stage)).toEqual({ x: 108, y: 120 });
    expect(keepInside({ x: 340, y: 120 }, bubble, stage)).toEqual({ x: 252, y: 120 });
    expect(keepInside({ x: 180, y: 199 }, bubble, stage)).toEqual({ x: 180, y: 192 });
  });

  it("dymek wiekszy niz sala: widac lewa i gorna krawedz (poczatek tekstu)", () => {
    expect(keepInside({ x: 180, y: 100 }, { width: 400, height: 250 }, stage)).toEqual({ x: 208, y: 258 });
  });
});

describe("toScreen", () => {
  it("srodek kadru i os Y w dol jak w CSS", () => {
    expect(toScreen([0, 0, 0.5], 800, 400)).toEqual({ x: 400, y: 200, visible: true });
    expect(toScreen([0.5, -0.5, 0.5], 800, 400)).toEqual({ x: 600, y: 300, visible: true });
  });

  it("poza kadrem dymek czeka przypiety do krawedzi", () => {
    expect(EDGE).toEqual({ x: 0.12, y: 0.2 });
    expect(toScreen([-3, 3, 0.5], 800, 400)).toEqual({ x: 96, y: 80, visible: true });
    expect(toScreen([3, -3, 0.5], 800, 400)).toEqual({ x: 704, y: 400, visible: true });
    expect(toScreen([-0.75, 0.6, 0.5], 800, 400)).toEqual({ x: 100, y: 80, visible: true });
  });

  it("chowa dymek tylko, gdy mowca jest za kamera", () => {
    expect(toScreen([0, 0, 1], 800, 400).visible).toBe(false);
    expect(toScreen([0, 0, -1], 800, 400).visible).toBe(false);
    expect(toScreen([0, 0, -0.99], 800, 400).visible).toBe(true);
    expect(toScreen([0, 0, 0.99], 800, 400).visible).toBe(true);
  });
});
