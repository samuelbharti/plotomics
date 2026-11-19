/**
 * Lightweight color utilities — no external dependencies so `plotomics/core`
 * stays tiny and tree-shakeable. Provides perceptually-uniform sequential
 * (viridis) and diverging (RdBu) interpolators plus categorical mapping.
 */

import { OKABE_ITO, PALETTE_20 } from "./theme.js";

export type RGB = [number, number, number];

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRamp(stops: RGB[], t: number): RGB {
  // A non-finite t indexes the stop array with NaN, which yields undefined and
  // throws on the very next property read, taking the whole view down mid
  // render. clamp01 cannot catch it, because every comparison against NaN is
  // false. Pin it to the low end instead: a wrong colour is recoverable, a
  // blank panel is not.
  t = Number.isFinite(t) ? clamp01(t) : 0;
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

// LTC sequential ("heatmap0" from loukesio/ltc-color-palettes): an earthy,
// perceptual teal -> sand -> rust ramp.
const LTC: RGB[] = [
  [1, 61, 90],
  [10, 147, 150],
  [148, 210, 189],
  [233, 216, 166],
  [238, 155, 0],
  [202, 103, 2],
  [174, 32, 18],
];

// LTC diverging (teal <-> cream <-> red), matching the app's z-score palette.
const LTCDIV: RGB[] = [
  [14, 113, 117],
  [139, 200, 203],
  [244, 238, 224],
  [244, 165, 130],
  [198, 63, 62],
];

/** Sequential viridis color for t in [0,1]. */
export function viridis(t: number): RGB {
  return lerpRamp(VIRIDIS, t);
}

/** Diverging RdBu color for t in [0,1] (0.5 is the neutral midpoint). */
export function rdbu(t: number): RGB {
  return lerpRamp(RDBU, t);
}

/** LTC sequential ("heatmap0") color for t in [0,1]. */
export function ltc(t: number): RGB {
  return lerpRamp(LTC, t);
}

/** LTC diverging color for t in [0,1] (0.5 is the neutral cream midpoint). */
export function ltcdiv(t: number): RGB {
  return lerpRamp(LTCDIV, t);
}

export const RAMPS = { viridis, rdbu, ltc, ltcdiv } as const;
export type RampName = keyof typeof RAMPS;

/**
 * Build a [0,1] -> hex function from a named ramp. An unknown name stops
 * with a message that names it, where it used to fail later as
 * "fn is not a function".
 */
export function ramp(name: RampName = "viridis"): (t: number) => string {
  const fn = RAMPS[name];
  if (typeof fn !== "function") {
    throw new Error(
      `plotomics: unknown colormap ${JSON.stringify(name)}; use one of ${Object.keys(RAMPS).join(", ")}.`,
    );
  }
  return (t: number) => rgbToHex(fn(t));
}

/** Whether `name` is a diverging ramp, with a neutral colour at its middle. */
export function isDivergingRamp(name: RampName): boolean {
  return name === "rdbu" || name === "ltcdiv";
}

/**
 * The ramp a matrix plot draws with: `name` when one is given, else the
 * diverging "rdbu" for row z-scores, which centre on 0, and "viridis"
 * otherwise.
 */
export function matrixRamp(
  name: RampName | null | undefined,
  zScore: boolean,
): RampName {
  return name ?? (zScore ? "rdbu" : "viridis");
}

/**
 * Colours for `n` categories, in order. The default palette (Okabe-Ito, also
 * used when `palette` is empty) gives way to {@link PALETTE_20} past 8
 * categories, so category 9 does not take the colour of category 1. Any
 * other palette is used as given. Colours repeat past the palette's end.
 */
export function categoricalColors(
  palette: readonly string[] | undefined,
  n: number,
): string[] {
  const base = palette?.length ? palette : OKABE_ITO;
  const isDefault =
    base.length === OKABE_ITO.length &&
    base.every(
      (c, i) =>
        typeof c === "string" &&
        c.toLowerCase() === OKABE_ITO[i]?.toLowerCase(),
    );
  const pal = isDefault && n > OKABE_ITO.length ? PALETTE_20 : base;
  return Array.from(
    { length: Math.max(0, n) },
    (_, i) => pal[i % pal.length] as string,
  );
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
export function sampleRamp(name: RampName, n: number): string[] {
  const fn = ramp(name);
  if (n <= 1) return [fn(0.5)];
  return Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
}
