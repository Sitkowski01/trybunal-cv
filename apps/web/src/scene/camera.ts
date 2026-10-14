/** Ruch kamery i rzutowanie na ekran — czyste funkcje, scena 3D tylko je wola co klatke. */
export type Vec3 = readonly [number, number, number];

/**
 * Wygladzanie wykladnicze: niezalezne od liczby klatek na sekunde (ten sam ruch przy 30 i 144 FPS).
 * rate = jak szybko dojezdzamy (1/s); dt = Infinity to przeskok (reduced motion).
 */
export const damp = (from: number, to: number, rate: number, dt: number): number => to + (from - to) * Math.exp(-rate * dt);

export const dampVec = (from: Vec3, to: Vec3, rate: number, dt: number): Vec3 => [
  damp(from[0], to[0], rate, dt),
  damp(from[1], to[1], rate, dt),
  damp(from[2], to[2], rate, dt),
];

/** Kamera dojezdza do nowego ujecia w okolo sekunde. */
export const CAMERA_RATE = 2.5;

/** Jak blisko krawedzi moze stanac dymek (czesc szerokosci i wysokosci kadru). */
export const EDGE = { x: 0.12, y: 0.2 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Punkt po rzutowaniu kamery (wspolrzedne -1..1, z w (-1, 1) przed kamera) na piksele elementu.
 * Gdy kamera dopiero jedzie do mowcy, dymek czeka przypiety do krawedzi kadru zamiast znikac;
 * chowamy go tylko, gdy mowca jest za kamera.
 */
export function toScreen(ndc: Vec3, width: number, height: number): { readonly x: number; readonly y: number; readonly visible: boolean } {
  const [x, y, z] = ndc;
  return {
    x: clamp(((x + 1) / 2) * width, EDGE.x * width, (1 - EDGE.x) * width),
    y: clamp(((1 - y) / 2) * height, EDGE.y * height, height),
    visible: z > -1 && z < 1,
  };
}
