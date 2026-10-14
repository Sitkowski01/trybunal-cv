import { dampVec } from "./camera.js";
import { CHARACTER_IDS, type CharacterId, type Joint } from "./characters.js";
import { isSeated } from "./courtroom.js";
import type { Action } from "./direct.js";

/**
 * Animacje proceduralne: z akcji i czasu wyliczamy obroty stawow (radiany, kolejnosc XYZ jak
 * w three.js). Os X: dodatni obrot pochyla do przodu (glowa w dol, reka w tyl), ujemny unosi
 * reke przed siebie; os Y to skret w lewo i w prawo. Poza spoczynkowa modelu = same zera.
 */
export type Euler3 = readonly [number, number, number];
export type Pose = Partial<Record<Joint, Euler3>>;

export const deg = (d: number): number => (d * Math.PI) / 180;

/** Uderzenia mlotkiem: trzy, potem reka zostaje na stole. */
export const GAVEL_PERIOD = 1.4;
export const GAVEL_STRIKES = 3;

/** O ile stopni w prawo od mownicy siedza przysiegli (patrz prosecution() w build_courtroom.py). */
export const POINT_TURN = 35;

export interface PoseOptions {
  /** prefers-reduced-motion: bez ruchu, kazda akcja ma jedna czytelna poze. */
  readonly still?: boolean;
}

// Kazda postac oddycha i gestykuluje w innym rytmie, zeby lawa nie ruszala sie jak jeden mechanizm.
const offset = (id: CharacterId) => CHARACTER_IDS.indexOf(id) * 1.7;

/** Pozycja mlotka w cyklu: 0 = reka nad glowa, 1 = uderzenie w stol. */
export function gavelSwing(t: number): number {
  if (t >= GAVEL_PERIOD * GAVEL_STRIKES) return 1;
  const p = (t % GAVEL_PERIOD) / GAVEL_PERIOD;
  if (p < 0.65) return 1 - Math.sin((p / 0.65) * (Math.PI / 2)); // powolny zamach
  return Math.min(1, (p - 0.65) / 0.1); // szybkie uderzenie i chwila w dole
}

export function pose(id: CharacterId, action: Action, t: number, { still = false }: PoseOptions = {}): Pose {
  const time = t + offset(id);
  const wave = (period: number, shift = 0) => (still ? 0 : Math.sin(((time + shift) / period) * 2 * Math.PI));
  const p: Partial<Record<Joint, Euler3>> = {};
  const set = (joint: Joint, x: number, y = 0, z = 0) => {
    p[joint] = [deg(x), deg(y), deg(z)];
  };

  if (isSeated(id)) {
    for (const side of ["L", "R"] as const) {
      set(`hip_${side}`, -90);
      set(`knee_${side}`, 90);
    }
  }
  set("spine", 1.5 * wave(4.2));
  set("head", 2 * wave(5), 5 * wave(7.3));

  switch (action) {
    case "idle":
    case "assessed":
      break;
    case "reading":
      set("head", 22 + 3 * wave(1.6), 8 * wave(3.1));
      for (const side of ["L", "R"] as const) {
        set(`shoulder_${side}`, -35);
        set(`elbow_${side}`, -55 + 4 * wave(2.2, side === "L" ? 0 : 0.5));
      }
      break;
    case "thinking":
      set("shoulder_R", -55, 0, 12);
      set("elbow_R", -125);
      set("head", 10, 6, 6 + 4 * wave(3.4));
      break;
    case "speaking":
      set("shoulder_R", -50 + 15 * wave(1.3), 0, 8);
      set("elbow_R", -40 + 12 * wave(0.9));
      set("shoulder_L", -20 + 8 * wave(1.7));
      set("head", -6, 10 * wave(2.5));
      break;
    case "listening":
      set("head", 4 * wave(3), 0, 6);
      break;
    case "pointing":
      // Prokurator wskazuje lawe przysieglych: stoi 35 stopni w prawo od kierunku, w ktory patrzy mownica.
      set("shoulder_R", -85 + 3 * wave(2), 0, -POINT_TURN);
      set("elbow_R", -5);
      set("spine", -8, -POINT_TURN / 3);
      set("head", -6, -POINT_TURN / 2);
      break;
    case "deliberating":
      // Dlonie leza na blacie lawy (sprawdzone na przekroju z boku w Blenderze).
      for (const side of ["L", "R"] as const) {
        set(`shoulder_${side}`, -50);
        set(`elbow_${side}`, -45);
      }
      set("head", 6, 12 * wave(3.2), 5 * wave(4.1));
      break;
    case "gavel": {
      // Mlotek w modelu wystaje z dloni do przodu. Przedramie obrocone o 180 stopni wokol wlasnej osi
      // kieruje go do tylu, wiec przy przedramieniu uniesionym o 30 stopni nad poziom (bark + lokiec = -120)
      // obuch uderza z gory w blat (katy dobrane na przekroju z boku w Blenderze).
      const swing = still ? 1 : gavelSwing(t);
      set("shoulder_R", -150 + 70 * swing);
      set("elbow_R", -50 + 10 * swing, 180);
      set("head", -4);
      break;
    }
  }

  if (id === "prosecutor") {
    // Smok: ogon kolysze sie zawsze, przy mowie klapie paszcza i rozpina skrzydla.
    set("tail", 0, 18 * wave(1.8));
    set("tail2", 0, 24 * wave(1.8, 0.35));
    const loud = action === "speaking" || action === "pointing";
    set("jaw", loud ? 14 + 12 * wave(0.4) : 2);
    const spread = loud ? 22 + 8 * wave(1.1) : 4 * wave(3);
    set("wing_L", 0, -spread);
    set("wing_R", 0, spread);
  }

  return p;
}

/** Przejscie miedzy pozami trwa okolo 0,3 s — zmiana akcji nie przeskakuje z klatki na klatke. */
export const POSE_RATE = 10;

const REST: Euler3 = [0, 0, 0];

/** Krok od biezacej pozy do docelowej (dt = Infinity: od razu docelowa). Brak stawu = poza spoczynkowa. */
export function approach(from: Pose, to: Pose, dt: number, rate = POSE_RATE): Pose {
  const result: Partial<Record<Joint, Euler3>> = {};
  for (const joint of new Set([...Object.keys(from), ...Object.keys(to)] as Joint[])) {
    result[joint] = dampVec(from[joint] ?? REST, to[joint] ?? REST, rate, dt);
  }
  return result;
}
