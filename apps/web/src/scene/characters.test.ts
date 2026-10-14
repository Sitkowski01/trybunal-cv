import { CRITIC_IDS } from "@trybunal/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { type Gltf, readGlb } from "../test/glb.js";
import { CHARACTER_IDS, DRAGON_JOINTS, JOINTS, type Joint, jointsOf, missingJoints, modelUrl } from "./characters.js";

describe("postacie", () => {
  it("piecioro krytykow z domeny i sedzia", () => {
    expect(CHARACTER_IDS).toEqual([...CRITIC_IDS, "judge"]);
  });

  it("smok ma stawy robota i wlasne, roboty tylko wspolne", () => {
    expect(jointsOf("prosecutor")).toEqual([...JOINTS, ...DRAGON_JOINTS]);
    expect(jointsOf("judge")).toEqual(JOINTS);
    expect(jointsOf("ats")).toEqual(JOINTS);
  });

  it("missingJoints wskazuje brakujace stawy w kolejnosci kontraktu", () => {
    expect(missingJoints("hr", JOINTS)).toEqual([]);
    expect(missingJoints("hr", ["hips", "head", "spine_mesh"])).toEqual(JOINTS.filter((j) => j !== "hips" && j !== "head"));
    expect(missingJoints("prosecutor", JOINTS)).toEqual(DRAGON_JOINTS);
  });

  it("modelUrl wskazuje plik w public/models", () => {
    expect(modelUrl("techLead")).toBe("models/techLead.glb");
  });
});

/** Rodzic kazdego stawu: lancuch od bioder w gore i do konczyn. */
const PARENT: Record<Joint, Joint | "root"> = {
  hips: "root",
  spine: "hips",
  neck: "spine",
  head: "neck",
  shoulder_L: "spine",
  shoulder_R: "spine",
  elbow_L: "shoulder_L",
  elbow_R: "shoulder_R",
  hip_L: "hips",
  hip_R: "hips",
  knee_L: "hip_L",
  knee_R: "hip_R",
  jaw: "head",
  tail: "hips",
  tail2: "tail",
  wing_L: "spine",
  wing_R: "spine",
};

describe.each(CHARACTER_IDS)("model %s", (id) => {
  // Plik czytamy w beforeAll, nie przy zbieraniu testow: zly adres ma oblac testy, a nie wyzerowac ich liste.
  let bytes = 0;
  let gltf: Gltf;
  let names: string[];
  const parentOf = new Map<string, string>();
  beforeAll(() => {
    ({ bytes, gltf } = readGlb(modelUrl(id).replace("models/", "")));
    names = gltf.nodes.map((n) => n.name);
    for (const node of gltf.nodes) for (const child of node.children ?? []) parentOf.set(gltf.nodes[child]?.name ?? "", node.name);
  });

  it("jeden korzen nazwany jak postac, z identyfikatorem w extras", () => {
    const roots = gltf.scenes[0]?.nodes.map((i) => gltf.nodes[i]) ?? [];
    expect(roots.map((n) => n?.name)).toEqual([id]);
    expect(roots[0]?.extras).toMatchObject({ character: id });
  });

  it("ma wszystkie stawy, kazdy raz i bez wlasnej siatki", () => {
    expect(missingJoints(id, names)).toEqual([]);
    for (const joint of jointsOf(id)) {
      expect(names.filter((n) => n === joint)).toHaveLength(1);
      expect(gltf.nodes.find((n) => n.name === joint)?.mesh).toBeUndefined();
    }
  });

  it("stawy tworza szkielet: lokiec pod barkiem, kolano pod biodrem, glowa pod szyja", () => {
    for (const joint of jointsOf(id)) {
      const parent = PARENT[joint];
      expect(parentOf.get(joint), joint).toBe(parent === "root" ? id : parent);
    }
  });

  it("miesci sie w budzecie: do 600 KB i do 60 draw calli", () => {
    expect(bytes).toBeLessThan(600 * 1024);
    expect(gltf.meshes.reduce((sum, m) => sum + m.primitives.length, 0)).toBeLessThanOrEqual(60);
  });
});
