/**
 * Axis ticks on round steps, with labels that state the value they sit on.
 *
 * Steps are 1, 2 or 5 times a power of ten (d3's `tickStep`), and every label
 * carries the decimals its step needs, so a gridline at 2.5 never reads "3".
 */
import { tickStep } from "d3-array";

/** Decimals that print every multiple of `step` exactly. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d < 20; d += 1) {
    const s = step * 10 ** d;
    // A whole number of at least 1, within a tolerance relative to it, so a
    // tiny step such as 2e-10 is not taken for 0.
    if (Math.round(s) >= 1 && Math.abs(s - Math.round(s)) < 1e-9 * s) return d;
  }
  return 20;
}

/**
 * Ticks from 0 up to a round top that covers `max`, aiming for about
 * `count` intervals. `top` is the axis maximum to scale bars against.
 */
export function zeroTicks(
  max: number,
  count = 4,
  opts: { integer?: boolean } = {},
): { ticks: number[]; top: number; step: number } {
  const none = { ticks: [0, 1], top: 1, step: 1 };
  if (!(max > 0) || !Number.isFinite(max)) return none;
  let step = tickStep(0, max, count);
  // Whole counts (set sizes, say) never need a step below 1.
  if (opts.integer) step = Math.max(1, step);
  if (!(step > 0) || !Number.isFinite(max / step) || max / step > 1000) {
    return none;
  }
  const n = Math.max(1, Math.ceil(max / step - 1e-9));
  const d = stepDecimals(step);
  const ticks = Array.from({ length: n + 1 }, (_, i) =>
    Number((i * step).toFixed(d)),
  );
  return { ticks, top: ticks[n] as number, step };
}

/**
 * A tick label with the decimals its step needs. `percent` prints a fraction
 * as a percentage. Large values print as thousands ("k") or millions ("M")
 * when the step is a whole number of them, so the label stays exact.
 */
export function formatTick(
  value: number,
  step: number,
  opts: { percent?: boolean } = {},
): string {
  if (opts.percent) {
    return `${(value * 100).toFixed(stepDecimals(step * 100))}%`;
  }
  if (value !== 0 && step >= 1e6 && step % 1e5 === 0) {
    return `${(value / 1e6).toFixed(stepDecimals(step / 1e6))}M`;
  }
  if (value !== 0 && step >= 1e3 && step % 100 === 0) {
    return `${(value / 1e3).toFixed(stepDecimals(step / 1e3))}k`;
  }
  return value.toFixed(stepDecimals(step));
}

/**
 * Whole-number ticks along a 1-based axis from 1 to `length` (residues,
 * positions): round multiples of a 1, 2 or 5 step, with 1 and `length` at the
 * ends. An end replaces a round tick that sits too close to it, so two labels
 * never print on top of each other.
 */
export function rangeTicks(length: number, count = 6): number[] {
  if (!(length > 1) || !Number.isFinite(length)) return [1];
  const step = Math.max(1, tickStep(1, length, count));
  const round: number[] = [];
  for (let v = Math.ceil(1 / step) * step; v <= length; v += step) {
    if (v > 1 && v < length) round.push(v);
  }
  const gap = step * 0.4;
  const inner = round.filter((v) => v - 1 >= gap && length - v >= gap);
  return [1, ...inner, length];
}

/**
 * Round ticks from 0 that fit an axis `lengthPx` long: the most intervals,
 * up to `maxCount`, whose labels keep a gap of at least `minGapPx`.
 */
export function fitZeroTicks(
  max: number,
  lengthPx: number,
  opts: { integer?: boolean; maxCount?: number; minGapPx?: number } = {},
): { ticks: number[]; top: number; step: number } {
  const minGap = opts.minGapPx ?? 16;
  for (let count = opts.maxCount ?? 5; count >= 1; count -= 1) {
    const t = zeroTicks(max, count, opts);
    if (lengthPx / Math.max(1, t.ticks.length - 1) >= minGap) return t;
  }
  return zeroTicks(max, 1, opts);
}

/**
 * Keep the ticks whose labels do not collide on a horizontal axis. The first
 * and the last are always kept; a tick in between is dropped when its label
 * would come within `gapPx` of the one before it or of the last one.
 */
export function spaceTicks(
  ticks: number[],
  x: (t: number) => number,
  labelWidth: (t: number) => number,
  gapPx = 4,
): number[] {
  if (ticks.length <= 2) return ticks.slice();
  const first = ticks[0] as number;
  const last = ticks[ticks.length - 1] as number;
  const right = (t: number) => x(t) + labelWidth(t) / 2;
  const left = (t: number) => x(t) - labelWidth(t) / 2;
  const kept = [first];
  for (let i = 1; i < ticks.length - 1; i += 1) {
    const t = ticks[i] as number;
    const prev = kept[kept.length - 1] as number;
    if (left(t) - right(prev) >= gapPx && left(last) - right(t) >= gapPx) {
      kept.push(t);
    }
  }
  kept.push(last);
  return kept;
}
