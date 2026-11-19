/**
 * Fitting a vertical legend into the room a plot leaves for it: which
 * entries get a row, and whether a narrow gutter still shows the labels.
 */
import { textWidth } from "./dom.js";

/** The rows of a vertical legend that fit, from {@link fitLegend}. */
export interface LegendFit {
  /** How many entries get a row, from the first. */
  shown: number;
  /** Entries left out, counted on a "+N more" row; 0 for no such row. */
  more: number;
  /** Whether the NA entry gets the last row. */
  missing: boolean;
}

/**
 * Fit a legend of `n` entries, and an NA entry when `missing`, into `rows`
 * rows, listing at most `max` entries. Entries past the room go into a
 * "+N more" row, and the NA entry takes the last row. When even one entry,
 * the "+N more" row and the NA entry do not fit, the NA entry is left out
 * first; a legend that cannot show one entry and the "+N more" row shows
 * nothing.
 */
export function fitLegend(
  n: number,
  missing: boolean,
  rows: number,
  max = Number.POSITIVE_INFINITY,
): LegendFit {
  const none: LegendFit = { shown: 0, more: 0, missing: false };
  if (rows < 1) return none;
  if (n <= max && n + (missing ? 1 : 0) <= rows) {
    return { shown: n, more: 0, missing };
  }
  for (const na of missing ? [true, false] : [false]) {
    const room = rows - (na ? 1 : 0);
    if (n <= max && n <= room) return { shown: n, more: 0, missing: na };
    const cap = Math.min(max, room - 1);
    if (cap >= 1) return { shown: cap, more: n - cap, missing: na };
  }
  return none;
}

/** Characters a cut legend label keeps, at the least, before its ellipsis. */
const MIN_CHARS = 3;

/**
 * Whether `room` px shows every label readably: whole, or cut with an
 * ellipsis after its first three characters at the least. When it does
 * not, a plot leaves its legend out and keeps the width.
 */
export function legendLabelsFit(
  labels: readonly string[],
  room: number,
  size: number,
  fontFamily: string,
): boolean {
  return labels.every((label) => {
    const least =
      label.length <= MIN_CHARS
        ? label
        : `${label.slice(0, MIN_CHARS).trimEnd()}\u2026`;
    return textWidth(least, size, fontFamily) <= room;
  });
}
