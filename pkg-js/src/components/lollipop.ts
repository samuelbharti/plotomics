/**
 * Protein domain lollipop — variants along a protein, over its architecture.
 *
 * A backbone spanning the protein with Pfam/InterPro domain rectangles drawn on
 * it, mutation stems rising from it with head area proportional to recurrence,
 * and a post-translational modification track below. This is the figure that
 * answers "where in the protein do the variants land, and does that mean
 * anything" — hotspots inside a functional domain read very differently from
 * truncating variants scattered across it.
 *
 * The genome browser component cannot stand in for this: it works in genomic
 * coordinates, and a lollipop works in amino-acid coordinates over a domain
 * architecture that has no genomic extent.
 *
 * Stems, domains and the gridlines under the stems are canvas-drawn so a
 * protein with thousands of variants stays responsive; labels, the axes and
 * the legend are an SVG overlay. The count axis has round, whole-number
 * ticks (see {@link countTicks}).
 *
 * Variants at one residue stack on one stem (see {@link stackVariants}), so
 * equal counts never hide each other and the top of a stem is the residue's
 * total.
 *
 * Which stems get a text label is taken from `meta.labelIndex` when it is
 * given. Label choice is a judgement call, and letting the renderer make it
 * independently is how two views of one dataset end up labelling different
 * hotspots, so the R and Python wrappers always send it. Without it, the
 * `labelTopN` most recurrent variants are labelled, chosen the way the
 * wrappers choose them (see {@link topLabelIndex}).
 *
 * ## Data contract
 * - `columns.position`  `number[]`  amino-acid position, 1-based (required)
 * - `columns.count`     `number[]`  recurrence per variant (required)
 * - `columns.class`     `string[]`  variant class, indexes `meta.classes`
 * - `columns.label`     `string[]`  per-variant label text, e.g. "R175H"
 * - `meta.length`       `number`    protein length in residues (required)
 * - `meta.gene` / `meta.uniprot`    identifiers for the axis title
 * - `meta.domains`      `{ name, start, end }[]` domain rectangles
 * - `meta.ptms`         `{ position, type }[]`   modification sites
 * - `meta.classes` / `meta.classColors`  legend levels and colours
 * - `meta.domainColors` `string[]`  one colour per domain; without it the
 *   domains take {@link DOMAIN_PALETTE}, never `theme.categorical`
 * - `meta.labelIndex`   `number[]`  indices of variants to label; an empty
 *   array labels none
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  resolveTheme,
  createTooltip,
  createPlotBox,
  type Tooltip,
  measure,
  releaseContainer,
  dpr,
  serializeSVG,
  padSVG,
  compositePNG,
  rangeTicks,
  spaceTicks,
  zeroTicks,
  fitZeroTicks,
  formatTicks,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth as measureText,
  fitText,
  categoricalColors,
} from "../core/index.js";
import { guardDestroy, textDescent } from "../core/dom.js";
import {
  canvasColours,
  hideUnreadableColours,
  setCanvasColour,
} from "../core/paint.js";

export interface LollipopOptions {
  /** Radius of the smallest stem head, in pixels. */
  minHeadRadius: number;
  /** Radius of the most recurrent stem head, in pixels. */
  maxHeadRadius: number;
  /** Draw the post-translational modification track. */
  showPtms: boolean;
  /** Draw the domain rectangles on the backbone. */
  showDomains: boolean;
  /** Draw the variant-class legend. */
  showLegend: boolean;
  /**
   * How many of the most recurrent variants get a label when
   * `meta.labelIndex` is not given. The default, 12, is the default of
   * `label_top_n` in R and Python.
   */
  labelTopN: number;
  /** Colour of the bare backbone between domains. */
  backboneColor: string;
  stemColor: string;
  yLabel: string;
  /**
   * Theme overrides. `categorical` colours the variant classes only; the
   * domains take `meta.domainColors` or {@link DOMAIN_PALETTE}.
   */
  theme: Partial<PlotomicsTheme>;
}

export const defaultLollipopOptions: LollipopOptions = {
  minHeadRadius: 3,
  maxHeadRadius: 11,
  showPtms: true,
  showDomains: true,
  showLegend: true,
  labelTopN: 12,
  backboneColor: "#E6DCC8",
  stemColor: "#93a1b8",
  yLabel: "samples",
  theme: {},
};

export interface LollipopDomain {
  /**
   * The domain's name. A missing name, null (NA in R, None in Python),
   * draws no text.
   */
  name: string | null;
  start: number;
  end: number;
}
export interface LollipopPtm {
  position: number;
  type: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Smallest height of the backbone / domain band. */
const BACKBONE_H = 22;
/** Height of the PTM tick track under the backbone. */
const PTM_H = 14;
/**
 * Height of a variant label box, and the step between label rows, for the
 * label size of the default theme.
 */
const LABEL_H = 12;
/** Label rows a label may climb above its own head to find free space. */
const LABEL_MAX_ROWS = 4;
/**
 * Intervals the count axis aims for at most. A round step can give a few
 * more, as {@link zeroTicks} covers the tallest stem with whole steps.
 */
const COUNT_TICKS = 5;
/** Domain name colours: light on a dark fill, dark on a light one. */
const DOMAIN_TEXT_LIGHT = "#FBF7EF";
const DOMAIN_TEXT_DARK = "#233038";
/**
 * Fills of the domains when `meta.domainColors` is not given, in place of
 * `theme.categorical`, which colours the variant classes: muted tones that
 * no default class colour uses, so a domain never reads as a variant class.
 * Each is light enough for a dark domain name. Neighbours, the eighth and
 * the first included, differ by a CIEDE2000 of 26 or more in normal vision
 * and in deuteranopia and protanopia as Machado et al. (2009) simulate them.
 * The colours repeat past the eighth domain. The R and Python docs of
 * `domain_colors` list them.
 */
export const DOMAIN_PALETTE: readonly string[] = [
  "#9F95C3", // lavender
  "#B2C28C", // pale olive
  "#84B2C0", // powder blue
  "#AD9967", // khaki
  "#B6BAD4", // pale periwinkle
  "#CE9B79", // terracotta
  "#7EA3D4", // cornflower
  "#7DAB88", // sage
];
/** Fewest characters of a cut domain name, before its ellipsis. */
const DOMAIN_MIN_CHARS = 3;
/**
 * Room a line of text takes above and below its baseline, as a share of its
 * size. This covers the font box of the common system fonts.
 */
const ASCENT = 1.08;
const DESCENT = 0.26;
/** Text sizes of the default theme, for a layout computed without a theme. */
const DEFAULT_SIZES = textSizes(defaultTheme);

/** How far below a line a text's baseline goes to centre the text on it. */
function midline(size: number): number {
  return size * 0.35;
}

/**
 * Where the text around the plot goes for the given text sizes: offsets
 * below the residue axis of its labels, its title and the first legend row,
 * and the size of the parts that hold text. Each line starts under the font
 * box of the line above it.
 */
function lollipopText(s: TextSizes) {
  const tick = 6 + s.label;
  const title = tick + Math.ceil(DESCENT * s.label + ASCENT * s.axisTitle) + 1;
  const axisText = Math.ceil(title + DESCENT * s.axisTitle) + 1;
  return {
    /** x of the rotated y title, far enough right for its letters. */
    titleX: Math.ceil(1.1 * s.axisTitle),
    tick,
    title,
    /** Room under the residue axis for its labels and title. */
    axisText,
    /** Baseline of the first legend row. */
    legend: axisText + Math.ceil(ASCENT * s.label),
    /** Height of one legend row. */
    legendRowH: Math.round(s.label + 4),
    /** Height of a variant label box, and the step between label rows. */
    labelH: Math.round(s.label + 1),
    /** Height of the backbone band, which holds the domain names. */
    backboneH: Math.max(
      BACKBONE_H,
      Math.ceil((ASCENT + DESCENT) * s.small) + 6,
    ),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/lollipop.test.ts)
// ---------------------------------------------------------------------------

export interface LollipopLayout {
  left: number;
  right: number;
  /** Top of the stem area. */
  top: number;
  /** Baseline the stems rise from, and the top of the backbone band. */
  baseline: number;
  backboneTop: number;
  backboneBottom: number;
  ptmTop: number;
  axisY: number;
  innerW: number;
  stemH: number;
}

/**
 * Frame the plot from the bottom up: legend rows, then the residue axis with
 * its tick labels and title below `axisY`, then the PTM track, the backbone,
 * and the stem area above it.
 */
export function layoutLollipop(
  width: number,
  height: number,
  opts: Pick<LollipopOptions, "showPtms" | "showLegend">,
  /** Rows of legend entries; the legend wraps, so it can need several. */
  legendRows = 1,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
  /** Width in px of the widest y tick label. */
  tickWidth = 0,
  /** Width in px of the label of the last residue tick. */
  endWidth = 0,
): LollipopLayout {
  const t = lollipopText(sizes);
  // The y tick labels sit between the rotated y title and the stems.
  const left = Math.max(
    52,
    Math.ceil(t.titleX + DESCENT * sizes.axisTitle + 3 + tickWidth + 8),
  );
  // The last residue label is centred on the right end of the axis.
  const right = Math.max(16, Math.ceil(endWidth / 2) + 2);
  // Room above the tallest stem for its head and two label rows, so a label
  // on the most recurrent variant never rides the top edge.
  const top = Math.max(40, 2 * t.labelH + 16);
  const legendH =
    opts.showLegend && legendRows > 0 ? legendRows * t.legendRowH + 4 : 0;
  const ptmH = opts.showPtms ? PTM_H : 0;

  const axisY = height - legendH - t.axisText;
  const ptmTop = axisY - ptmH;
  const backboneBottom = ptmTop - 2;
  const backboneTop = backboneBottom - t.backboneH;
  const baseline = backboneTop;

  return {
    left,
    right,
    top,
    baseline,
    backboneTop,
    backboneBottom,
    ptmTop,
    axisY,
    innerW: Math.max(1, width - left - right),
    stemH: Math.max(1, baseline - top),
  };
}

/**
 * Head radius for a recurrence count. Area scales with count (so a variant seen
 * twice as often looks twice as big, rather than four times), which is the
 * convention every published lollipop uses.
 */
export function headRadius(
  count: number,
  maxCount: number,
  min: number,
  max: number,
): number {
  if (maxCount <= 0) return min;
  const t = Math.sqrt(Math.max(0, count) / maxCount);
  return min + t * (max - min);
}

/**
 * The rows of the `n` most recurrent variants, in row order: the labels R
 * and Python pick with `label_top_n`. Equal counts keep their row order and a
 * missing count comes last, as R's `order(-count)` and numpy's stable
 * `argsort(-count)` have them.
 */
export function topLabelIndex(counts: ArrayLike<number>, n: number): number[] {
  // Infinity labels every variant, as R's label_top_n = Inf does.
  const k = Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
  if (k === 0) return [];
  const rank = (i: number) => {
    const v = counts[i];
    return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
  };
  const rows = Array.from({ length: counts.length }, (_, i) => i);
  rows.sort((a, b) => rank(b) - rank(a) || a - b);
  return rows.slice(0, k).sort((a, b) => a - b);
}

/**
 * Stack the variants that share a residue on one stem. Each variant spans
 * `base` to `top` in count units: the most recurrent sits at the bottom and
 * the others follow by count (ties keep their row order), so the top of a
 * stem is the residue's total. `order` is the drawing order, bottom head
 * first, so a head drawn later is the one on top.
 */
export function stackVariants(
  positions: ArrayLike<number>,
  counts: ArrayLike<number>,
): { base: number[]; top: number[]; order: number[] } {
  const n = Math.min(positions.length, counts.length);
  // A missing (null or NaN) or negative count weighs nothing, so it cannot
  // turn the rest of its stem into NaN.
  const w = (i: number) => countOf(counts[i]);
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort(
    (a, b) =>
      (positions[a] as number) - (positions[b] as number) ||
      w(b) - w(a) ||
      a - b,
  );
  const base = new Array<number>(n).fill(0);
  const top = new Array<number>(n).fill(0);
  let prevPos = Number.NaN;
  let sum = 0;
  for (const i of order) {
    const p = positions[i] as number;
    if (p !== prevPos) {
      prevPos = p;
      sum = 0;
    }
    base[i] = sum;
    sum += w(i);
    top[i] = sum;
  }
  return { base, top, order };
}

/** A count as a number of samples: missing or negative counts are 0. */
function countOf(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** A box in px, used for labels and the heads they must not cover. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * One place a label may go: the text anchor point (x by `anchor`, y the
 * baseline) and, for a label away from its head, where its leader line ends.
 */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
  leader?: { x: number; y: number };
}

/** A label to place: its width and the spots to try, best first. */
export interface LabelCandidate {
  width: number;
  spots: LabelSpot[];
  /**
   * How far the drawn letters reach below the baseline, in px, which
   * `bounds.bottom` is checked against. A sixth of a row, the descent of
   * the label box, when not given.
   */
  descent?: number;
}

/** The box a label of `width` takes at `spot`, in a row `labelH` tall. */
function labelBox(spot: LabelSpot, width: number, labelH: number): Box {
  const x0 =
    spot.anchor === "middle"
      ? spot.x - width / 2
      : spot.anchor === "start"
        ? spot.x
        : spot.x - width;
  // The box runs from the cap height of the label to its descent, which
  // takes a sixth of the row.
  const descent = labelH / 6;
  return {
    x0,
    y0: spot.y - labelH + descent,
    x1: x0 + width,
    y1: spot.y + descent,
  };
}

/**
 * Place variant labels so none overlaps another label, a leader line or any
 * head. Labels are placed in the order given (most important first), each at
 * the first of its spots that is free and inside `bounds`; a centred label is
 * first moved sideways to fit the bounds. `bounds.bottom`, when given, is
 * the lowest the drawn letters of a label may reach, such as the top of the
 * domain band. A label with no free spot is dropped (null). Deterministic,
 * so a redraw and an export agree.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  obstacles: Box[],
  bounds: { left: number; right: number; top: number; bottom?: number },
  /** Height of a label box; see {@link labelBox}. */
  labelH = LABEL_H,
): (LabelSpot | null)[] {
  const placed: Box[] = [];
  const hits = (b: Box, others: Box[]) =>
    others.some(
      (o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0,
    );
  return candidates.map((c) => {
    for (const s of c.spots) {
      const spot =
        s.anchor === "middle"
          ? {
              ...s,
              x: Math.min(
                Math.max(s.x, bounds.left + c.width / 2),
                bounds.right - c.width / 2,
              ),
            }
          : s;
      const box = labelBox(spot, c.width, labelH);
      const inkBottom = spot.y + (c.descent ?? labelH / 6);
      if (
        box.y0 < bounds.top ||
        (bounds.bottom !== undefined && inkBottom > bounds.bottom + 0.5) ||
        box.x0 < bounds.left - 0.5 ||
        box.x1 > bounds.right + 0.5
      ) {
        continue;
      }
      if (hits(box, placed) || hits(box, obstacles)) continue;
      // A leader line must not cross a label already placed.
      let lead: Box | null = null;
      if (spot.leader) {
        lead = {
          x0: Math.min(spot.leader.x, spot.x) - 1,
          y0: Math.min(spot.leader.y, spot.y + 2),
          x1: Math.max(spot.leader.x, spot.x) + 1,
          y1: Math.max(spot.leader.y, spot.y + 2),
        };
        if (hits(lead, placed)) continue;
      }
      placed.push(box);
      if (lead) placed.push(lead);
      return spot;
    }
    return null;
  });
}

/**
 * Lay legend entries out in rows no wider than `maxWidth`. `widths` holds each
 * entry's full width, marker and text; `gap` separates entries in a row.
 */
export function wrapRows(
  widths: number[],
  maxWidth: number,
  gap = 14,
): { x: number; row: number }[] {
  const out: { x: number; row: number }[] = [];
  let row = 0;
  let x = 0;
  for (const w of widths) {
    if (x > 0 && x + w > maxWidth) {
      row += 1;
      x = 0;
    }
    out.push({ x, row });
    x += w + gap;
  }
  return out;
}

/**
 * Residue ticks for the axis: round positions (multiples of 1, 2 or 5 x 10^k)
 * with 1 and the protein length at the ends. A round tick too close to an end
 * is left out, so the last two labels never overlap.
 */
export function residueTicks(length: number, count = 6): number[] {
  return rangeTicks(length, count);
}

/**
 * Ticks for the count axis of stems up to `max` on an axis `lengthPx` tall:
 * round values from 0, as many as keep `minGapPx` between neighbouring
 * labels, and 0 and the top alone when they keep `endGapPx` (see
 * {@link fitZeroTicks}). With `integer`, for counts that are all whole numbers, the steps
 * are whole numbers too, since a count of samples has no fractions; without
 * it, counts below 1, such as frequencies, get decimal steps. The stems are
 * scaled against `top`, the round value at the top of the axis.
 */
export function countTicks(
  max: number,
  lengthPx: number,
  minGapPx: number,
  integer = true,
  endGapPx = minGapPx,
): { ticks: number[]; top: number; step: number } {
  return fitZeroTicks(max, lengthPx, {
    integer,
    maxCount: COUNT_TICKS,
    minGapPx,
    endGapPx,
  });
}

/**
 * Colour of a domain name on a domain filled with `fill`: dark text on a
 * light fill, such as yellow or sky blue, and light text on a dark one.
 * `fill` is a hex colour; the plot first reads a named, translucent or
 * var() colour as the canvas draws it. Any other value keeps the light
 * text.
 */
export function domainTextColor(fill: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim())?.[1];
  if (!hex) return DOMAIN_TEXT_LIGHT;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  // Rec. 601 luma, the rule the profile banner uses for its group names.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
    ? DOMAIN_TEXT_DARK
    : DOMAIN_TEXT_LIGHT;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createLollipop: PlotomicsFactory<LollipopOptions> = (
  el,
  initial,
) => {
  let opts: LollipopOptions = mergeOptions(
    defaultLollipopOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutLollipop(0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  // The size of the element, and the plot box inside its padding: `width`
  // and `height` are the box, which every layer and coordinate is in.
  const plot = createPlotBox(el);
  let outerW = 0;
  let outerH = 0;
  /** Fit the plot box to an element `w` x `h` px and take its size. */
  function fitBox(w = outerW, h = outerH) {
    outerW = w;
    outerH = h;
    ({ width, height } = plot.fit(w, h, theme));
  }
  plot.box.append(canvas, svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const plen = () => Math.max(1, (data.meta?.length as number) ?? 1);
  const positions = () => (data.columns.position as ArrayLike<number>) ?? [];
  const counts = () => (data.columns.count as ArrayLike<number>) ?? [];
  const vclasses = () => (data.columns.class as string[]) ?? [];
  const labels = () => (data.columns.label as string[]) ?? [];
  const classes = () => (data.meta?.classes as string[]) ?? [];
  const domains = () => (data.meta?.domains as LollipopDomain[]) ?? [];
  const ptms = () => (data.meta?.ptms as LollipopPtm[]) ?? [];
  const labelIndex = (): number[] => {
    const given = data.meta?.labelIndex;
    if (Array.isArray(given)) return given as number[];
    return topLabelIndex(counts(), opts.labelTopN);
  };
  function classColors(): string[] {
    const given = data.meta?.classColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, classes().length);
  }
  /** Domain fills, used in turn: the given ones or the domain palette. */
  function domainColors(): readonly string[] {
    const given = data.meta?.domainColors as string[] | undefined;
    if (given && given.length) return given;
    return DOMAIN_PALETTE;
  }
  // Variants at one residue share a stem; see stackVariants. The largest
  // single count (the head size scale) and the tallest stem (the y scale)
  // are kept with the stack, so each draw reads them once.
  let stack = stackVariants([], []);
  let countMax = 1;
  let stackMax = 1;
  // Whether every count is a whole number, which gives the count axis
  // whole-number steps.
  let wholeCounts = true;
  // The count axis, fitted to the stem area on each render. The stems are
  // scaled against its round top.
  let yAxis = zeroTicks(1, 1, { integer: true });
  function restack() {
    stack = stackVariants(positions(), counts());
    const c = counts();
    countMax = 0;
    wholeCounts = true;
    for (let i = 0; i < c.length; i += 1) {
      countMax = Math.max(countMax, countOf(c[i]));
      const v = c[i] as number;
      if (Number.isFinite(v) && !Number.isInteger(v)) wholeCounts = false;
    }
    stackMax = 0;
    for (const t of stack.top) stackMax = Math.max(stackMax, t);
    if (!(countMax > 0)) countMax = 1;
    if (!(stackMax > 0)) stackMax = 1;
  }
  /** The largest single-variant count, which sets the head size scale. */
  function maxCount(): number {
    return countMax;
  }
  /** The tallest stem, which the count axis covers. */
  function maxStack(): number {
    return stackMax;
  }
  /** A variant whose count is missing (null from R, NaN from Python). */
  function missing(i: number): boolean {
    return !Number.isFinite(counts()[i] as number);
  }
  /** Total count of the variants at one residue. */
  function residueTotal(residue: number): number {
    const pos = positions();
    let m = 0;
    for (let i = 0; i < stack.top.length; i += 1) {
      if (pos[i] === residue && (stack.top[i] as number) > m) {
        m = stack.top[i] as number;
      }
    }
    return m;
  }
  function radius(i: number, mc: number): number {
    return headRadius(
      countOf(counts()[i]),
      mc,
      opts.minHeadRadius,
      opts.maxHeadRadius,
    );
  }

  function textWidth(s: string, size: number): number {
    return measureText(s, size, theme.fontFamily);
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(s: string, maxW: number, size: number): string {
    return fitText(s, maxW, size, theme.fontFamily);
  }
  /**
   * A domain name that fits `maxW` px: the whole name, or its first
   * characters and an ellipsis. A trailing number, such as the 2 of
   * "Transactivation domain 2", is kept after the ellipsis, so numbered
   * domains can still be told from each other. Empty when fewer than three
   * characters of the name would show.
   */
  function domainLabel(name: string, maxW: number): string {
    const size = sizes.small;
    const whole = fit(name, maxW, size);
    if (whole === name) return name;
    const numbered = /^(.*\S)\s+(\d+)$/.exec(name);
    if (numbered) {
      const tail = ` ${numbered[2]}`;
      const head = fit(
        numbered[1] as string,
        maxW - textWidth(tail, size),
        size,
      );
      // A cut head is its first characters and one ellipsis.
      if (head.length - 1 >= DOMAIN_MIN_CHARS) return head + tail;
    }
    return whole.length - 1 >= DOMAIN_MIN_CHARS ? whole : "";
  }
  // One pixel to read the colour a domain name is written on.
  const probe = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (probe) {
    probe.canvas.width = 1;
    probe.canvas.height = 1;
  }
  /**
   * The colour a domain name is written on, as a hex colour: the domain's
   * fill over the backbone over the background, as the canvas draws them.
   * So a named or var() fill counts as the colour it shows, a translucent
   * one as its blend with the backbone, and one that paints nothing as the
   * backbone.
   */
  function shownFill(fill: string): string {
    if (!probe) return fill;
    probe.clearRect(0, 0, 1, 1);
    for (const colour of [theme.background, opts.backboneColor, fill]) {
      if (setCanvasColour(probe, "fillStyle", colour, el)) {
        probe.fillRect(0, 0, 1, 1);
      }
    }
    const d = probe.getImageData(0, 0, 1, 1).data;
    return `#${[d[0], d[1], d[2]]
      .map((v) => (v ?? 0).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  /**
   * The layout for the current size, data and text sizes, with `legendRows`
   * rows of legend. Call {@link restack} first.
   */
  function frame(legendRows: number): LollipopLayout {
    // The widest label of any count axis the stems could get, so the left
    // gutter, and with it the legend rows, do not depend on the stem height.
    let tickWidth = 0;
    for (let n = 1; n <= COUNT_TICKS; n += 1) {
      const t = zeroTicks(maxStack(), n, { integer: wholeCounts });
      for (const label of formatTicks(t.ticks, t.step)) {
        tickWidth = Math.max(tickWidth, textWidth(label, sizes.label));
      }
    }
    return layoutLollipop(
      width,
      height,
      opts,
      legendRows,
      sizes,
      tickWidth,
      textWidth(String(plen()), sizes.label),
    );
  }
  /**
   * Each shown legend entry's x and row, and a "+N more" note when the
   * entries need more rows than the legend may take: a fifth of the height,
   * less any row that would leave the stems too short for the count labels
   * 0 and the top.
   */
  function legendLayout(): {
    items: { x: number; row: number }[];
    note: { x: number; row: number; text: string } | null;
    /** The class names, each cut to fit a row. */
    names: string[];
  } {
    const f = frame(0);
    const maxW = Math.max(1, width - f.left - f.right);
    const names = classes().map((c) => fit(c, maxW - 12, sizes.label));
    const widths = names.map((c) => 12 + textWidth(c, sizes.label));
    const rowH = lollipopText(sizes).legendRowH;
    // A fifth of the height, and no row that would leave the stems less
    // room than the count labels 0 and the top need: the label size and
    // 2 px, as the count axis asks of them.
    let maxRows = Math.max(1, Math.floor((height * 0.2) / rowH));
    const stemRoom = sizes.label + 2;
    while (maxRows > 1 && frame(maxRows).stemH < stemRoom) maxRows -= 1;
    const all = wrapRows(widths, maxW);
    const items = all.filter((it) => it.row < maxRows);
    if (items.length === all.length) return { items, note: null, names };
    const last = maxRows - 1;
    for (;;) {
      const text = `+${all.length - items.length} more`;
      const tail = items[items.length - 1];
      const i = items.length - 1;
      const x = tail && tail.row === last ? tail.x + (widths[i] ?? 0) + 14 : 0;
      if (
        x + textWidth(text, sizes.label) <= maxW ||
        !tail ||
        tail.row !== last
      ) {
        return { items, note: { x, row: last, text }, names };
      }
      items.pop();
    }
  }
  function legendRows(): number {
    const { items, note } = legendLayout();
    if (note) return note.row + 1;
    return items.length ? (items[items.length - 1]?.row ?? 0) + 1 : 0;
  }

  const px = (residue: number) =>
    layout.left + ((residue - 1) / Math.max(1, plen() - 1)) * layout.innerW;
  const py = (count: number) =>
    layout.baseline - (count / yAxis.top) * layout.stemH;

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);

    // The head drawn on top wins: of the heads under the cursor, the last in
    // drawing order. Near a head but on none, the nearest within 2 px.
    const pos = positions();
    const cnt = counts();
    const mc = maxCount();
    let best = -1;
    let near = -1;
    let nearD = Infinity;
    for (const i of stack.order) {
      if (missing(i)) continue;
      const x = px(pos[i] as number);
      const y = py(stack.top[i] as number);
      const d = Math.hypot(mx - x, my - y);
      const r = radius(i, mc);
      if (d <= r) best = i;
      else if (d <= r + 2 && d < nearD) {
        nearD = d;
        near = i;
      }
    }
    if (best < 0) best = near;
    if (best >= 0) {
      const p = pos[best] as number;
      const lab = labels()[best] ?? `p.${p}`;
      const cls = vclasses()[best] ?? "";
      const n = cnt[best] as number;
      const total = residueTotal(p);
      // The unit is the y axis label, "samples" unless the caller set one,
      // such as "frequency".
      const unit = (opts.yLabel ?? "").trim() || "samples";
      const amount = (v: number) =>
        unit === "samples"
          ? `${fmtCount(v)} sample${v === 1 ? "" : "s"}`
          : `${esc(unit)}: ${fmtCount(v)}`;
      const more =
        total > n
          ? unit === "samples"
            ? `<br/>residue ${p}: ${amount(total)} in total`
            : `<br/>residue ${p} in total, ${amount(total)}`
          : "";
      tooltip.show(
        `<b>${esc(lab)}</b><br/>${esc(cls)}<br/>${amount(n)}${more}`,
        lastPointer.x,
        lastPointer.y,
      );
      return;
    }

    // Otherwise, a domain under the cursor, when domains are drawn.
    if (
      opts.showDomains &&
      my >= layout.backboneTop &&
      my <= layout.backboneBottom
    ) {
      for (const d of domains()) {
        if (mx >= px(d.start) && mx <= px(d.end)) {
          tooltip.show(
            `<b>${esc(d.name ?? "NA")}</b><br/>${d.start}-${d.end}`,
            lastPointer.x,
            lastPointer.y,
          );
          return;
        }
      }
    }
    tooltip.hide();
  }
  function onLeave() {
    tooltip.hide();
  }
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);

  // ---- rendering ----
  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function render() {
    const ctx = canvas.getContext("2d");
    if (!ctx || !width || !height) return;
    restack();
    layout = frame(legendRows());
    // As many round counts as the stem area holds without crowding.
    yAxis = countTicks(
      maxStack(),
      layout.stemH,
      sizes.label + 5,
      wholeCounts,
      sizes.label + 2,
    );
    ctx.clearRect(0, 0, width, height);
    if (setCanvasColour(ctx, "fillStyle", theme.background, el)) {
      ctx.fillRect(0, 0, width, height);
    }

    const L = plen();
    if (L <= 1) {
      renderOverlay();
      return;
    }

    // Gridlines first, so the stems and heads are drawn over them. The
    // baseline needs none: the backbone marks it. A grid colour that paints
    // nothing, such as "none", draws no line.
    if (setCanvasColour(ctx, "strokeStyle", theme.grid, el)) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of yAxis.ticks) {
        if (v <= 0) continue;
        // On a half pixel, so the 1 px line fills one row of pixels.
        const y = Math.round(py(v)) + 0.5;
        ctx.moveTo(layout.left, y);
        ctx.lineTo(width - layout.right, y);
      }
      ctx.stroke();
    }

    // Each colour as the canvas reads it, var() and currentColor included;
    // null for one that paints nothing, whose marks are left out.
    const read = canvasColours(el);

    // Backbone.
    const bandH = layout.backboneBottom - layout.backboneTop;
    const midY = layout.backboneTop + bandH / 2;
    const backbone = read(opts.backboneColor);
    if (backbone) {
      ctx.fillStyle = backbone;
      ctx.fillRect(layout.left, midY - 4, layout.innerW, 8);
    }

    // Domain rectangles.
    if (opts.showDomains) {
      const dcols = domainColors();
      domains().forEach((d, i) => {
        // A fill that paints nothing leaves the backbone showing.
        if (!setCanvasColour(ctx, "fillStyle", dcols[i % dcols.length], el)) {
          return;
        }
        const x0 = px(d.start);
        const x1 = px(d.end);
        ctx.fillRect(x0, layout.backboneTop, Math.max(1, x1 - x0), bandH);
      });
    }

    // PTM ticks.
    const ptm = read(theme.muted);
    if (opts.showPtms && ptm) {
      ctx.strokeStyle = ptm;
      ctx.lineWidth = 1;
      ctx.fillStyle = ptm;
      for (const p of ptms()) {
        const x = px(p.position);
        ctx.beginPath();
        ctx.moveTo(x, layout.ptmTop);
        ctx.lineTo(x, layout.ptmTop + PTM_H - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, layout.ptmTop + PTM_H - 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Stems, then heads, so heads always sit above neighbouring stems.
    const pos = positions();
    const cls = vclasses();
    const clsList = classes();
    const ccols = classColors();
    const mc = maxCount();

    const stem = read(opts.stemColor);
    if (stem) {
      ctx.strokeStyle = stem;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const i of stack.order) {
        if (missing(i)) continue;
        const x = px(pos[i] as number);
        ctx.moveTo(x, py(stack.base[i] as number));
        ctx.lineTo(x, py(stack.top[i] as number));
      }
      ctx.stroke();
    }

    // Bottom head first, so a stacked head is drawn over the one below.
    for (const i of stack.order) {
      if (missing(i)) continue;
      const x = px(pos[i] as number);
      const y = py(stack.top[i] as number);
      const r = radius(i, mc);
      const ci = clsList.indexOf(cls[i] ?? "");
      const head = read(ci >= 0 ? (ccols[ci] as string) : theme.foreground);
      if (!head) continue;
      ctx.fillStyle = head;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    renderOverlay();
  }

  /**
   * Draw the overlay, then give every colour in it that the page cannot
   * read the value "none", as the canvas leaves such marks out (see
   * hideUnreadableColours), so the screen and the exports agree.
   */
  function renderOverlay(...args: Parameters<typeof drawOverlay>) {
    drawOverlay(...args);
    hideUnreadableColours(el, svg);
  }

  function drawOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const L = plen();
    const tx = lollipopText(sizes);
    const mid = midline(sizes.label);

    // y axis: a label at each round count, where its gridline runs, all
    // in the unit the largest needs.
    const yLabels = formatTicks(yAxis.ticks, yAxis.step);
    yAxis.ticks.forEach((v, i) => {
      svg.appendChild(
        text(
          layout.left - 8,
          py(v) + mid,
          yLabels[i] ?? "",
          theme.muted,
          "end",
          sizes.label,
        ),
      );
    });
    // The y title is centred on the stems and may reach down to the axis.
    const yTitleCy = layout.top + layout.stemH / 2;
    svg.appendChild(
      rotatedText(
        tx.titleX,
        yTitleCy,
        fit(
          opts.yLabel,
          2 * Math.min(yTitleCy - 2, layout.axisY - yTitleCy),
          sizes.axisTitle,
        ),
        theme.muted,
        sizes.axisTitle,
      ),
    );

    // Domain names, centred and kept inside their rectangles, so a name
    // never runs into its neighbours. A name too long for its rectangle is
    // cut with an ellipsis, and left out when fewer than three of its
    // characters would show; the tooltip on the domain gives it in full.
    // Each name is dark or light, whichever reads on its domain's fill.
    if (opts.showDomains) {
      const bandH = layout.backboneBottom - layout.backboneTop;
      const midY = layout.backboneTop + bandH / 2 + midline(sizes.small);
      const dcols = domainColors();
      // The text colour of each fill, read once per draw.
      const inks = new Map<string, string>();
      domains().forEach((d, i) => {
        const x0 = px(d.start);
        const x1 = px(d.end);
        const label = domainLabel(shortDomain(d.name), x1 - x0 - 6);
        if (!label) return;
        const fill = dcols[i % dcols.length] ?? "";
        let ink = inks.get(fill);
        if (ink === undefined) {
          ink = domainTextColor(shownFill(fill));
          inks.set(fill, ink);
        }
        svg.appendChild(
          text((x0 + x1) / 2, midY, label, ink, "middle", sizes.small),
        );
      });
    }

    // Variant labels for the stems the caller selected, most recurrent
    // first. The head on top of a stem is labelled just above itself, then
    // beside itself, then up to three rows higher with a leader line. A head
    // lower in a stack is labelled only beside itself, since a label above
    // it would sit over another variant's head. A label with no free spot is
    // dropped.
    const pos = positions();
    const cnt = counts();
    const labs = labels();
    const idx = labelIndex().filter(
      (i) => i >= 0 && i < pos.length && (labs[i] ?? "") !== "" && !missing(i),
    );
    if (idx.length) {
      const mc = maxCount();
      idx.sort(
        (a, b) =>
          countOf(cnt[b]) - countOf(cnt[a]) ||
          (pos[a] as number) - (pos[b] as number),
      );
      const heads: Box[] = [];
      const stemTop = new Map<number, number>();
      for (let i = 0; i < pos.length; i += 1) {
        if (missing(i)) continue;
        const x = px(pos[i] as number);
        const y = py(stack.top[i] as number);
        const r = radius(i, mc);
        heads.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
        const p = pos[i] as number;
        stemTop.set(p, Math.max(stemTop.get(p) ?? 0, stack.top[i] as number));
      }
      const candidates: LabelCandidate[] = idx.map((i) => {
        const hx = px(pos[i] as number);
        const hy = py(stack.top[i] as number);
        const r = radius(i, mc);
        const headTop = hy - r;
        const beside: LabelSpot[] = [
          { x: hx + r + 3, y: hy + mid, anchor: "start" },
          { x: hx - r - 3, y: hy + mid, anchor: "end" },
        ];
        const onTop =
          (stack.top[i] as number) >= (stemTop.get(pos[i] as number) ?? 0);
        const above: LabelSpot[] = [];
        for (let row = 0; row < LABEL_MAX_ROWS; row += 1) {
          above.push({
            x: hx,
            y: headTop - 4 - row * tx.labelH,
            anchor: "middle",
            leader: row > 0 ? { x: hx, y: headTop - 1 } : undefined,
          });
        }
        return {
          width: textWidth(labs[i] ?? "", sizes.label) + 4,
          // The letters, not the font box, keep clear of the domain band:
          // "P152fs" has no descender and sits on the band's top.
          descent:
            textDescent(labs[i] ?? "", sizes.label, theme.fontFamily) ??
            undefined,
          spots: onTop
            ? [above[0] as LabelSpot, ...beside, ...above.slice(1)]
            : beside,
        };
      });
      // A label box starts five sixths of a row above its baseline, and
      // the font box of the text reaches a little higher. No drawn letter
      // reaches down into the band of the backbone and the domains: beside
      // a head near the baseline of a short plot, a label ran over a domain
      // block.
      const spots = placeLabels(
        candidates,
        heads,
        {
          left: layout.left,
          right: width - layout.right,
          top: Math.max(
            2,
            Math.ceil(ASCENT * sizes.label - (tx.labelH * 5) / 6),
          ),
          bottom: layout.backboneTop,
        },
        tx.labelH,
      );
      idx.forEach((i, k) => {
        const spot = spots[k];
        if (!spot) return;
        if (spot.leader) {
          svg.appendChild(
            line(spot.leader.x, spot.leader.y, spot.x, spot.y + 2, theme.muted),
          );
        }
        svg.appendChild(
          text(
            spot.x,
            spot.y,
            labs[i] ?? "",
            theme.foreground,
            spot.anchor,
            sizes.label,
          ),
        );
      });
    }

    // Residue axis: about one tick per 80 px, and a tick whose label would
    // touch its neighbour's is left out, so narrow plots stay readable.
    const count = Math.max(2, Math.min(8, Math.floor(layout.innerW / 80)));
    const residues = spaceTicks(residueTicks(L, count), px, (t) =>
      textWidth(String(t), sizes.label),
    );
    for (const t of residues) {
      const x = px(t);
      svg.appendChild(line(x, layout.axisY, x, layout.axisY + 4, theme.axis));
      svg.appendChild(
        text(
          x,
          layout.axisY + tx.tick,
          String(t),
          theme.muted,
          "middle",
          sizes.label,
        ),
      );
    }
    const gene = (data.meta?.gene as string) ?? "";
    const acc = (data.meta?.uniprot as string) ?? "";
    // Either identifier alone still names the protein.
    const id = gene && acc ? `${gene} (${acc})` : gene || acc;
    const title = id ? `${id} - amino-acid position` : "amino-acid position";
    const titleCx = layout.left + layout.innerW / 2;
    svg.appendChild(
      text(
        titleCx,
        layout.axisY + tx.title,
        fit(title, 2 * Math.min(titleCx, width - titleCx) - 4, sizes.axisTitle),
        theme.muted,
        "middle",
        sizes.axisTitle,
      ),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const cls = classes();
    if (!cls.length) return;
    const cols = classColors();
    const { items, note, names } = legendLayout();
    const tx = lollipopText(sizes);
    // Rows start under the axis title.
    const firstY = layout.axisY + tx.legend;
    if (note) {
      svg.appendChild(
        text(
          layout.left + note.x,
          firstY + note.row * tx.legendRowH,
          note.text,
          theme.muted,
          "start",
          sizes.label,
        ),
      );
    }
    items.forEach(({ x: dx, row }, i) => {
      const x = layout.left + dx;
      const y = firstY + row * tx.legendRowH;
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x + 4));
      dot.setAttribute("cy", String(y - midline(sizes.label)));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", cols[i] ?? theme.foreground);
      svg.appendChild(dot);
      svg.appendChild(
        text(x + 12, y, names[i] ?? "", theme.foreground, "start", sizes.label),
      );
    });
  }

  // ---- SVG helpers ----
  function text(
    x: number,
    y: number,
    content: string,
    fill: string,
    anchor: string,
    size: number,
  ) {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", fill);
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("font-family", theme.fontFamily);
    t.setAttribute("font-size", String(size));
    t.textContent = content;
    return t;
  }
  function rotatedText(
    x: number,
    y: number,
    content: string,
    fill: string,
    size: number,
  ) {
    const t = text(x, y, content, fill, "middle", size);
    t.setAttribute("transform", `rotate(-90 ${x} ${y})`);
    return t;
  }
  function line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
  ) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", "1");
    return l;
  }

  function doResize(w: number, h: number) {
    fitBox(w, h);
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    doResize(m.width, m.height);
  }

  const instance: PlotomicsInstance<LollipopOptions> = {
    setData(next) {
      data = next;
      render();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      sizes = textSizes(theme);
      // A new padding changes the plot box.
      doResize(outerW, outerH);
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
    },
    async exportPNG(scale = 2) {
      // The canvas with the axes, labels and legend over it.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        element: el,
        layers: [{ canvas, x: 0, y: 0, width, height }],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      plot.remove();
    },
  };

  return guardDestroy(instance);
};

// ---- small utilities ----
/**
 * Pfam names run long ("P53 DNA-binding domain"); keep the informative head.
 * A missing name is empty.
 */
function shortDomain(name: string | null | undefined): string {
  return (name ?? "").replace(/\s*(domain|motif|family)\s*$/i, "");
}
/**
 * A count as text: a whole number as it is, any other to seven significant
 * digits, which drops the noise of a float32 count from Python, so 0.3
 * reads "0.3", not "0.30000001192092896".
 */
function fmtCount(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(7)));
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
function mergeOptions(
  base: LollipopOptions,
  next?: Partial<LollipopOptions>,
): LollipopOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
