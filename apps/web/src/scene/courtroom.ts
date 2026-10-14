import type { CharacterId } from "./characters.js";

/**
 * Sala sadowa (assets/blender/build_courtroom.py). Puste wezly w pliku to miejsca postaci
 * i ujecia kamery: scena czyta z nich pozycje i obrot, wiec nazwy to kontrakt z Blenderem.
 */
export const COURTROOM_URL = "models/courtroom.glb";

/** Gdzie siedzi albo stoi kazda postac. Obrot wezla to kierunek patrzenia. */
export const SPOTS: Readonly<Record<CharacterId, string>> = {
  ats: "seat_ats",
  hr: "seat_hr",
  techLead: "seat_techLead",
  hiringManager: "seat_hiringManager",
  prosecutor: "prosecutor_stand",
  judge: "judge_seat",
};

/** Czy postac siedzi (lawa przysieglych, krzeslo sedziego), czy stoi (mownica prokuratora). */
export const isSeated = (id: CharacterId): boolean => id !== "prosecutor";

/** Ujecia kamery: punkt cam_<ujecie> patrzy na cam_<ujecie>_target. */
export const SHOTS = ["wide", "judge", "jury", "prosecutor", "table"] as const;
export type Shot = (typeof SHOTS)[number];

export const shotNodes = (shot: Shot): { readonly eye: string; readonly target: string } => ({ eye: `cam_${shot}`, target: `cam_${shot}_target` });

/** Miejsce, gdzie laduje wniesione CV. */
export const CV_TABLE = "cv_table";

export const ANCHORS: readonly string[] = [...Object.values(SPOTS), CV_TABLE, ...SHOTS.flatMap((s) => Object.values(shotNodes(s)))];

/** Punkty zaczepienia, ktorych brakuje w wczytanej sali. */
export const missingAnchors = (nodeNames: Iterable<string>): readonly string[] => {
  const present = new Set(nodeNames);
  return ANCHORS.filter((name) => !present.has(name));
};
