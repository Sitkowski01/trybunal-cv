import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHARACTER_IDS, type CharacterId, DRAGON_JOINTS, jointsOf } from "./characters.js";
import type { Action } from "./direct.js";
import { approach, deg, GAVEL_PERIOD, GAVEL_STRIKES, gavelSwing, POINT_TURN, type Pose, pose } from "./poses.js";

const ACTIONS: readonly Action[] = ["idle", "reading", "assessed", "thinking", "speaking", "listening", "pointing", "deliberating", "gavel"];
const x = (id: CharacterId, action: Action, joint: string, t = 0, still = true) =>
  (pose(id, action, t, { still }) as Readonly<Record<string, readonly number[] | undefined>>)[joint]?.[0];
const close = (value: number | undefined, degrees: number) => {
  expect(value).toBeCloseTo(deg(degrees), 6);
};

describe("pozy", () => {
  it("wszyscy poza prokuratorem siedza: uda do przodu, lydki w dol", () => {
    for (const id of CHARACTER_IDS.filter((c) => c !== "prosecutor")) {
      close(x(id, "idle", "hip_L"), -90);
      close(x(id, "idle", "knee_R"), 90);
    }
    expect(pose("prosecutor", "idle", 0).hip_L).toBeUndefined();
  });

  it("czytanie: glowa pochylona nad aktami, obie rece przed soba", () => {
    expect(x("hr", "reading", "head")).toBeGreaterThan(deg(15));
    close(x("hr", "reading", "shoulder_L"), -35);
    close(x("hr", "reading", "elbow_R"), -55);
  });

  it("prokurator wskazuje wyprostowana reka lawe przysieglych (w prawo) i otwiera paszcze", () => {
    close(x("prosecutor", "pointing", "shoulder_R"), -85);
    expect(pose("prosecutor", "pointing", 0, { still: true }).shoulder_R?.[2]).toBeCloseTo(deg(-POINT_TURN), 9);
    expect(pose("prosecutor", "pointing", 0, { still: true }).head?.[1]).toBeLessThan(0);
    close(x("prosecutor", "pointing", "jaw"), 14);
    close(x("prosecutor", "listening", "jaw"), 2);
  });

  it("myslenie: dlon pod broda, mowienie: gest prawa reka i glowa w gore", () => {
    close(x("techLead", "thinking", "elbow_R"), -125);
    close(x("ats", "speaking", "shoulder_R"), -50);
    close(x("ats", "speaking", "head"), -6);
    close(x("judge", "deliberating", "shoulder_L"), -50);
  });

  it("skrzydla smoka rozkladaja sie symetrycznie, roboty nie maja stawow smoka", () => {
    for (const t of [0, 0.3, 1.7]) {
      const p = pose("prosecutor", "speaking", t);
      expect(p.wing_L?.[1]).toBeCloseTo(-(p.wing_R?.[1] ?? Number.NaN), 9);
      expect(Math.abs(p.wing_R?.[1] ?? 0)).toBeGreaterThan(deg(13));
    }
    for (const id of CHARACTER_IDS.filter((c) => c !== "prosecutor")) {
      for (const action of ACTIONS) expect(Object.keys(pose(id, action, 1)).some((j) => (DRAGON_JOINTS as readonly string[]).includes(j))).toBe(false);
    }
  });

  it("bez ruchu (reduced motion) poza nie zalezy od czasu, w ruchu zalezy", () => {
    expect(pose("hr", "speaking", 0.4, { still: true })).toEqual(pose("hr", "speaking", 7.9, { still: true }));
    expect(pose("hr", "speaking", 0.4)).not.toEqual(pose("hr", "speaking", 0.9));
  });

  it("postacie nie ruszaja sie w jednym rytmie", () => {
    expect(pose("ats", "speaking", 1).shoulder_R).not.toEqual(pose("hr", "speaking", 1).shoulder_R);
  });

  it("kazdy kat jest skonczony, w zakresie +-180 stopni i dotyczy stawu tej postaci", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CHARACTER_IDS), fc.constantFrom(...ACTIONS), fc.double({ min: 0, max: 600, noNaN: true }), fc.boolean(), (id, action, t, still) => {
        const allowed = new Set<string>(jointsOf(id));
        for (const [joint, angles] of Object.entries(pose(id, action, t, { still }))) {
          expect(allowed.has(joint), joint).toBe(true);
          for (const a of angles) expect(Math.abs(a)).toBeLessThanOrEqual(Math.PI);
        }
      }),
    );
  });
});

describe("mlotek", () => {
  it("zamach do gory, szybkie uderzenie, po trzech uderzeniach reka zostaje na stole", () => {
    expect(gavelSwing(0)).toBe(1);
    expect(gavelSwing(GAVEL_PERIOD * 0.64)).toBeLessThan(0.01);
    expect(gavelSwing(GAVEL_PERIOD * 0.7)).toBeCloseTo(0.5, 6);
    expect(gavelSwing(GAVEL_PERIOD * 0.8)).toBe(1);
    expect(gavelSwing(GAVEL_PERIOD * (GAVEL_STRIKES - 1) + GAVEL_PERIOD * 0.3)).toBeLessThan(1);
    expect(gavelSwing(GAVEL_PERIOD * GAVEL_STRIKES)).toBe(1);
    expect(gavelSwing(GAVEL_PERIOD * GAVEL_STRIKES + 0.5)).toBe(1);
  });

  it("reka sedziego: nad glowa w zamachu, nisko po uderzeniu i w pozie bez ruchu", () => {
    close(x("judge", "gavel", "shoulder_R", GAVEL_PERIOD * 0.64, false), -150 + 70 * gavelSwing(GAVEL_PERIOD * 0.64));
    expect(x("judge", "gavel", "shoulder_R", GAVEL_PERIOD * 0.64, false)).toBeLessThan(deg(-145));
    close(x("judge", "gavel", "shoulder_R", 0.3, true), -80);
    close(x("judge", "gavel", "elbow_R", 0.3, true), -40);
  });

  it("przy uderzeniu przedramie jest 30 stopni nad poziomem i obrocone, zeby obuch szedl w dol", () => {
    const strike = pose("judge", "gavel", GAVEL_PERIOD * GAVEL_STRIKES);
    expect((strike.shoulder_R?.[0] ?? 0) + (strike.elbow_R?.[0] ?? 0)).toBeCloseTo(deg(-120), 9);
    expect(strike.elbow_R?.[1]).toBeCloseTo(Math.PI, 9);
    expect(pose("judge", "deliberating", 1).elbow_R?.[1]).toBe(0);
  });
});

describe("przejscie miedzy pozami", () => {
  it("dt = Infinity to od razu poza docelowa, dt = 0 zostaje w miejscu", () => {
    const from = pose("hr", "reading", 0, { still: true });
    const to = pose("hr", "speaking", 0, { still: true });
    const zeros = (p: object) => Object.fromEntries(Object.keys(p).map((j) => [j, [0, 0, 0]]));
    expect(approach(from, to, Number.POSITIVE_INFINITY)).toEqual({ ...zeros(from), ...to });
    expect(approach(from, to, 0)).toEqual({ ...zeros(to), ...from });
  });

  it("w kazdym kroku zbliza sie do celu, a staw nieobecny w celu wraca do zera", () => {
    const step = approach({ head: [1, 0, 0], tail: [0, 1, 0] }, { head: [0, 0, 0] }, 0.1);
    expect(step.head?.[0]).toBeCloseTo(Math.exp(-1), 9);
    expect(step.tail?.[1]).toBeCloseTo(Math.exp(-1), 9);
    expect(approach({}, { head: [1, 2, 3] }, 0.1, 20).head?.[2]).toBeCloseTo(3 * (1 - Math.exp(-2)), 9);
  });
});

describe("tabela poz", () => {
  // Kazda postac w kazdej akcji w dwoch chwilach ruchu, w stopniach. Zmiana animacji jest widoczna w review
  // jak zmiana kodu (pliki .snap), a pomylony znak albo okres fali od razu zmienia tabele.
  const row = (p: Pose) =>
    Object.entries(p)
      .map(([joint, angles]) => `${joint} ${angles.map((a) => ((a * 180) / Math.PI).toFixed(2)).join(",")}`)
      .join(" | ");

  it.each([0.37, 1.9])("t = %s s", (t) => {
    const table = Object.fromEntries(CHARACTER_IDS.flatMap((id) => ACTIONS.map((action) => [`${id} ${action}`, row(pose(id, action, t))])));
    expect(table).toMatchSnapshot();
  });
});
