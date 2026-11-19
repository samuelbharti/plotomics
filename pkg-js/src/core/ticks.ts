/**
 * Axis ticks on round steps, with labels that state the value they sit on.
 *
 * Steps are 1, 2 or 5 times a power of ten (d3's `tickStep`), and every label
 * carries the decimals its step needs, so a gridline at 2.5 never reads "3".
 */
import { tickStep } from "d3-array";

/**
 * How far from a whole number `x` may be for {@link snapRatio} to snap it:
 * one part in a million of `x`, and never more than a thousandth, so a
 * ratio far from 0, such as 150000123 over a step of 100, is never moved by
 * a sizeable part of a step.
 */
function snapTolerance(x: number): number {
  return Math.min(1e-6 * Math.max(1, Math.abs(x)), 1e-3);
}

/**
 * `x` as the whole number it is within {@link snapTolerance} of, else `x`.
 * A ratio of a value to a step is snapped before it is rounded up or down,
 * so float32 noise, such as 0.3 sent from Python as 0.30000001192092896,
 * neither adds a step nor drops a tick.
 */
export function snapRatio(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) <= snapTolerance(x) ? r : x;
}

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
  const n = Math.max(1, Math.ceil(snapRatio(max / step)));
  const d = stepDecimals(step);
  const ticks = Array.from({ length: n + 1 }, (_, i) =>
    Number((i * step).toFixed(d)),
  );
  return { ticks, top: ticks[n] as number, step };
}

/** The unit a tick label prints in: none, thousands or millions. */
export type TickUnit = "" | "k" | "M";

/**
 * A tick label with the decimals its step needs. `percent` prints a fraction
 * as a percentage. Large values print as thousands ("k") or millions ("M")
 * when the step is a whole number of them, so the label stays exact. A value
 * of a million or more prints in millions whenever the step is a whole
 * number of ten thousands, so "1.5M" never reads "1500k". `unit` sets the
 * unit instead; {@link formatTicks} gives every tick of an axis the same
 * one. A step
 * of 0 marks the one tick of a flat range, which has no step: it prints the
 * value itself, every digit of its whole part and up to six significant
 * digits in all, in exponent form below 1e-6, so a small value never reads
 * as 0 and a large one is never rounded. A value that is not a finite
 * number prints "NA".
 */
export function formatTick(
  value: number,
  step: number,
  opts: { percent?: boolean; unit?: TickUnit } = {},
): string {
  if (!(step > 0)) {
    const v = opts.percent ? value * 100 : value;
    if (!Number.isFinite(v)) return "NA";
    // Digits of the whole part: 7 for 1234567, 1 for 0.25.
    const whole =
      Math.abs(v) < 1e21 ? Math.trunc(Math.abs(v)).toFixed(0).length : 21;
    const digits = Math.min(21, Math.max(6, whole));
    const text = String(Number(v.toPrecision(digits)));
    return opts.percent ? `${text}%` : text;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return "NA";
  if (opts.percent) {
    return `${(value * 100).toFixed(stepDecimals(step * 100))}%`;
  }
  let unit = opts.unit;
  if (unit === undefined) {
    unit =
      (step >= 1e6 || Math.abs(value) >= 1e6) && step % 1e4 === 0
        ? "M"
        : step >= 1e3 && step % 100 === 0
          ? "k"
          : "";
  }
  if (value === 0 || unit === "") return value.toFixed(stepDecimals(step));
  const scale = unit === "M" ? 1e6 : 1e3;
  return `${(value / scale).toFixed(stepDecimals(step / scale))}${unit}`;
}

/**
 * The unit for the labels of ticks on multiples of `step` whose largest
 * size is `maxAbs`: millions when that tick or the step reaches a million
 * and the step is a whole number of thousands, thousands when the step is
 * a whole number of hundreds from a thousand up, and none otherwise. Every
 * label in it stays exact, with at most three decimals.
 */
export function tickUnit(maxAbs: number, step: number): TickUnit {
  if (!(step > 0)) return "";
  if ((step >= 1e6 || maxAbs >= 1e6) && step % 1e3 === 0) return "M";
  if (step >= 1e3 && step % 100 === 0) return "k";
  return "";
}

/**
 * The labels of the ticks of one axis or colour bar, on multiples of
 * `step`, all in the unit the largest needs (see {@link tickUnit}), so an
 * axis reads "0.8M, 1.0M", never "800k, 1.0M". `percent` is as for
 * {@link formatTick}.
 */
export function formatTicks(
  ticks: readonly number[],
  step: number,
  opts: { percent?: boolean } = {},
): string[] {
  let maxAbs = 0;
  for (const v of ticks) {
    if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  const unit = tickUnit(maxAbs, step);
  return ticks.map((v) => formatTick(v, step, { ...opts, unit }));
}

/**
 * Whether `[lo, hi]` is flat: no width, or narrower than 1e-12 of its
 * values. A round step that small sits within a few thousand units of the
 * last digit of the values, and its labels would repeat, so such a range
 * gets one tick, as a range with no width does.
 */
export function isFlatRange(lo: number, hi: number): boolean {
  return Math.abs(hi - lo) <= 1e-12 * Math.max(Math.abs(lo), Math.abs(hi));
}

/** The next finer 1, 2 or 5 step: 5 to 2, 2 to 1 and 1 to 0.5. */
function finerStep(step: number): number {
  // Built from the power of ten, so 0.05 becomes 0.02, not
  // 0.020000000000000004.
  const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const mantissa = Math.round(step / power);
  return mantissa >= 5 ? 2 * power : mantissa >= 2 ? power : power / 2;
}

/**
 * Round ticks inside `[lo, hi]`, a range that need not start at 0, such as
 * the values of a colour bar: the multiples of a 1, 2 or 5 step, for about
 * `count` intervals over the range. When that step leaves fewer than two
 * ticks inside the range, a finer step is taken, so a range with any width
 * gets at least two. A range with no width, or one too narrow for a round
 * step to separate its values (0.3 to 0.1 + 0.2, say), is flat: it gets one
 * tick, at its middle, and a step of 0. Print each tick with
 * `formatTick(value, step)`.
 */
export function domainTicks(
  lo: number,
  hi: number,
  count = 4,
): { ticks: number[]; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { ticks: [], step: 1 };
  }
  if (lo > hi) [lo, hi] = [hi, lo];
  // Halves first, so the middle of the widest range does not overflow.
  const flat = { ticks: [lo / 2 + hi / 2], step: 0 };
  if (isFlatRange(lo, hi)) return flat;
  let step = tickStep(lo, hi, Math.max(1, count));
  // Two finer steps always reach two ticks; the rest is margin.
  for (let k = 0; k < 4; k += 1) {
    if (!(step > 0) || !Number.isFinite(step) || (hi - lo) / step > 1000) {
      break;
    }
    const first = Math.ceil(snapRatio(lo / step));
    const last = Math.floor(snapRatio(hi / step));
    // Past 2 ** 53 an index no longer counts by ones.
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) break;
    if (last > first) {
      const d = stepDecimals(step);
      // A tick may pass an end by no more than the snap allows, so a colour
      // bar never labels a value outside its range.
      const below = lo - snapTolerance(lo / step) * step;
      const above = hi + snapTolerance(hi / step) * step;
      const ticks: number[] = [];
      // At most about 1000 ticks, by the check above.
      for (let j = 0; j <= last - first; j += 1) {
        // toFixed drops the float noise of the product, such as
        // 0.30000000000000004.
        const v = Number(((first + j) * step).toFixed(d));
        if (v < below || v > above) continue;
        if (v !== ticks[ticks.length - 1]) ticks.push(v);
      }
      if (ticks.length > 1) return { ticks, step };
    }
    step = finerStep(step);
  }
  return Number.isFinite(flat.ticks[0] as number)
    ? flat
    : { ticks: [], step: 1 };
}

/**
 * Round ticks inside `[lo, hi]` for an axis or a colour bar `lengthPx` long:
 * the most ticks, for up to `maxCount` intervals over the range, with at
 * least `minGapPx` between neighbours. When even one interval puts them
 * closer, only every k-th tick is kept, so no two labels touch.
 */
export function fitDomainTicks(
  lo: number,
  hi: number,
  lengthPx: number,
  opts: { maxCount?: number; minGapPx?: number } = {},
): { ticks: number[]; step: number } {
  const minGap = opts.minGapPx ?? 16;
  const span = Math.abs(hi - lo);
  const gap = (step: number) =>
    span > 0 ? (step / span) * lengthPx : Number.POSITIVE_INFINITY;
  let t = domainTicks(lo, hi, 1);
  for (let count = opts.maxCount ?? 5; count >= 1; count -= 1) {
    t = domainTicks(lo, hi, count);
    // A flat range has one tick and no step.
    if (!(t.step > 0) || gap(t.step) >= minGap) return t;
  }
  const g = gap(t.step);
  const k = g > 0 ? Math.ceil(minGap / g - 1e-9) : t.ticks.length;
  return { ticks: t.ticks.filter((_, i) => i % k === 0), step: t.step };
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
 * up to `maxCount`, whose labels keep a gap of at least `minGapPx`. When
 * even the coarsest round step puts the labels closer, the axis keeps two
 * labels, 0 and its round top, with that top as the step.
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
  // The coarsest step can still leave two intervals, such as 0, 2 and 4
  // for a top count of 3: three labels where only two fit.
  const { top } = zeroTicks(max, 1, opts);
  return { ticks: [0, top], top, step: top };
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
