/**
 * Lightweight color utilities — no external dependencies so `@bioviz/core`
 * stays tiny and tree-shakeable. Provides perceptually-uniform sequential
 * (viridis) and diverging (RdBu) interpolators plus categorical mapping.
 */

export type RGB = [number, number, number];

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRamp(stops: RGB[], t: number): RGB {
  t = clamp01(t);
  const n = stops.length - 1;
  const scaled = t * n;
  const i = Math.min(Math.floor(scaled), n - 1);
  const f = scaled - i;
  const a = stops[i] as RGB;
  const b = stops[i + 1] as RGB;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) =>
    Math.round(clamp01(v / 255) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Coarse viridis control points (sufficient for smooth interpolation).
const VIRIDIS: RGB[] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

// RdBu diverging control points (low = blue, mid = white, high = red).
const RDBU: RGB[] = [
  [33, 102, 172],
  [103, 169, 207],
  [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199],
  [239, 138, 98],
  [178, 24, 43],
];

/** Sequential viridis color for t in [0,1]. */
export function viridis(t: number): RGB {
  return lerpRamp(VIRIDIS, t);
}

/** Diverging RdBu color for t in [0,1] (0.5 is the neutral midpoint). */
export function rdbu(t: number): RGB {
  return lerpRamp(RDBU, t);
}

export const RAMPS = { viridis, rdbu } as const;
export type RampName = keyof typeof RAMPS;

/** Build a [0,1] -> hex function from a named ramp. */
export function ramp(name: RampName = "viridis"): (t: number) => string {
  const fn = RAMPS[name];
  return (t: number) => rgbToHex(fn(t));
}

/** Stable categorical color lookup: maps arbitrary keys to palette entries. */
export function categoricalScale(palette: string[]): (key: string) => string {
  const cache = new Map<string, string>();
  let next = 0;
  return (key: string) => {
    let c = cache.get(key);
    if (c === undefined) {
      c = palette[next % palette.length] as string;
      cache.set(key, c);
      next += 1;
    }
    return c;
  };
}

/** Map a numeric domain to N evenly-sampled hex swatches from a ramp. */
export function sampleRamp(
  name: RampName,
  n: number,
): string[] {
  const fn = ramp(name);
  if (n <= 1) return [fn(0.5)];
  return Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
}
