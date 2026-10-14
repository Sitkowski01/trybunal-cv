import { CRITIC_IDS, type CriticId } from "@trybunal/domain";

/**
 * Postacie sali: pieciu krytykow i sedzia. Modele generuje assets/blender/build_characters.py
 * (klocki + puste obiekty w stawach); scena obraca stawy po nazwach, wiec nazwy to kontrakt.
 */
export type CharacterId = CriticId | "judge";

export const CHARACTER_IDS: readonly CharacterId[] = [...CRITIC_IDS, "judge"];

/** Stawy kazdej postaci. Bez kropek: GLTFLoader usuwa je z nazw wezlow. */
export const JOINTS = [
  "hips",
  "spine",
  "neck",
  "head",
  "shoulder_L",
  "shoulder_R",
  "elbow_L",
  "elbow_R",
  "hip_L",
  "hip_R",
  "knee_L",
  "knee_R",
] as const;

/** Dodatkowe stawy smoka-prokuratora: paszcza, ogon i skrzydla. */
export const DRAGON_JOINTS = ["jaw", "tail", "tail2", "wing_L", "wing_R"] as const;

export type Joint = (typeof JOINTS)[number] | (typeof DRAGON_JOINTS)[number];

export const jointsOf = (id: CharacterId): readonly Joint[] => (id === "prosecutor" ? [...JOINTS, ...DRAGON_JOINTS] : JOINTS);

/** Sciezka modelu wzgledem korzenia strony (pliki leza w public/models). */
export const modelUrl = (id: CharacterId): string => `models/${id}.glb`;

/** Stawy, ktorych brakuje w wczytanym modelu — scena odmawia animowania niepelnej postaci. */
export const missingJoints = (id: CharacterId, nodeNames: Iterable<string>): readonly Joint[] => {
  const present = new Set(nodeNames);
  return jointsOf(id).filter((joint) => !present.has(joint));
};
