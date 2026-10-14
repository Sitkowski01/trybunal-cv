/** Fragment glTF potrzebny testom: wezly, siatki i ich prymitywy (jeden prymityw = jeden draw call). */
export interface Gltf {
  readonly scenes: readonly { readonly nodes: readonly number[] }[];
  readonly nodes: readonly {
    readonly name: string;
    readonly children?: readonly number[];
    readonly mesh?: number;
    readonly translation?: readonly [number, number, number];
    readonly extras?: Record<string, unknown>;
  }[];
  readonly meshes: readonly { readonly primitives: readonly unknown[] }[];
}

// Vite wczytuje modele jako data URL (base64) — bez node:fs, wiec test zostaje w typach przegladarki.
const MODELS = import.meta.glob<string>("../../public/models/*.glb", { query: "?inline", import: "default", eager: true });

/** Plik .glb: naglowek 12 bajtow, potem pierwszy kawalek (dlugosc, typ "JSON", tresc). */
export function readGlb(file: string): { readonly bytes: number; readonly gltf: Gltf } {
  const dataUrl = MODELS[`../../public/models/${file}`];
  if (dataUrl === undefined) throw new Error(`${file}: brak modelu w public/models`);
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const text = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to));
  if (text(0, 4) !== "glTF") throw new Error(`${file}: to nie jest plik GLB`);
  if (text(16, 20) !== "JSON") throw new Error(`${file}: brak kawalka JSON`);
  const length = view.getUint32(12, true);
  return { bytes: bytes.length, gltf: JSON.parse(text(20, 20 + length)) as Gltf };
}
