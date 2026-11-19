/**
 * Profile — a grouped categorical bar profile with coloured header blocks.
 *
 * Built for the 96-context mutational signature plot, where the bars are the 96
 * trinucleotide contexts and the six header blocks are the substitution classes
 * (C>A, C>G, C>T, T>A, T>C, T>G). That layout is a fixed convention: anyone who
 * reads signature figures recognises the six-block banner and reads the shape
 * underneath it without a legend. It generalises to any ordered categorical
 * profile that groups into runs, which is why it is not called "sbs96".
 *
 * Bars, and the gridlines under them, are canvas-drawn; the header, axis and
 * labels are an SVG overlay. At 96 bars canvas is not strictly required, but
 * keeping the data layer on canvas means a caller can hand it a few thousand
 * bins (a copy-number profile, a binned coverage track) without the component
 * falling over.
 *
 * Groups must arrive as contiguous runs, which is what makes the header blocks
 * meaningful. The component does not sort: reordering the bars is the caller's
 * decision, and for SBS96 the canonical order is part of the convention.
 *
 * ## Data contract
 * - `columns.value`  `number[]`  bar height (required); a negative value
 *   draws down from the zero line, and a value that is not finite (null from
 *   R, NaN or Infinity from Python) draws no bar
 * - `columns.group`  `string[]`  group per bar; contiguous runs become blocks
 * - `columns.label`  `string[]`  per-bar tick label, e.g. the trinucleotide
 * - `meta.groups`       `string[]`  group order; defaults to order of appearance
 * - `meta.groupColors`  `string[]`  one colour per group
 * - `meta.title`        `string`    drawn above the header band
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
  zeroTicks,
  fitZeroTicks,
  formatTick,
  stepDecimals,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth as measureText,
  fitText,
  categoricalColors,
} from "../core/index.js";
import { setCanvasColour } from "../core/paint.js";
import { tickStep } from "d3-array";

export interface ProfileOptions {
  /** Fraction of each slot the bar occupies, in (0, 1]. */
  barWidth: number;
  /** Draw the coloured group blocks above the bars. */
  showHeader: boolean;
  /** Draw the per-bar tick labels under the axis. */
  showBarLabels: boolean;
  /**
   * Show each value as a share of the total, in place of the raw count.
   * Shares need values of 0 or more with a total above 0; otherwise the
   * raw values are drawn, on a plain number axis.
   */
  asFraction: boolean;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultProfileOptions: ProfileOptions = {
  barWidth: 0.62,
  showHeader: true,
  showBarLabels: true,
  asFraction: false,
  yLabel: "mutations",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Tallest the band of rotated bar labels may get, in multiples of their size. */
const MAX_BAR_LABEL_EM = 60 / 9;
/** Smallest height of the coloured group banner. */
const HEADER_H = 18;
/** Gap between the banner and the tallest bar. */
const HEADER_GAP = 6;
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
 * Where the text around the bars goes for the given text sizes, and the size
 * of the parts that hold text. Bar labels use the small size: there is one
 * under every bar.
 */
function profileText(s: TextSizes) {
  const titleBaseline = Math.ceil(ASCENT * s.title) + 1;
  return {
    /** x of the rotated y title, far enough right for its letters. */
    titleX: Math.ceil(1.1 * s.axisTitle),
    titleBaseline,
    /** Height of the title row; the descent reaches into the gap below. */
    titleH: titleBaseline + 1,
    /** Height of the coloured group banner, which holds the group names. */
    headerH: Math.max(HEADER_H, Math.ceil(s.label + 7)),
    /** Room above the plot for the top tick label when nothing is above. */
    plotPad: Math.max(10, Math.ceil((ASCENT - 0.35) * s.label) + 1),
    /** Tallest the band of rotated bar labels may get. */
    maxBarLabelH: Math.round(MAX_BAR_LABEL_EM * s.small),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/profile.test.ts)
// ---------------------------------------------------------------------------

export interface GroupRun {
  group: string;
  /** First bar index in the run. */
  start: number;
  /** Last bar index in the run, inclusive. */
  end: number;
}

/**
 * Collapse a per-bar group column into contiguous runs. A group that appears in
 * two separate stretches yields two runs rather than one spanning block, which
 * is the honest rendering: a banner spanning a gap would claim bars it does not
 * cover.
 */
export function groupRuns(groups: string[]): GroupRun[] {
  const out: GroupRun[] = [];
  if (!groups.length) return out;
  let start = 0;
  for (let i = 1; i <= groups.length; i += 1) {
    if (i === groups.length || groups[i] !== groups[start]) {
      out.push({ group: groups[start] as string, start, end: i - 1 });
      start = i;
    }
  }
  return out;
}

/** The largest finite value, or 0. */
export function finiteMax(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/** The smallest finite value, or 0 when none is below 0. */
export function finiteMin(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v) && v < m) m = v;
  }
  return m;
}

/**
 * The sum of the finite values. A value that is not finite (null from R, NaN
 * or Infinity from Python) draws no bar, so it adds nothing to the total.
 */
export function finiteTotal(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Whether the values have shares of their total: no finite value is below 0
 * and the finite values add up to more than 0. Shares of a total with mixed
 * signs, or of a total of 0, are not defined.
 */
export function sharesDefined(values: ArrayLike<number>): boolean {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < 0) return false;
    total += v;
  }
  return total > 0;
}

/**
 * The height of each bar: its value, or with `asFraction` its share of the
 * finite total, so the bars and the percent axis agree. Shares need what
 * {@link sharesDefined} checks; without it the bars keep their values, and
 * the axis labels them as plain numbers. A value that is not finite gives
 * NaN, which draws no bar.
 */
export function barHeights(
  values: ArrayLike<number>,
  asFraction: boolean,
): number[] {
  const total = finiteTotal(values);
  const denom = asFraction && sharesDefined(values) ? total : 1;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    out[i] = Number.isFinite(v) ? v / denom : Number.NaN;
  }
  return out;
}

/** The ticks of the value axis, from `bottom` to `top`. */
export interface ValueAxis {
  ticks: number[];
  /** The lowest tick: 0, or below 0 when a value is negative. */
  bottom: number;
  /** The highest tick: 0, or above 0 when a value is positive. */
  top: number;
  step: number;
}

/**
 * Round ticks for a value axis `lengthPx` long, from a round bottom at or
 * below both 0 and `min` to a round top at or above both 0 and `max`, so the
 * zero line is a tick and a negative bar stays inside the plot. It takes as
 * many intervals, up to `maxCount`, as leave at least `minGapPx` between
 * neighbouring labels; when even one interval crowds, the two ends, or the
 * end farther from 0 alone. With no value below 0 these are the ticks of
 * `fitZeroTicks`.
 */
export function valueTicks(
  min: number,
  max: number,
  lengthPx: number,
  opts: { maxCount?: number; minGapPx?: number } = {},
): ValueAxis {
  const lo = Number.isFinite(min) ? Math.min(0, min) : 0;
  if (!(lo < 0)) return { ...fitZeroTicks(max, lengthPx, opts), bottom: 0 };
  const hi = Number.isFinite(max) ? Math.max(0, max) : 0;
  const minGap = opts.minGapPx ?? 16;
  let axis = signedTicks(lo, hi, 1);
  for (let count = opts.maxCount ?? 5; count >= 1; count -= 1) {
    axis = signedTicks(lo, hi, count);
    if (lengthPx / Math.max(1, axis.ticks.length - 1) >= minGap) return axis;
  }
  // Even the coarsest step crowds: the two ends when they fit, else the
  // end farther from 0 alone, so no two labels come closer than the gap.
  const { bottom, top } = axis;
  const ticks =
    lengthPx >= minGap
      ? [bottom, top]
      : lengthPx > 0
        ? [Math.abs(bottom) > Math.abs(top) ? bottom : top]
        : [];
  return { ...axis, ticks };
}

/**
 * The multiples of a 1, 2 or 5 step from a round bottom at or below `lo`,
 * which is below 0, to a round top at or above `hi`, which is 0 or more.
 */
function signedTicks(lo: number, hi: number, count: number): ValueAxis {
  const step = tickStep(lo, hi, count);
  if (!(step > 0) || !Number.isFinite(step) || (hi - lo) / step > 1000) {
    // No round step fits: the ends and 0, each printed as it is.
    const ticks = hi > 0 ? [lo, 0, hi] : [lo, 0];
    return { ticks, bottom: lo, top: hi, step: 0 };
  }
  const below = Math.ceil(-lo / step - 1e-9);
  const above = Math.max(0, Math.ceil(hi / step - 1e-9));
  const d = stepDecimals(step);
  const ticks: number[] = [];
  for (let i = -below; i <= above; i += 1) {
    ticks.push(Number((i * step).toFixed(d)));
  }
  return {
    ticks,
    bottom: ticks[0] as number,
    top: ticks[ticks.length - 1] as number,
    step,
  };
}

export interface ProfileLayout {
  left: number;
  right: number;
  headerTop: number;
  plotTop: number;
  baseline: number;
  axisY: number;
  innerW: number;
  plotH: number;
  slot: number;
}

export function layoutProfile(
  width: number,
  height: number,
  nBars: number,
  opts: Pick<ProfileOptions, "showHeader" | "showBarLabels">,
  /** Whether a title is drawn; it gets its own row above the strip. */
  hasTitle = false,
  /** Width in px of the longest bar label, which runs down the bottom. */
  barLabelW = 24,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
  /** Width in px of the widest y tick label. */
  tickWidth = 0,
): ProfileLayout {
  const t = profileText(sizes);
  // The y tick labels sit between the rotated y title and the bars.
  const left = Math.max(
    56,
    Math.ceil(t.titleX + DESCENT * sizes.axisTitle + 3 + tickWidth + 8),
  );
  // Room right of the last bar; the theme padding gives the rest, 14 px
  // with the default.
  const right = 4;
  const titleH = hasTitle ? t.titleH : 0;
  const headerTop = titleH + (opts.showHeader ? 6 : 0);
  const plotTop = opts.showHeader
    ? headerTop + t.headerH + HEADER_GAP
    : titleH + t.plotPad;
  const labelH = opts.showBarLabels
    ? Math.min(t.maxBarLabelH, Math.ceil(barLabelW) + 10)
    : 10;
  const axisY = height - labelH - 14;
  return {
    left,
    right,
    headerTop,
    plotTop,
    baseline: axisY,
    axisY,
    innerW: Math.max(1, width - left - right),
    plotH: Math.max(1, axisY - plotTop),
    slot: Math.max(1, width - left - right) / Math.max(1, nBars),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createProfile: PlotomicsFactory<ProfileOptions> = (
  el,
  initial,
) => {
  let opts: ProfileOptions = mergeOptions(
    defaultProfileOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutProfile(0, 0, 1, opts);

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
  const values = () => (data.columns.value as ArrayLike<number>) ?? [];
  const groupCol = () => (data.columns.group as string[]) ?? [];
  const barLabels = () => (data.columns.label as string[]) ?? [];
  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    if (given && given.length) return given;
    const seen: string[] = [];
    for (const g of groupCol()) if (!seen.includes(g)) seen.push(g);
    return seen;
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, groups().length);
  }
  function textWidth(s: string, size: number): number {
    return measureText(s, size, theme.fontFamily);
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(s: string, maxW: number, size: number): string {
    return fitText(s, maxW, size, theme.fontFamily);
  }
  /** Width of the longest bar label at its font size, in px. */
  function longestBarLabel(): number {
    let w = 0;
    for (const lab of barLabels()) {
      w = Math.max(w, textWidth(lab ?? "", sizes.small));
    }
    return w;
  }
  // Whether the axis shows shares: asFraction, with shares defined for the
  // values. Set by each render.
  let percent = false;
  /** The label of the y tick at `val`. */
  function tickText(val: number, step: number): string {
    return formatTick(val, step, { percent });
  }
  function plotted(): number[] {
    return barHeights(values(), opts.asFraction);
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);
    const v = values();
    if (my < layout.plotTop || my > layout.baseline || mx < layout.left) {
      tooltip.hide();
      return;
    }
    const i = Math.floor((mx - layout.left) / layout.slot);
    if (i < 0 || i >= v.length) {
      tooltip.hide();
      return;
    }
    const lab = barLabels()[i] ?? String(i);
    const g = groupCol()[i] ?? "";
    // The share is of the finite total, as the bars and the axis use. With
    // a negative value, or a total of 0, shares are not defined.
    const value = v[i] as number;
    const share = sharesDefined(v)
      ? ` (${((100 * value) / finiteTotal(v)).toFixed(1)}%)`
      : "";
    const body = Number.isFinite(value)
      ? `${fmtInt(value)}${share}`
      : "no value";
    tooltip.show(
      `<b>${esc(lab)}</b> ${esc(g)}<br/>${body}`,
      lastPointer.x,
      lastPointer.y,
    );
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
    percent = opts.asFraction && sharesDefined(values());
    const v = plotted();
    const frame = (tickWidth: number) =>
      layoutProfile(
        width,
        height,
        v.length,
        opts,
        Boolean(data.meta?.title),
        longestBarLabel(),
        sizes,
        tickWidth,
      );
    // As many round ticks as the plot height holds without crowding, from
    // the lowest value or 0 to the highest or 0. The height does not depend
    // on the left gutter, so the gutter can then grow to fit the tick labels
    // without changing the ticks.
    layout = frame(0);
    const axis: ValueAxis = v.length
      ? valueTicks(finiteMin(v), finiteMax(v), layout.plotH, {
          minGapPx: sizes.label + 5,
        })
      : { ...zeroTicks(1, 4), bottom: 0 };
    let tickWidth = 0;
    for (const val of axis.ticks) {
      tickWidth = Math.max(
        tickWidth,
        textWidth(tickText(val, axis.step), sizes.label),
      );
    }
    layout = frame(tickWidth);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    // Gridlines first, so the bars are drawn over them. A grid colour that
    // paints nothing, such as "none", draws no line.
    if (setCanvasColour(ctx, "strokeStyle", theme.grid, el)) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const val of axis.ticks) {
        // On a half pixel, so the 1 px line fills one row of pixels.
        const y = Math.round(tickY(val, axis)) + 0.5;
        ctx.moveTo(layout.left, y);
        ctx.lineTo(width - layout.right, y);
      }
      ctx.stroke();
    }
    if (!v.length) {
      renderOverlay(axis);
      return;
    }

    const gcol = groupCol();
    const glist = groups();
    const gcols = groupColors();
    const bw = Math.max(1, layout.slot * opts.barWidth);

    // Bars, up from the zero line, or down from it for a negative value.
    const zero = tickY(0, axis);
    for (let i = 0; i < v.length; i += 1) {
      const y = tickY(v[i] as number, axis);
      if (!Number.isFinite(y)) continue;
      // A missing group (null) is a group of its own, as in R's unique(), so
      // its bars take the colour of its block in the banner.
      const gi = glist.indexOf(gcol[i] as string);
      ctx.fillStyle = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
      const x = layout.left + i * layout.slot + (layout.slot - bw) / 2;
      ctx.fillRect(x, Math.min(y, zero), bw, Math.abs(zero - y));
    }

    // Group banner.
    if (opts.showHeader) {
      for (const run of groupRuns(gcol)) {
        const gi = glist.indexOf(run.group);
        ctx.fillStyle = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
        const x0 = layout.left + run.start * layout.slot;
        const x1 = layout.left + (run.end + 1) * layout.slot;
        ctx.fillRect(
          x0,
          layout.headerTop,
          Math.max(1, x1 - x0 - 2),
          profileText(sizes).headerH,
        );
      }
    }

    renderOverlay(axis);
  }

  /** y of the value `val` on the value axis. */
  function tickY(val: number, axis: { bottom: number; top: number }): number {
    const span = axis.top - axis.bottom || 1;
    return layout.baseline - ((val - axis.bottom) / span) * layout.plotH;
  }

  function renderOverlay(axis: ValueAxis) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const gcol = groupCol();
    const glist = groups();
    const gcols = groupColors();
    const tx = profileText(sizes);

    // y tick labels, on round steps, each stating its value; the gridlines
    // are on the canvas, under the bars.
    for (const val of axis.ticks) {
      const y = tickY(val, axis);
      svg.appendChild(
        text(
          layout.left - 8,
          y + midline(sizes.label),
          tickText(val, axis.step),
          theme.muted,
          "end",
          sizes.label,
        ),
      );
    }
    // The y title is centred on the bars and may reach the element's edges.
    const yTitleCy = layout.plotTop + layout.plotH / 2;
    svg.appendChild(
      rotatedText(
        tx.titleX,
        yTitleCy,
        fit(
          opts.yLabel,
          2 * Math.min(yTitleCy - 2, height - 2 - yTitleCy),
          sizes.axisTitle,
        ),
        theme.muted,
        sizes.axisTitle,
      ),
    );

    // Group names on the banner, in a colour that reads on the block.
    if (opts.showHeader) {
      for (const run of groupRuns(gcol)) {
        const x0 = layout.left + run.start * layout.slot;
        const x1 = layout.left + (run.end + 1) * layout.slot;
        const gi = glist.indexOf(run.group);
        const bg = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
        if (
          run.group != null &&
          x1 - x0 > textWidth(run.group, sizes.label) + 8
        ) {
          svg.appendChild(
            text(
              (x0 + x1) / 2,
              layout.headerTop + tx.headerH / 2 + midline(sizes.label),
              run.group,
              readableOn(bg),
              "middle",
              sizes.label,
            ),
          );
        }
      }
    }

    // Per-bar labels, rotated, thinned when they would collide.
    if (opts.showBarLabels) {
      const labs = barLabels();
      const every = Math.max(1, Math.ceil((sizes.small + 1) / layout.slot));
      // A label longer than the band under the axis is cut to fit.
      const room = Math.max(8, height - layout.axisY - 8);
      for (let i = 0; i < labs.length; i += every) {
        const x = layout.left + i * layout.slot + layout.slot / 2;
        const t = text(
          x,
          layout.axisY + 6,
          fit(labs[i] ?? "", room, sizes.small),
          theme.muted,
          "end",
          sizes.small,
        );
        t.setAttribute("transform", `rotate(-90 ${x} ${layout.axisY + 6})`);
        svg.appendChild(t);
      }
    }

    const title = data.meta?.title as string | undefined;
    if (title) {
      // In its own row above the strip, with room for capitals and descenders.
      svg.appendChild(
        text(
          layout.left,
          tx.titleBaseline,
          fit(title, width - layout.left - layout.right, sizes.title),
          theme.foreground,
          "start",
          sizes.title,
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
  function doResize(w: number, h: number) {
    fitBox(w, h);
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    doResize(m.width, m.height);
  }

  const instance: PlotomicsInstance<ProfileOptions> = {
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
/** Black or white, whichever reads better on the given background. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#FFFFFF";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Rec. 601 luma; the SBS palette spans near-black to pale pink, so a fixed
  // colour would be unreadable on one end or the other.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#233038" : "#FFFFFF";
}
function fmtInt(v: number): string {
  // -0, from a tiny negative value that float32 rounds, reads 0.
  if (v === 0) return "0";
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
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
  base: ProfileOptions,
  next?: Partial<ProfileOptions>,
): ProfileOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
