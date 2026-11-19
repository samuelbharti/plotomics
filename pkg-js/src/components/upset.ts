/**
 * Upset — set intersections as a bar chart over a membership matrix.
 *
 * Venn diagrams stop being readable at four sets and stop being drawable at
 * five. UpSet replaces the areas with an explicit matrix: one column per
 * intersection, a filled dot in every set that intersection belongs to, and a
 * bar above giving its size. That scales to dozens of sets and stays exact.
 *
 * Intersections here are **exclusive**: a column counts the elements in
 * precisely that combination of sets and no others. That is what makes the
 * columns sum to the union rather than double-counting, and it is why an
 * apparently small "A + B" bar next to large "A" and "B" bars is evidence of
 * mutual exclusivity rather than an artefact.
 *
 * Bars, dots and the gridlines under them are canvas-drawn; labels and axes
 * are an SVG overlay.
 *
 * The component draws the columns in the order given. Which intersections are
 * worth showing, and in what order, is an analysis decision.
 *
 * ## Data contract
 * - `columns.size`  `number[]`  size of each intersection (required)
 * - `meta.sets`        `string[]`  set names, top to bottom (required)
 * - `meta.setSizes`    `number[]`  total size of each set, for the left bars
 * - `meta.membership`  `number[]`  intersections x sets, row-major, 1 = member
 * - `meta.total`       `number`    universe size, shown in the corner
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
  formatTicks,
  tickUnit,
  stepDecimals,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth as measureText,
  fitText,
} from "../core/index.js";
import { setCanvasColour } from "../core/paint.js";

export interface UpsetOptions {
  /** Fraction of the height given to the intersection bars, in (0, 1). */
  barFraction: number;
  /** Draw the per-set total bars on the left. */
  showSetSizes: boolean;
  /** Radius of a matrix dot in pixels. */
  dotRadius: number;
  /** Fill for the intersection bars and the filled dots. */
  barColor: string | null;
  /** Fill for dots not in the intersection. */
  emptyDotColor: string | null;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultUpsetOptions: UpsetOptions = {
  barFraction: 0.55,
  showSetSizes: true,
  dotRadius: 5,
  barColor: null,
  emptyDotColor: null,
  yLabel: "intersection size",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** The set-name column grows to this many px, or this share of the width. */
const NAME_MAX_PX = 200;
const NAME_MAX_SHARE = 0.3;
/**
 * Room a line of text takes above its baseline, as a share of its size. This
 * covers the font box of the common system fonts.
 */
const ASCENT = 1.08;
/** Text sizes of the default theme, for a layout computed without a theme. */
const DEFAULT_SIZES = textSizes(defaultTheme);

/** How far below a line a text's baseline goes to centre the text on it. */
function midline(size: number): number {
  return size * 0.35;
}

/** x of the rotated y title, far enough right for its letters. */
function titleX(s: TextSizes): number {
  return Math.ceil(1.1 * s.axisTitle);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/upset.test.ts)
// ---------------------------------------------------------------------------

export interface UpsetLayout {
  /** Left edge of the matrix and the bar panel. */
  left: number;
  top: number;
  /** Baseline of the intersection bars, and the top of the matrix. */
  barBaseline: number;
  barH: number;
  /** Height of one matrix row. */
  rowH: number;
  /**
   * Font size of the set names and the set-size counts: the label size, or
   * less when the rows are too short for it.
   */
  rowText: number;
  /** Width of one intersection column. */
  colW: number;
  matrixH: number;
  /** Width of the left-hand set-size panel. */
  setPanelW: number;
  /** Width of the set-name column. */
  nameW: number;
}

/**
 * Room right of the matrix and under it, past what the plot draws. The
 * theme padding around the plot gives the rest: 12 and 16 px with the
 * default.
 */
const RIGHT = 2;
const BOTTOM = 6;

/**
 * Frame the three panels. The left gutter holds set names and, when shown,
 * their total bars; the matrix gets whatever height the bars do not take.
 */
export function layoutUpset(
  width: number,
  height: number,
  nSets: number,
  nIntersections: number,
  opts: Pick<UpsetOptions, "barFraction" | "showSetSizes">,
  /** Width in px of the longest set name, at the label size. */
  nameWidth = 48,
  /** Width in px of the widest set-size count, at the label size. */
  countWidth = 24,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
): UpsetLayout {
  // Room above the bars for the total, drawn 2 px under the top.
  const top = Math.max(14, Math.ceil(ASCENT * sizes.label) + 2);
  const bottom = BOTTOM;
  const avail = Math.max(1, height - top - bottom);
  // Clamp the split so neither panel can vanish at extreme aspect ratios.
  const frac = Math.min(0.8, Math.max(0.2, opts.barFraction));
  const barH = avail * frac;
  const matrixH = avail - barH;
  const rowH = nSets > 0 ? matrixH / nSets : matrixH;
  // Every set keeps its name: in rows shorter than the label size, the
  // names and counts shrink to nine tenths of the row.
  const rowText = Math.min(sizes.label, Math.floor(9 * rowH) / 10);
  const shrink = rowText / sizes.label;
  // The set-size panel also holds its "set size" title, about 3.6 em wide.
  const setPanelW = opts.showSetSizes
    ? Math.max(74, Math.ceil(3.6 * sizes.axisTitle))
    : 0;
  // The counts sit just right of the set-size bars, then the names; the
  // name column grows with the longest name up to a share of the width, and
  // longer names are shortened when drawn.
  const countW = opts.showSetSizes ? Math.ceil(countWidth * shrink) + 8 : 0;
  const cap = Math.min(NAME_MAX_PX, Math.max(44, width * NAME_MAX_SHARE));
  const nameW = Math.min(cap, Math.max(44, Math.ceil(nameWidth * shrink) + 10));
  const left = setPanelW + countW + nameW + 12;
  return {
    left,
    top,
    barBaseline: top + barH,
    barH,
    rowH,
    rowText,
    colW:
      nIntersections > 0
        ? Math.max(1, (width - left - RIGHT) / nIntersections)
        : 1,
    matrixH,
    setPanelW,
    nameW,
  };
}

/** The largest finite value, or 0. */
export function finiteMax(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/**
 * Read one intersection's membership row out of the flattened matrix.
 * Returns all-false when the matrix is missing or the row is out of range,
 * so a malformed feed draws an empty column rather than throwing.
 */
export function membershipRow(
  membership: ArrayLike<number> | undefined,
  index: number,
  nSets: number,
): boolean[] {
  const out = new Array<boolean>(nSets).fill(false);
  if (!membership || nSets <= 0 || index < 0) return out;
  const base = index * nSets;
  if (base + nSets > membership.length) return out;
  for (let s = 0; s < nSets; s += 1)
    out[s] = (membership[base + s] as number) === 1;
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createUpset: PlotomicsFactory<UpsetOptions> = (el, initial) => {
  let opts: UpsetOptions = mergeOptions(defaultUpsetOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let fontSizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutUpset(0, 0, 0, 0, opts);

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
  const sizes = () => (data.columns.size as ArrayLike<number>) ?? [];
  const sets = () => (data.meta?.sets as string[]) ?? [];
  const setSizes = () => data.meta?.setSizes as ArrayLike<number> | undefined;
  const membership = () =>
    data.meta?.membership as ArrayLike<number> | undefined;
  const barFill = () => opts.barColor ?? theme.foreground;
  const emptyFill = () => opts.emptyDotColor ?? theme.grid;

  function textWidth(s: string, size: number): number {
    return measureText(s, size, theme.fontFamily);
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(s: string, maxW: number, size: number): string {
    return fitText(s, maxW, size, theme.fontFamily);
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);
    const s = sizes();
    // Left of the matrix, on a set's row: the full name and its size, since
    // a long name is shortened on the plot.
    const names = sets();
    const k = Math.floor((my - layout.barBaseline) / layout.rowH);
    if (mx < layout.left && k >= 0 && k < names.length) {
      const ss = setSizes();
      const n = ss?.[k];
      const size =
        typeof n === "number" && Number.isFinite(n)
          ? ` (${n.toLocaleString()})`
          : "";
      // A missing set name (null) reads "NA", as in the other tooltips.
      tooltip.show(
        `<b>${esc(names[k] ?? "NA")}</b>${size}`,
        lastPointer.x,
        lastPointer.y,
      );
      return;
    }
    const i = Math.floor((mx - layout.left) / layout.colW);
    if (mx < layout.left || i < 0 || i >= s.length) {
      tooltip.hide();
      return;
    }
    const inSet = membershipRow(membership(), i, names.length)
      .map((v, k) => (v ? (names[k] ?? "NA") : null))
      .filter((name): name is string => name !== null);
    const total = data.meta?.total as number | undefined;
    // R sends a missing size as null and Python as NaN; it reads "NA".
    const n = s[i] as number | null;
    const known = typeof n === "number" && Number.isFinite(n);
    const pct = total && known ? ` (${((100 * n) / total).toFixed(1)}%)` : "";
    tooltip.show(
      `<b>${known ? n.toLocaleString() : "NA"}</b>${pct}<br/>` +
        `${inSet.length ? esc(inSet.join(" + ")) : "none"}`,
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
    const s = sizes();
    const names = sets();
    const nameWidth = names.reduce(
      (m, n) => Math.max(m, textWidth(n, fontSizes.label)),
      0,
    );
    const frame = (countWidth: number) =>
      layoutUpset(
        width,
        height,
        names.length,
        s.length,
        opts,
        nameWidth,
        countWidth,
        fontSizes,
      );
    // The bar height does not depend on the width of the set sizes, so the
    // axis comes first and the set sizes can print in its unit.
    layout = frame(0);

    ctx.clearRect(0, 0, width, height);
    if (setCanvasColour(ctx, "fillStyle", theme.background, el)) {
      ctx.fillRect(0, 0, width, height);
    }
    const empty = !s.length || !names.length;
    // Whole-number ticks, as many as the bar panel holds without crowding.
    const axis = empty
      ? zeroTicks(1, 4)
      : fitZeroTicks(finiteMax(s), layout.barH - 6, {
          integer: true,
          minGapPx: fontSizes.label + 5,
          endGapPx: fontSizes.label + 2,
        });
    const ssAll = setSizes();
    let countWidth = 0;
    if (ssAll) {
      for (const label of setSizeLabels(ssAll, axis)) {
        countWidth = Math.max(countWidth, textWidth(label, fontSizes.label));
      }
    }
    layout = frame(countWidth);

    // Gridlines first, so the bars are drawn over them. A grid colour that
    // paints nothing, such as "none", draws no line.
    if (setCanvasColour(ctx, "strokeStyle", theme.grid, el)) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of axis.ticks) {
        // On a half pixel, so the 1 px line fills one row of pixels.
        const y = Math.round(tickY(v, axis.top)) + 0.5;
        ctx.moveTo(layout.left, y);
        ctx.lineTo(width - RIGHT, y);
      }
      ctx.stroke();
    }
    if (empty) {
      renderOverlay(axis);
      return;
    }

    const max = axis.top;
    const bw = Math.max(1, layout.colW * 0.68);
    const mem = membership();

    // Intersection bars.
    ctx.fillStyle = barFill();
    for (let i = 0; i < s.length; i += 1) {
      const h = ((s[i] as number) / max) * (layout.barH - 6);
      const x = layout.left + i * layout.colW + (layout.colW - bw) / 2;
      ctx.fillRect(x, layout.barBaseline - h, bw, h);
    }

    // Membership matrix: alternating row bands, then the dots and the spine
    // connecting the filled ones. A grid colour that paints nothing leaves
    // the bands out.
    if (setCanvasColour(ctx, "fillStyle", theme.grid, el)) {
      ctx.globalAlpha = 0.25;
      for (let r = 0; r < names.length; r += 2) {
        ctx.fillRect(
          layout.left,
          layout.barBaseline + r * layout.rowH,
          width - layout.left - RIGHT,
          layout.rowH,
        );
      }
      ctx.globalAlpha = 1;
    }
    const r = Math.min(
      opts.dotRadius,
      layout.colW / 2 - 1,
      layout.rowH / 2 - 1,
    );
    // The colour of the empty dots, read once; null when it paints nothing,
    // so an empty dot is left out and never takes the colour of a filled one.
    const emptyColour = setCanvasColour(ctx, "fillStyle", emptyFill(), el)
      ? ctx.fillStyle
      : null;
    for (let i = 0; i < s.length; i += 1) {
      const cx = layout.left + (i + 0.5) * layout.colW;
      const row = membershipRow(mem, i, names.length);
      let first = -1;
      let last = -1;
      for (let k = 0; k < names.length; k += 1) {
        if (!row[k]) continue;
        if (first < 0) first = k;
        last = k;
      }
      if (first >= 0 && last > first) {
        ctx.strokeStyle = barFill();
        ctx.lineWidth = Math.max(1.5, r * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx, layout.barBaseline + (first + 0.5) * layout.rowH);
        ctx.lineTo(cx, layout.barBaseline + (last + 0.5) * layout.rowH);
        ctx.stroke();
      }
      for (let k = 0; k < names.length; k += 1) {
        if (row[k]) ctx.fillStyle = barFill();
        else if (emptyColour !== null) ctx.fillStyle = emptyColour;
        else continue;
        ctx.beginPath();
        ctx.arc(
          cx,
          layout.barBaseline + (k + 0.5) * layout.rowH,
          Math.max(1, r),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Set totals, drawn leftwards from the matrix so they read against it.
    const ss = setSizes();
    if (opts.showSetSizes && ss) {
      const smax = zeroTicks(finiteMax(ss), 4, { integer: true }).top;
      ctx.fillStyle = barFill();
      ctx.globalAlpha = 0.55;
      for (let k = 0; k < names.length; k += 1) {
        const w = ((ss[k] as number) / smax) * (layout.setPanelW - 10);
        const y = layout.barBaseline + k * layout.rowH + layout.rowH * 0.2;
        ctx.fillRect(layout.setPanelW - w, y, w, layout.rowH * 0.6);
      }
      ctx.globalAlpha = 1;
    }

    renderOverlay(axis);
  }

  /** y of the bar axis tick at `v`, on an axis that ends at `top`. */
  function tickY(v: number, top: number): number {
    return layout.barBaseline - (v / top) * (layout.barH - 6);
  }

  function renderOverlay(axis: { ticks: number[]; top: number; step: number }) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const names = sets();

    // Bar axis labels, on round steps, each stating its value; the
    // gridlines are on the canvas, under the bars. The zero label sits on
    // the baseline, which is also the top of the first matrix row. Letters
    // reach 0.8 em above a baseline and 0.2 em below it, so when that row is
    // too short to keep the first set name clear of the zero, the zero is
    // left out: the bars start there anyway.
    const label = fontSizes.label;
    const rowText = layout.rowText;
    const zeroClear =
      names.length === 0 ||
      layout.rowH / 2 + midline(rowText) - 0.8 * rowText >=
        midline(label) + 0.2 * label + 1;
    const tickLabels = formatTicks(axis.ticks, axis.step);
    axis.ticks.forEach((v, i) => {
      const y = tickY(v, axis.top);
      if (v === 0 && !zeroClear) return;
      svg.appendChild(
        text(
          layout.left - 6,
          y + midline(fontSizes.label),
          tickLabels[i] ?? "",
          theme.muted,
          "end",
          fontSizes.label,
        ),
      );
    });
    // The y title runs up beside the bars. It stays above the "set size"
    // title, which sits in the same corner: centred on the bars when it
    // fits there, moved up when it does not, and shortened when the panel is
    // too short for it.
    const ss = setSizes();
    const showCounts = opts.showSetSizes && Boolean(ss);
    const lowest = showCounts
      ? layout.barBaseline - 6 - Math.ceil(ASCENT * fontSizes.axisTitle) - 2
      : layout.barBaseline;
    const yTitle = fit(opts.yLabel, lowest - 2, fontSizes.axisTitle);
    const half = textWidth(yTitle, fontSizes.axisTitle) / 2;
    svg.appendChild(
      rotatedText(
        titleX(fontSizes),
        Math.max(
          2 + half,
          Math.min(layout.top + layout.barH / 2, lowest - half),
        ),
        yTitle,
        theme.muted,
        fontSizes.axisTitle,
      ),
    );

    // Set names, between the counts and the matrix, shortened to fit.
    const nameRoom = Math.max(12, layout.nameW - 4);
    const rowMid = midline(layout.rowText);
    for (let k = 0; k < names.length; k += 1) {
      svg.appendChild(
        text(
          layout.left - 10,
          layout.barBaseline + (k + 0.5) * layout.rowH + rowMid,
          fit(names[k] ?? "", nameRoom, layout.rowText),
          theme.foreground,
          "end",
          layout.rowText,
        ),
      );
    }

    if (showCounts && ss) {
      svg.appendChild(
        text(
          0,
          layout.barBaseline - 6,
          "set size",
          theme.muted,
          "start",
          fontSizes.axisTitle,
        ),
      );
      const sizeLabels = setSizeLabels(ss, axis);
      for (let k = 0; k < names.length; k += 1) {
        svg.appendChild(
          text(
            layout.setPanelW + 3,
            layout.barBaseline + (k + 0.5) * layout.rowH + rowMid,
            sizeLabels[k] ?? "",
            theme.muted,
            "start",
            layout.rowText,
          ),
        );
      }
    }

    const total = data.meta?.total as number | undefined;
    if (total) {
      svg.appendChild(
        text(
          width - RIGHT,
          layout.top + 2,
          `${total.toLocaleString()} total`,
          theme.muted,
          "end",
          fontSizes.label,
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

  const instance: PlotomicsInstance<UpsetOptions> = {
    setData(next) {
      data = next;
      render();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      fontSizes = textSizes(theme);
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

  return instance;
};

// ---- small utilities ----
/**
 * The largest power of ten, from 1e15 down to 1e-6, that every finite value
 * is a whole multiple of: 1e4 for 2400000 and 1950000, 0.1 for 2.5. 0 when
 * none is, which prints each value to six significant digits.
 */
function exactStep(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v) && v !== 0);
  if (!finite.length) return 1;
  const divides = (s: number) =>
    finite.every((v) => {
      const q = v / s;
      const r = Math.round(q);
      return r !== 0 && Math.abs(q - r) <= 1e-9 * Math.max(1, Math.abs(q));
    });
  for (let k = 15; k >= -6; k -= 1) {
    if (divides(10 ** k)) return 10 ** k;
  }
  return 0;
}

/**
 * The set size labels, printed as the intersection axis prints its ticks
 * (see formatTicks), so one figure never shows a number two ways: in the
 * unit of `axis` when that keeps every size exact with at most three
 * decimals, else in the unit the largest size needs. Each label is exact,
 * fractions included, on the largest power of ten that every size is a
 * multiple of. A missing size reads "NA".
 */
function setSizeLabels(
  sizes: ArrayLike<number>,
  axis: { ticks: number[]; step: number },
): string[] {
  const values = Array.from(sizes, (v) => (typeof v === "number" ? v : NaN));
  const step = exactStep(values);
  let maxAbs = 0;
  for (const v of axis.ticks) maxAbs = Math.max(maxAbs, Math.abs(v));
  const unit = tickUnit(maxAbs, axis.step);
  const scale = unit === "M" ? 1e6 : unit === "k" ? 1e3 : 1;
  if (step > 0 && stepDecimals(step / scale) <= 3) {
    return values.map((v) => formatTick(v, step, { unit }));
  }
  return formatTicks(values, step);
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
  base: UpsetOptions,
  next?: Partial<UpsetOptions>,
): UpsetOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
