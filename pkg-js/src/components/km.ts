/**
 * KM — a Kaplan-Meier survival plot with a number-at-risk table.
 *
 * The convention this follows is not negotiable in clinical work: a right-
 * continuous step function per stratum, censoring marked with ticks, and a
 * number-at-risk table under the axis aligned to the same time grid. A survival
 * curve without the risk table hides how much of the tail rests on a handful of
 * patients, which is exactly where readers over-interpret it.
 *
 * The component draws, it does not estimate. Survival probabilities, confidence
 * bands, censoring times, at-risk counts and the log-rank p all arrive computed.
 * That is deliberate: estimation belongs where the data is, and a host that also
 * renders the same figure server-side (R's `survival` package, say) must be able
 * to hand both renderers one set of numbers so the two cannot disagree about
 * where a curve steps.
 *
 * Curves, the confidence band and the gridlines under them are canvas-drawn;
 * axes, the risk table and the legend are an SVG overlay.
 *
 * ## Data contract
 * - `columns.time`   `number[]`  step time (required, ascending within a group)
 * - `columns.surv`   `number[]`  survival probability in [0, 1] (required)
 * - `columns.lower`  `number[]`  lower confidence limit; omit to skip the band
 * - `columns.upper`  `number[]`  upper confidence limit
 * - `columns.group`  `string[]`  stratum per point; omit for a single curve
 * - `meta.groups`       `string[]`  stratum order; defaults to order of appearance
 * - `meta.groupColors`  `string[]`  one colour per stratum
 * - `meta.censorTime`   `number[]`  censoring tick times
 * - `meta.censorSurv`   `number[]`  survival value at each tick
 * - `meta.censorGroup`  `string[]`  stratum per tick
 * - `meta.riskTimes`    `number[]`  time grid for the at-risk table
 * - `meta.riskCounts`   `number[]`  groups x riskTimes, row-major
 * - `meta.pLabel`       `string`    e.g. "log-rank p = 0.02", drawn in the corner
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
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth,
  fitText,
  categoricalColors,
} from "../core/index.js";
import { setCanvasColour } from "../core/paint.js";

export interface KmOptions {
  /** Shade the pointwise confidence band when `lower`/`upper` are present. */
  showCI: boolean;
  /** Mark censoring times with a tick on the curve. */
  showCensors: boolean;
  /**
   * Draw the number-at-risk table beneath the axis. A plot too short for
   * a row per stratum under the panel leaves the table out.
   */
  showRiskTable: boolean;
  /** Draw the stratum legend, in a band above the panel. */
  showLegend: boolean;
  /** Start the y axis at zero (the honest default) rather than at the lowest
   * point of the lowest curve. Zooming y exaggerates separation, so this is
   * opt-out rather than automatic. */
  yFromZero: boolean;
  /** Curve stroke width in pixels. */
  lineWidth: number;
  xLabel: string;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultKmOptions: KmOptions = {
  showCI: true,
  showCensors: true,
  showRiskTable: true,
  showLegend: true,
  yFromZero: true,
  lineWidth: 2,
  xLabel: "time",
  yLabel: "overall survival",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Smallest left gutter. */
const MIN_LEFT = 58;
/** Widest left gutter, as a share of the element width. */
const MAX_LEFT_SHARE = 0.35;
/** Length of a censoring tick, in pixels either side of the curve. */
const CENSOR_TICK = 4;
/** Least height of the curve panel, in px. */
const MIN_PANEL = 40;
/** Largest share of the height that the legend above the panel takes. */
const LEGEND_SHARE = 0.2;
/** Side of a legend swatch, and the space from it to its name, in px. */
const SWATCH = 8;
const SWATCH_GAP = 4;
/** Space between two legend entries on a row, in px. */
const LEGEND_GAP = 12;
/**
 * Least width of a legend entry cut short to make room for the "+N more"
 * note: the swatch and a few letters.
 */
const MIN_ENTRY = SWATCH + SWATCH_GAP + 24;
/** Least space between two time labels, or two risk-table counts, in px. */
const COLUMN_GAP = 6;
/** Steps of the survival ticks, in whole percentages, finest first. */
const SURVIVAL_STEPS = [1, 2, 5, 10, 20, 25, 50];
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
 * Where the text around the curve panel goes for the given text sizes:
 * offsets below the time axis of the tick labels, the x title and the
 * "number at risk" heading, and the size of the risk-table rows. Each line
 * starts under the font box of the line above it.
 */
function kmText(s: TextSizes) {
  const tick = 6 + s.label;
  const title = tick + Math.ceil(DESCENT * s.label + ASCENT * s.axisTitle) + 1;
  const heading = title + Math.ceil((DESCENT + ASCENT) * s.axisTitle) + 1;
  const rowH = Math.round(s.label + 5);
  /** Gap from the axis to the middle of a row under the text line at `y`. */
  const firstRow = (y: number) =>
    y + Math.ceil(DESCENT * s.axisTitle) + 2 + rowH / 2;
  return {
    /** x of the rotated y title, far enough right for its letters. */
    titleX: Math.ceil(1.1 * s.axisTitle),
    tick,
    title,
    heading,
    /** Room under the axis for the tick labels and the x title alone. */
    axisOnly: Math.ceil(title + DESCENT * s.axisTitle) + 1,
    /** Room under the axis for the tick labels alone. */
    ticksOnly: Math.ceil(tick + DESCENT * s.label) + 1,
    /** Room under the axis for the lower half of the label at the floor. */
    floorLabel: Math.ceil((0.35 + DESCENT) * s.label),
    /** Gap from the axis to the middle of the first risk-table row. */
    gap: firstRow(heading),
    /** The same gap for a table without its heading. */
    gapBare: firstRow(title),
    /** Height of one risk-table row. */
    rowH,
    /** Smallest row: one name tall, with a pixel to spare. */
    minRowH: Math.ceil(s.label) + 1,
    /** Space between a stratum name and the column of counts at time 0. */
    labelGap: 2 * s.small,
    /** Distance between the baselines of two legend rows. */
    legendStep: Math.round(s.label + 4),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/km.test.ts)
// ---------------------------------------------------------------------------

export interface KmLayout {
  left: number;
  right: number;
  top: number;
  /** y of the time axis. */
  axisY: number;
  /** Height of the curve panel. */
  plotH: number;
  /** y of the middle of the first risk-table row. */
  riskTop: number;
  riskRowH: number;
  /**
   * Whether the number-at-risk table is drawn: it is asked for, it has
   * counts, and the element has room under the panel for a row per stratum.
   */
  table: boolean;
  /** Whether the "number at risk" heading is drawn over the table. */
  tableHeading: boolean;
  /**
   * The legend entries in the band above the panel: the index of the
   * stratum each shows, or -1 for the "+N more" note, the x of its left
   * edge, the baseline of its text and the width it may take.
   */
  legend: { index: number; x: number; y: number; width: number }[];
  /** Strata the legend leaves out, counted in its "+N more" note. */
  legendMore: number;
  /** Whether the time labels are drawn under the axis. */
  xTicks: boolean;
  /** Whether the x title is drawn under the time labels. */
  xTitle: boolean;
}

/**
 * Frame the curve panel, with the legend in a band above it and the
 * number-at-risk table, one row per stratum, under the axis. Nothing goes
 * past the element: the table rows tighten to fit, then the table drops its
 * heading, and when even that does not fit under a panel MIN_PANEL px high
 * the table is left out. The legend takes at most a share of the height,
 * and the strata past the rows it holds go into a "+N more" note. The left
 * gutter grows with the longest stratum name in the table, up to a share of
 * the width; longer names are shortened when drawn.
 */
export function layoutKm(
  width: number,
  height: number,
  nGroups: number,
  opts: Pick<KmOptions, "showRiskTable">,
  /** Whether risk counts were given; without them no table is drawn. */
  hasCounts = true,
  /** Width in px of the longest stratum name in the table. */
  labelWidth = 0,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
  /** Width in px of the widest y tick label. */
  tickWidth = 0,
  /** Width in px of the widest text centred on the last time tick. */
  endWidth = 0,
  /** Width in px of each legend entry, swatch and name; none for no legend. */
  legendWidths: readonly number[] = [],
  /** Width in px of the widest "+N more" note the legend may need. */
  moreWidth = 0,
): KmLayout {
  const t = kmText(sizes);
  const wantTable = opts.showRiskTable && nGroups > 0 && hasCounts;
  // The y tick labels sit between the rotated y title and the panel.
  const minLeft = Math.max(
    MIN_LEFT,
    Math.ceil(t.titleX + DESCENT * sizes.axisTitle + 3 + tickWidth + 8),
  );
  // The stratum names sit left of the counts at time 0, so the gutter grows
  // to fit the longest one.
  const tableLeft = wantTable
    ? Math.max(
        minLeft,
        Math.min(
          Math.ceil(labelWidth) + t.labelGap + 8,
          Math.floor(width * MAX_LEFT_SHARE),
        ),
      )
    : minLeft;
  // The last tick label is centred on the right edge of the panel.
  const right = Math.max(16, Math.ceil(endWidth / 2) + 2);
  // Room above the panel for the top half of the "100%" tick label.
  const topGap = Math.max(14, Math.ceil((ASCENT - 0.35) * sizes.label) + 2);

  // The legend band over the panel: the first baseline sits a font box
  // below the top, and the band ends 4 px above the "100%" label.
  const band = (rows: number) =>
    rows > 0
      ? Math.ceil(ASCENT * sizes.label) +
        (rows - 1) * t.legendStep +
        Math.ceil(DESCENT * sizes.label) +
        4
      : 0;
  // As many rows as a share of the height holds, while the panel keeps its
  // least height and the axis its labels.
  let maxRows = 0;
  if (legendWidths.length > 0) {
    maxRows = Math.max(
      0,
      Math.floor((LEGEND_SHARE * height - band(1)) / t.legendStep) + 1,
    );
    while (
      maxRows > 0 &&
      topGap + band(maxRows) + MIN_PANEL + t.axisOnly > height
    ) {
      maxRows -= 1;
    }
  }
  const legendAt = (left: number) =>
    flowLegend(legendWidths, width - left - right, maxRows, moreWidth);
  let legend = legendAt(tableLeft);
  let top = topGap + band(legend.rows);

  // The table takes a row per stratum, at the least row height, under a
  // panel of the least height: with its heading, else without it, else the
  // table is left out.
  const room = height - top - MIN_PANEL;
  const tableHeading = wantTable && room >= t.gap + nGroups * t.minRowH;
  const table =
    tableHeading || (wantTable && room >= t.gapBare + nGroups * t.minRowH);
  const left = table ? tableLeft : minLeft;
  if (left !== tableLeft) {
    legend = legendAt(left);
    top = topGap + band(legend.rows);
  }
  const gap = tableHeading ? t.gap : t.gapBare;
  // Without a table, the room under a panel of the least height holds the
  // time labels and the x title, else the labels alone, else neither.
  const free = height - top - MIN_PANEL;
  const xTitle = table || free >= t.axisOnly;
  const xTicks = xTitle || free >= t.ticksOnly;
  const riskH = table
    ? gap + nGroups * t.rowH
    : xTitle
      ? t.axisOnly
      : xTicks
        ? t.ticksOnly
        : t.floorLabel;
  // The panel keeps half the element when the tightest rows fit under that,
  // and the rows open up to their full height as the room allows. Without
  // a table the panel takes the height the axis leaves: below the least
  // height only when the axis has no labels left to drop.
  const tightest = table ? gap + nGroups * t.minRowH : riskH;
  const axisY = table
    ? Math.max(
        top + MIN_PANEL,
        height - riskH,
        Math.min(height * 0.5, height - tightest),
      )
    : height - riskH;
  const avail = height - axisY - gap;
  const riskRowH = table
    ? Math.min(t.rowH, Math.max(t.minRowH, avail / nGroups))
    : t.rowH;
  const first = Math.ceil(ASCENT * sizes.label);
  return {
    left,
    right,
    top,
    axisY,
    plotH: Math.max(1, axisY - top),
    riskTop: axisY + gap,
    riskRowH,
    table,
    tableHeading,
    legend: legend.entries.map((e) => ({
      index: e.index,
      x: left + e.x,
      y: first + e.row * t.legendStep,
      width: e.width,
    })),
    legendMore: legend.more,
    xTicks,
    xTitle,
  };
}

/**
 * Expand Kaplan-Meier points into the vertices of a right-continuous step.
 *
 * Between two estimates the survival probability holds flat and then drops at
 * the event time, so drawing a straight line between points would claim a
 * gradual decline that the estimator never asserts. Returns a flat
 * `[x0, y0, x1, y0, x1, y1, ...]` polyline.
 */
export function stepPoints(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
): number[] {
  const n = Math.min(times.length, values.length);
  if (n === 0) return [];
  const out: number[] = [times[0] as number, values[0] as number];
  for (let i = 1; i < n; i += 1) {
    const t = times[i] as number;
    const v = values[i] as number;
    out.push(t, values[i - 1] as number);
    out.push(t, v);
  }
  return out;
}

/**
 * The rows of each group, ordered by time (ties keep their row order).
 * Returns them in `groups` order, skipping absent groups. Rows of different
 * groups may be interleaved, as in a table sorted by time overall.
 */
export function groupRows(
  groupCol: ArrayLike<string>,
  groups: readonly string[],
  times: ArrayLike<number>,
): { group: string; rows: number[] }[] {
  const byGroup = new Map<string, number[]>();
  for (const g of groups) byGroup.set(g, []);
  for (let i = 0; i < groupCol.length; i += 1) {
    byGroup.get(groupCol[i] as string)?.push(i);
  }
  const out: { group: string; rows: number[] }[] = [];
  for (const g of groups) {
    const rows = byGroup.get(g) ?? [];
    if (!rows.length) continue;
    // Array.prototype.sort is stable, so equal times keep their row order.
    rows.sort((a, b) => (times[a] as number) - (times[b] as number));
    out.push({ group: g, rows });
  }
  return out;
}

/**
 * Indices at which each group's points start and end, assuming a group's points
 * are contiguous. Returns them in `groups` order, skipping absent groups.
 * The component uses {@link groupRows}, which does not need contiguous rows.
 */
export function groupSlices(
  groupCol: ArrayLike<string>,
  groups: readonly string[],
): { group: string; start: number; end: number }[] {
  const out: { group: string; start: number; end: number }[] = [];
  for (const g of groups) {
    let start = -1;
    let end = -1;
    for (let i = 0; i < groupCol.length; i += 1) {
      if (groupCol[i] !== g) continue;
      if (start < 0) start = i;
      end = i;
    }
    if (start >= 0) out.push({ group: g, start, end });
  }
  return out;
}

/**
 * Format a time for the tooltip: whole numbers print as they are and other
 * values keep up to two decimals.
 */
export function formatTime(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/**
 * Decimals that show every value of `ticks` in full, so uneven risk times such
 * as 1, 2.5 and 5 print as "1.0", "2.5" and "5.0" and not "1", "3", "5".
 */
export function tickDecimals(ticks: readonly number[]): number {
  let d = 0;
  for (const t of ticks) {
    while (d < 6) {
      const s = Math.abs(t) * 10 ** d;
      if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, s)) break;
      d += 1;
    }
  }
  return d;
}

/**
 * The survival ticks from the axis floor `lo` to 1 (100%) on an axis
 * `lengthPx` long, for labels `labelPx` in size. The ticks are the
 * multiples of a round step in whole percentages (1, 2, 5, 10, 20, 25 or
 * 50) from the floor up: the finest step that gives four steps or fewer,
 * as 0, 25, 50, 75 and 100% from a floor of 0 or 20, 40, 60, 80 and 100%
 * from a floor of 15%, and a coarser one when those labels come closer than
 * `labelPx` + 5 px. On an axis too short for two such ticks, the floor and
 * 1 alone when those keep `labelPx` + 2 px; 1 alone on a shorter axis, and
 * none on an axis with no length.
 */
export function survivalTicks(
  lo: number,
  lengthPx: number,
  labelPx: number,
): number[] {
  const span = 1 - lo;
  for (const step of SURVIVAL_STEPS) {
    // The first multiple at or above the floor. The floor may carry float
    // noise, such as 0.15000000000000002, which must not skip a tick.
    const first = Math.max(0, Math.ceil((lo * 100) / step - 1e-9));
    const last = 100 / step;
    const steps = last - first;
    if (steps > 4 || steps < 1) continue;
    if (((step / 100) * lengthPx) / span < labelPx + 5) continue;
    return Array.from(
      { length: steps + 1 },
      (_, k) => ((first + k) * step) / 100,
    );
  }
  if (lengthPx >= labelPx + 2) return [lo, 1];
  return lengthPx > 0 ? [1] : [];
}

/** A survival tick as a percentage, with the decimals that print it exactly. */
export function survivalLabel(v: number): string {
  const pct = v * 100;
  return `${pct.toFixed(tickDecimals([pct]))}%`;
}

/** Round `max` up to a readable axis bound and produce evenly spaced ticks. */
export function timeTicks(max: number, target = 6): number[] {
  if (!isFinite(max) || max <= 0) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step)
    out.push(Number(t.toFixed(6)));
  return out;
}

/**
 * Lay legend entries `widths` px wide out in rows `room` px wide, in order,
 * with LEGEND_GAP px between two entries on a row. An entry starts a new
 * row when it does not fit on the current one, and an entry wider than the
 * room is cut to it. When the entries need more than `maxRows` rows, the
 * last row ends with a "+N more" note `moreWidth` px wide, and N counts the
 * entries with no place before it; a lone entry on that row is cut short
 * to make room for the note. A legend that cannot show one entry and the
 * note shows nothing.
 */
export function flowLegend(
  widths: readonly number[],
  room: number,
  maxRows: number,
  moreWidth: number,
): {
  /** Each entry shown: its index, or -1 for the note, x, row and width. */
  entries: { index: number; x: number; row: number; width: number }[];
  rows: number;
  more: number;
} {
  type Slot = { index: number; x: number; row: number; width: number };
  const none = { entries: [], rows: 0, more: 0 };
  if (widths.length === 0 || maxRows < 1 || !(room > 0)) return none;
  const entries: Slot[] = [];
  let x = 0;
  let row = 0;
  for (let i = 0; i < widths.length; i += 1) {
    const w = Math.min(widths[i] as number, room);
    if (x > 0 && x + w > room) {
      row += 1;
      x = 0;
    }
    entries.push({ index: i, x, row, width: w });
    x += w + LEGEND_GAP;
  }
  if (row < maxRows) return { entries, rows: row + 1, more: 0 };

  const lastRow = maxRows - 1;
  const kept = entries.filter((e) => e.row <= lastRow);
  const note = Math.min(moreWidth, room);
  let noteX = 0;
  for (;;) {
    const e = kept[kept.length - 1];
    if (!e) return none;
    // Every entry of the last row has given way: the note starts it.
    if (e.row < lastRow) break;
    const end = e.x + e.width + LEGEND_GAP;
    if (end + note <= room) {
      noteX = end;
      break;
    }
    const cut = room - LEGEND_GAP - note;
    if (e.x === 0 && cut >= MIN_ENTRY) {
      e.width = cut;
      noteX = cut + LEGEND_GAP;
      break;
    }
    kept.pop();
  }
  const more = widths.length - kept.length;
  kept.push({ index: -1, x: noteX, row: lastRow, width: note });
  return { entries: kept, rows: maxRows, more };
}

/**
 * The stride from one labelled time tick to the next: the least k for
 * which every k-th column from the first, centred at `xs` and `widths` px
 * wide, keeps `gapPx` from the next one kept. A column is a time label and
 * the risk-table counts under it. The strides tried are 1, 2, 4 and 5 times
 * a power of ten, so a round grid stays round: 0, 50, 100, ... thins to
 * 0, 100, 200, ... and never to 0, 150, 300, .... A stride past the last
 * column keeps the first one alone.
 */
export function tickStride(
  xs: readonly number[],
  widths: readonly number[],
  gapPx = COLUMN_GAP,
): number {
  const n = xs.length;
  const clear = (k: number) => {
    for (let i = 0; i + k < n; i += k) {
      const need = ((widths[i] ?? 0) + (widths[i + k] ?? 0)) / 2 + gapPx;
      if ((xs[i + k] as number) - (xs[i] as number) < need) return false;
    }
    return true;
  };
  for (let power = 1; power < n; power *= 10) {
    for (const f of [1, 2, 4, 5]) {
      const k = f * power;
      if (k < n && clear(k)) return k;
    }
  }
  return Math.max(1, n);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createKm: PlotomicsFactory<KmOptions> = (el, initial) => {
  let opts: KmOptions = mergeOptions(defaultKmOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutKm(0, 0, 0, opts);

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
  const times = () => (data.columns.time as ArrayLike<number>) ?? [];
  const survs = () => (data.columns.surv as ArrayLike<number>) ?? [];
  const lowers = () => data.columns.lower as ArrayLike<number> | undefined;
  const uppers = () => data.columns.upper as ArrayLike<number> | undefined;
  const groupCol = () => (data.columns.group as string[]) ?? [];

  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    if (given && given.length) return given;
    const gc = groupCol();
    if (!gc.length) return ["all"];
    // A row with a missing group (null) is in no stratum and draws no curve.
    const seen: string[] = [];
    for (const g of gc) if (g != null && !seen.includes(g)) seen.push(g);
    return seen;
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, groups().length);
  }
  /** Each stratum's rows, in time order. */
  function strata(): { group: string; rows: number[] }[] {
    const gc = groupCol();
    const t = times();
    if (!gc.length) {
      const rows = Array.from({ length: t.length }, (_, i) => i);
      rows.sort((a, b) => (t[a] as number) - (t[b] as number));
      return [{ group: groups()[0] ?? "all", rows }];
    }
    return groupRows(gc, groups(), t);
  }
  /**
   * Where a stratum's curve ends: its last given point, or its last
   * censoring tick when that comes later. A table of event times alone stops
   * at the last event, while follow-up runs on to the last censored subject.
   */
  function curveEnd(group: string, lastTime: number): number {
    const ct = data.meta?.censorTime as number[] | undefined;
    const cg = data.meta?.censorGroup as string[] | undefined;
    let end = lastTime;
    // Ticks without a stratum belong to a curve only when there is one.
    if (ct && (cg || strata().length === 1)) {
      for (let i = 0; i < ct.length; i += 1) {
        if (cg && cg[i] !== group) continue;
        if ((ct[i] as number) > end) end = ct[i] as number;
      }
    }
    return end;
  }
  function maxTime(): number {
    const t = times();
    let m = 0;
    for (let i = 0; i < t.length; i += 1)
      if ((t[i] as number) > m) m = t[i] as number;
    const risk = data.meta?.riskTimes as number[] | undefined;
    if (risk) for (const r of risk) if (r > m) m = r;
    const ct = data.meta?.censorTime as number[] | undefined;
    if (ct) for (const c of ct) if (c > m) m = c;
    return m > 0 ? m : 1;
  }
  function yMin(): number {
    if (opts.yFromZero) return 0;
    let m = 1;
    const scan = (col: ArrayLike<number> | undefined) => {
      if (!col) return;
      for (let i = 0; i < col.length; i += 1) {
        const v = col[i] as number;
        if (Number.isFinite(v) && v < m) m = v;
      }
    };
    scan(survs());
    // The band is drawn when both edges are given, so its lower edge must
    // then fit on the axis.
    if (opts.showCI && uppers()) scan(lowers());
    return Math.max(0, Math.floor(m * 10) / 10 - 0.05);
  }
  /** Width of `s` in px at the label size. */
  function labelWidth(s: string): number {
    return textWidth(s, sizes.label, theme.fontFamily);
  }
  /** Width of the widest stratum name in the risk table, in px. */
  function riskLabelWidth(): number {
    let w = 0;
    for (const g of groups()) w = Math.max(w, labelWidth(g));
    return w;
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(s: string, maxW: number, size = sizes.label): string {
    return fitText(s, maxW, size, theme.fontFamily);
  }
  /** The time ticks inside the axis, and the decimals their labels need. */
  function timeAxis(tmax: number): { ticks: number[]; decimals: number } {
    const all =
      (data.meta?.riskTimes as number[] | undefined) ?? timeTicks(tmax);
    const ticks = all.filter((t) => t <= tmax);
    // Every tick gets the decimals the most precise one needs, so 12.5 reads
    // "12.5" and not "13".
    return { ticks, decimals: tickDecimals(ticks) };
  }
  /**
   * Width of the widest text centred on the last time tick: its label, or a
   * count of the risk table under it.
   */
  function endWidth(tmax: number): number {
    const { ticks, decimals } = timeAxis(tmax);
    let last = Number.NEGATIVE_INFINITY;
    for (const t of ticks) if (t > last) last = t;
    if (!Number.isFinite(last)) return 0;
    let w = labelWidth(last.toFixed(decimals));
    const counts = data.meta?.riskCounts as number[] | undefined;
    const riskTimes = data.meta?.riskTimes as number[] | undefined;
    if (opts.showRiskTable && counts && riskTimes) {
      const n = groups().length;
      for (let j = 0; j < riskTimes.length; j += 1) {
        if (riskTimes[j] !== last) continue;
        for (let g = 0; g < n; g += 1) {
          const c = counts[g * riskTimes.length + j];
          if (c === undefined) continue;
          w = Math.max(w, textWidth(String(c), sizes.small, theme.fontFamily));
        }
      }
    }
    return w;
  }
  /**
   * The time ticks that keep their labels: every k-th from the first, for
   * the least stride k that keeps each label, and the counts of `table`
   * under it, COLUMN_GAP px from the next one kept (see tickStride).
   */
  function keptTimes(
    ticks: number[],
    decimals: number,
    tmax: number,
    table: { counts: number[]; riskTimes: number[] } | null,
  ): number[] {
    const n = groups().length;
    const widths = ticks.map((t) => {
      let w = labelWidth(t.toFixed(decimals));
      const j = table ? table.riskTimes.indexOf(t) : -1;
      for (let g = 0; table && j >= 0 && g < n; g += 1) {
        const c = table.counts[g * table.riskTimes.length + j];
        if (c === undefined) continue;
        w = Math.max(w, textWidth(String(c), sizes.small, theme.fontFamily));
      }
      return w;
    });
    const k = tickStride(
      ticks.map((t) => sx(t, tmax)),
      widths,
    );
    return ticks.filter((_, i) => i % k === 0);
  }
  function hasRiskCounts(): boolean {
    return Boolean(data.meta?.riskCounts && data.meta?.riskTimes);
  }

  // ---- scales ----
  function sx(t: number, tmax: number): number {
    return layout.left + (t / tmax) * (width - layout.left - layout.right);
  }
  function sy(v: number, lo: number): number {
    return layout.axisY - ((v - lo) / (1 - lo)) * layout.plotH;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);
    if (
      my < layout.top ||
      my > layout.axisY ||
      mx < layout.left ||
      mx > width - layout.right
    ) {
      tooltip.hide();
      return;
    }
    const tmax = maxTime();
    const lo = yMin();
    const t =
      ((mx - layout.left) / (width - layout.left - layout.right)) * tmax;
    const tArr = times();
    const sArr = survs();
    // Per stratum, the estimate in force at time t is the last step at or
    // before it. That is what the curve is showing at the cursor.
    const rows: string[] = [];
    const cols = groupColors();
    const gl = groups();
    for (const sl of strata()) {
      let idx = -1;
      for (const i of sl.rows) {
        if ((tArr[i] as number) <= t) idx = i;
        else break;
      }
      if (idx < 0) continue;
      // Past the end of the curve there is no estimate to show.
      const last = sl.rows[sl.rows.length - 1] as number;
      if (t > curveEnd(sl.group, tArr[last] as number)) continue;
      const gi = gl.indexOf(sl.group);
      const col = gi >= 0 ? (cols[gi] as string) : theme.foreground;
      rows.push(
        `<span style="color:${col}">&#9632;</span> ${esc(sl.group)} ` +
          `<b>${(100 * (sArr[idx] as number)).toFixed(0)}%</b>`,
      );
    }
    if (!rows.length) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      `<b>${formatTime(t)} ${esc(opts.xLabel)}</b><br/>${rows.join("<br/>")}`,
      lastPointer.x,
      lastPointer.y,
    );
    void lo;
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
    const gl = groups();
    // The legend names the strata when there is more than one.
    const legend = opts.showLegend && gl.length > 1;
    layout = layoutKm(
      width,
      height,
      gl.length,
      opts,
      hasRiskCounts(),
      riskLabelWidth(),
      sizes,
      labelWidth("100%"),
      endWidth(maxTime()),
      legend ? gl.map((g) => SWATCH + SWATCH_GAP + labelWidth(g)) : [],
      legend ? labelWidth(`+${gl.length - 1} more`) : 0,
    );
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    const lo = yMin();

    // y gridlines first, so the bands and the curves are drawn over them. A
    // grid colour that paints nothing, such as "none", draws no line.
    if (setCanvasColour(ctx, "strokeStyle", theme.grid, el)) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of gridValues(lo)) {
        // On a half pixel, so the 1 px line fills one row of pixels.
        const y = Math.round(sy(v, lo)) + 0.5;
        ctx.moveTo(layout.left, y);
        ctx.lineTo(width - layout.right, y);
      }
      ctx.stroke();
    }

    const tArr = times();
    if (!tArr.length) {
      renderOverlay();
      return;
    }
    const tmax = maxTime();
    const cols = groupColors();
    const lower = lowers();
    const upper = uppers();
    const sArr = survs();

    // A band or a curve that reaches below the axis floor stops at the axis.
    // The other edges leave room for a full stroke and censoring tick, since
    // every curve starts on the 100% line and may end on the right edge.
    const pad = Math.max(CENSOR_TICK, opts.lineWidth) + 1;
    const below = lo > 0 ? 0 : pad;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.left - pad,
      layout.top - pad,
      width - layout.left - layout.right + 2 * pad,
      layout.plotH + pad + below,
    );
    ctx.clip();

    // Each stratum's points in time order, with a flat step added out to the
    // end of follow-up when it runs past the last given point.
    const series = strata().map((sl) => {
      const rows = sl.rows;
      const t = pick(tArr, rows);
      const end = curveEnd(sl.group, t[t.length - 1] as number);
      const extend = <T>(v: T[]) =>
        end > (t[t.length - 1] as number) ? [...v, v[v.length - 1] as T] : v;
      return {
        group: sl.group,
        t: extend(t).map((x, k) => (k === t.length ? end : x)),
        s: extend(pick(sArr, rows)),
        lo: lower ? extend(pick(lower, rows)) : null,
        up: upper ? extend(pick(upper, rows)) : null,
      };
    });

    // Confidence bands first, so the curves read on top of them.
    if (opts.showCI && lower && upper) {
      for (const sr of series) {
        const gi = gl.indexOf(sr.group);
        const col = gi >= 0 ? (cols[gi] as string) : theme.foreground;
        const up = stepPoints(sr.t, sr.up as number[]);
        const dn = stepPoints(sr.t, sr.lo as number[]);
        if (!up.length || !dn.length) continue;
        ctx.beginPath();
        ctx.moveTo(sx(up[0] as number, tmax), sy(up[1] as number, lo));
        for (let i = 2; i < up.length; i += 2) {
          ctx.lineTo(sx(up[i] as number, tmax), sy(up[i + 1] as number, lo));
        }
        for (let i = dn.length - 2; i >= 0; i -= 2) {
          ctx.lineTo(sx(dn[i] as number, tmax), sy(dn[i + 1] as number, lo));
        }
        ctx.closePath();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Curves.
    ctx.lineWidth = opts.lineWidth;
    ctx.lineJoin = "round";
    for (const sr of series) {
      const gi = gl.indexOf(sr.group);
      ctx.strokeStyle = gi >= 0 ? (cols[gi] as string) : theme.foreground;
      const pts = stepPoints(sr.t, sr.s);
      if (!pts.length) continue;
      ctx.beginPath();
      ctx.moveTo(sx(pts[0] as number, tmax), sy(pts[1] as number, lo));
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(sx(pts[i] as number, tmax), sy(pts[i + 1] as number, lo));
      }
      ctx.stroke();
    }

    // Censoring ticks.
    const ct = data.meta?.censorTime as number[] | undefined;
    const cs = data.meta?.censorSurv as number[] | undefined;
    const cg = data.meta?.censorGroup as string[] | undefined;
    if (opts.showCensors && ct && cs) {
      ctx.lineWidth = 1;
      for (let i = 0; i < ct.length; i += 1) {
        // A tick with a missing group belongs to no curve.
        if (cg && cg[i] == null) continue;
        const gi = cg ? gl.indexOf(cg[i] as string) : 0;
        ctx.strokeStyle = gi >= 0 ? (cols[gi] as string) : theme.foreground;
        const x = sx(ct[i] as number, tmax);
        const y = sy(cs[i] as number, lo);
        ctx.beginPath();
        ctx.moveTo(x, y - CENSOR_TICK);
        ctx.lineTo(x, y + CENSOR_TICK);
        ctx.stroke();
      }
    }
    ctx.restore();

    renderOverlay();
  }

  /**
   * The values of the y ticks and their gridlines, from the axis floor to
   * 100%, as many as the panel keeps clear (see survivalTicks). A label
   * whose font box would leave the plot box, in a plot only a few labels
   * high, is left out with its gridline.
   */
  function gridValues(lo: number): number[] {
    const above = (ASCENT - 0.35) * sizes.label;
    const below = (0.35 + DESCENT) * sizes.label;
    return survivalTicks(lo, layout.plotH, sizes.label).filter((v) => {
      const y = sy(v, lo);
      return y - above >= 0 && y + below <= height;
    });
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const gl = groups();
    const cols = groupColors();
    const tmax = maxTime();
    const lo = yMin();
    const tx = kmText(sizes);

    // y tick labels, as percentages; the gridlines are on the canvas, under
    // the bands and the curves.
    for (const v of gridValues(lo)) {
      const y = sy(v, lo);
      svg.appendChild(
        text(
          layout.left - 8,
          y + midline(sizes.label),
          survivalLabel(v),
          theme.muted,
          "end",
          sizes.label,
        ),
      );
    }
    svg.appendChild(
      rotatedText(
        tx.titleX,
        layout.top + layout.plotH / 2,
        fit(opts.yLabel, layout.plotH, sizes.axisTitle),
        theme.muted,
        sizes.axisTitle,
      ),
    );

    // x axis.
    svg.appendChild(
      line(
        layout.left,
        layout.axisY,
        width - layout.right,
        layout.axisY,
        theme.axis,
      ),
    );
    const { ticks, decimals } = timeAxis(tmax);
    const counts = data.meta?.riskCounts as number[] | undefined;
    const riskTimes = data.meta?.riskTimes as number[] | undefined;
    const table =
      layout.table && counts && riskTimes ? { counts, riskTimes } : null;
    // The times whose labels, and columns of counts, stay clear of their
    // neighbours.
    const kept = layout.xTicks ? keptTimes(ticks, decimals, tmax, table) : [];
    for (const t of kept) {
      const x = sx(t, tmax);
      svg.appendChild(line(x, layout.axisY, x, layout.axisY + 4, theme.axis));
      svg.appendChild(
        text(
          x,
          layout.axisY + tx.tick,
          t.toFixed(decimals),
          theme.muted,
          "middle",
          sizes.label,
        ),
      );
    }
    const titleCx = (layout.left + width - layout.right) / 2;
    if (layout.xTitle) {
      svg.appendChild(
        text(
          titleCx,
          layout.axisY + tx.title,
          fit(
            opts.xLabel,
            2 * Math.min(titleCx, width - titleCx) - 4,
            sizes.axisTitle,
          ),
          theme.muted,
          "middle",
          sizes.axisTitle,
        ),
      );
    }

    // Number at risk, one row per stratum, with a count under each time
    // label kept.
    if (table) {
      if (layout.tableHeading) {
        svg.appendChild(
          text(
            layout.left,
            layout.axisY + tx.heading,
            "number at risk",
            theme.foreground,
            "start",
            sizes.axisTitle,
          ),
        );
      }
      const shown = new Set(kept);
      const nTimes = table.riskTimes.length;
      for (let g = 0; g < gl.length; g += 1) {
        const y = layout.riskTop + g * layout.riskRowH;
        // The names end short of the counts at time 0, which are centred on
        // the left edge of the panel.
        svg.appendChild(
          text(
            layout.left - tx.labelGap,
            y + midline(sizes.label),
            fit(gl[g] ?? "", layout.left - tx.labelGap - 4),
            cols[g] ?? theme.foreground,
            "end",
            sizes.label,
          ),
        );
        for (let j = 0; j < nTimes; j += 1) {
          const t = table.riskTimes[j] as number;
          if (t > tmax || !shown.has(t)) continue;
          const n = table.counts[g * nTimes + j];
          if (n === undefined) continue;
          svg.appendChild(
            text(
              sx(t, tmax),
              y + midline(sizes.small),
              String(n),
              theme.muted,
              "middle",
              sizes.small,
            ),
          );
        }
      }
    }

    // Legend, in the band above the panel, where it covers no curve. The
    // strata past the rows it holds are counted in a "+N more" note.
    for (const e of layout.legend) {
      if (e.index < 0) {
        svg.appendChild(
          text(
            e.x,
            e.y,
            fit(`+${layout.legendMore} more`, e.width),
            theme.muted,
            "start",
            sizes.label,
          ),
        );
        continue;
      }
      const sw = document.createElementNS(SVG_NS, "rect");
      sw.setAttribute("x", String(e.x));
      sw.setAttribute("y", String(e.y - midline(sizes.label) - SWATCH / 2));
      sw.setAttribute("width", String(SWATCH));
      sw.setAttribute("height", String(SWATCH));
      sw.setAttribute("fill", cols[e.index] ?? theme.foreground);
      svg.appendChild(sw);
      svg.appendChild(
        text(
          e.x + SWATCH + SWATCH_GAP,
          e.y,
          fit(gl[e.index] ?? "", e.width - SWATCH - SWATCH_GAP),
          theme.foreground,
          "start",
          sizes.label,
        ),
      );
    }

    const pLabel = data.meta?.pLabel as string | undefined;

    // The log-rank result, bottom-left of the panel where the curves have
    // already fallen away, when the panel is tall enough to hold it.
    if (
      pLabel &&
      layout.axisY - 10 - Math.ceil(ASCENT * sizes.label) >= layout.top
    ) {
      svg.appendChild(
        text(
          layout.left + 10,
          layout.axisY - 10,
          fit(pLabel, width - layout.right - layout.left - 14),
          theme.foreground,
          "start",
          sizes.label,
        ),
      );
    }
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

  const instance: PlotomicsInstance<KmOptions> = {
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
        padSVG(out, width, height, plot.padding, theme.background),
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

  return instance;
};

// ---- small utilities ----
/** The values of a column at the given rows, as a plain array. */
function pick(col: ArrayLike<number>, rows: readonly number[]): number[] {
  return rows.map((r) => col[r] as number);
}
function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
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
function mergeOptions(base: KmOptions, next?: Partial<KmOptions>): KmOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
