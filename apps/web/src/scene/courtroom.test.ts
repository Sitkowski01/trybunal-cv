import { CRITIC_IDS } from "@trybunal/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { type Gltf, readGlb } from "../test/glb.js";
import { CHARACTER_IDS } from "./characters.js";
import { ANCHORS, COURTROOM_URL, CV_TABLE, isSeated, missingAnchors, SHOTS, shotNodes, SPOTS } from "./courtroom.js";

describe("kontrakt sali", () => {
  it("kazda postac ma wlasne miejsce", () => {
    expect(Object.keys(SPOTS).sort()).toEqual([...CHARACTER_IDS].sort());
    expect(new Set(Object.values(SPOTS)).size).toBe(CHARACTER_IDS.length);
  });

  it("stoi tylko prokurator przy mownicy", () => {
    expect(CHARACTER_IDS.filter((id) => !isSeated(id))).toEqual(["prosecutor"]);
  });

  it("ujecie to punkt kamery i jej cel", () => {
    expect(shotNodes("jury")).toEqual({ eye: "cam_jury", target: "cam_jury_target" });
  });

  it("punkty zaczepienia: miejsca, stol z aktami i oba wezly kazdego ujecia", () => {
    expect(ANCHORS).toHaveLength(CHARACTER_IDS.length + 1 + 2 * SHOTS.length);
    expect(ANCHORS).toContain(CV_TABLE);
    expect(missingAnchors(ANCHORS)).toEqual([]);
    expect(missingAnchors(ANCHORS.filter((a) => a !== "seat_hr" && a !== "cam_wide"))).toEqual(["seat_hr", "cam_wide"]);
  });
});

describe("model sali", () => {
  // Jak w characters.test.ts: odczyt w beforeAll, zeby zly adres oblal testy zamiast je ukryc.
  let bytes = 0;
  let gltf: Gltf;
  let byName: Map<string, Gltf["nodes"][number]>;
  let root: Gltf["nodes"][number] | undefined;
  beforeAll(() => {
    ({ bytes, gltf } = readGlb(COURTROOM_URL.replace("models/", "")));
    byName = new Map(gltf.nodes.map((n) => [n.name, n]));
    root = gltf.nodes[gltf.scenes[0]?.nodes[0] ?? -1];
  });

  it("ma wszystkie punkty zaczepienia bezposrednio pod korzeniem i bez siatek", () => {
    expect(root?.name).toBe("courtroom");
    expect(missingAnchors(byName.keys())).toEqual([]);
    const children = new Set((root?.children ?? []).map((i) => gltf.nodes[i]?.name));
    for (const anchor of ANCHORS) {
      expect(children.has(anchor), anchor).toBe(true);
      expect(byName.get(anchor)?.mesh, anchor).toBeUndefined();
    }
  });

  it("przysiegli siedza w kolejnosci krytykow z domeny, od glebi sali", () => {
    // glTF ma os Y w gore, a glebia sali (Blender +Y) to -Z: dalej od kamery = mniejsze z.
    const depth = CRITIC_IDS.filter((id) => id !== "prosecutor").map((id) => byName.get(SPOTS[id])?.translation?.[2] ?? Number.NaN);
    expect(depth).toEqual([...depth].sort((a, b) => a - b));
    expect(new Set(depth).size).toBe(depth.length);
  });

  it("kazda kamera patrzy na cel oddalony co najmniej o metr", () => {
    for (const shot of SHOTS) {
      const { eye, target } = shotNodes(shot);
      const a = byName.get(eye)?.translation ?? [0, 0, 0];
      const b = byName.get(target)?.translation ?? [0, 0, 0];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), shot).toBeGreaterThan(1);
    }
  });

  it("statyczna geometria w jednej siatce: do 1 MB i do 40 draw calli", () => {
    expect(gltf.meshes).toHaveLength(1);
    expect(bytes).toBeLessThan(1024 * 1024);
    expect(gltf.meshes[0]?.primitives.length).toBeLessThanOrEqual(40);
  });
});
