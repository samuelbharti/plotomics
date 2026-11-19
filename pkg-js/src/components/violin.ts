/**
 * Violin — stacked violins: one row per feature, one violin per group.
 *
 * A box plot hides bimodality, which in single-cell data is usually the whole
 * story: a gene expressed in half a cluster and silent in the other half has
 * the same median as one expressed weakly everywhere. The violin shows the
 * shape, and stacking rows on a shared x lets you read a marker panel down the
 * page the way a dot plot is read across it.
 *
 * The component draws densities, it does not estimate them. Each violin arrives
 * as a vector of density values on a shared grid, because kernel bandwidth
 * choice changes what the figure claims and belongs with the data, not in the
 * renderer. It also keeps the payload proportional to the grid rather than to
 * the number of cells.
 *
 * Violins are canvas-drawn; labels and axes are an SVG overlay.
 *
 * ## Data contract
 * - `columns.feature`  `string[]`  row key per violin (required)
 * - `columns.group`    `string[]`  column key per violin (required)
 * - `meta.grid`      `number[]`  shared evaluation grid, ascending (required)
 * - `meta.grids`     `number[]`  optional per-feature grids, features x grid,
 *                                row-major. Present means each row gets its own
 *                                y range, which is what a marker panel usually
 *                                wants: one highly expressed gene otherwise
 *                                compresses every other row into a line.
 * - `meta.density`   `number[]`  violins x grid, row-major (required)
 * - `meta.features`  `string[]`  row order; defaults to order of appearance
 * - `meta.groups`    `string[]`  column order; defaults to order of appearance
 * - `meta.groupColors` `string[]`  one colour per group
 * - `meta.median`    `number[]`  per-violin median, drawn as a tick
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type TextSizes,
  resolveTheme,
  defaultTheme,
  textSizes,
  textWidth,
  createTooltip,
  createPlotBox,
  type Tooltip,
  measure,
  releaseContainer,
  dpr,
  serializeSVG,
  padSVG,
  compositePNG,
  categoricalColors,
} from "../core/index.js";
import { plainColour, setCanvasColour } from "../core/paint.js";

export interface ViolinOptions {
  /** Fraction of a cell's width the widest violin fills, in (0, 1].
   * When rows are short next to the column width (many features, or a
   * short or wide widget), `violinAspect` can make it fill less. */
  violinWidth: number;
  /** The largest width of the widest violin, as a multiple of its row
   * height. A violin much wider than its row is tall reads as a flat
   * band. The cap never makes a violin narrower than four times the
   * label text size (44 px at the default font size), so with many
   * features the violins stay visible; nor wider than `violinWidth`
   * of its cell. `null` or `Infinity` turns the cap off, and any value
   * other than a positive number gives the default, 0.8. */
  violinAspect: number | null;
  /** Scale each violin to its own maximum rather than the row's. Per-row is
   * the honest default: within a gene, groups stay comparable. */
  scalePerViolin: boolean;
  /** Draw the median tick. */
  showMedian: boolean;
  /** Draw the per-row feature labels. */
  showFeatureLabels: boolean;
  /** Draw each row's value axis, with its lowest and highest grid value. */
  showValueAxis: boolean;
  theme: Partial<PlotomicsTheme>;
}

/**
 * The default `violinAspect`. scanpy sizes its stacked violin figure
 * from fixed cells. There the widest violin comes out about 0.7 to
 * 0.95 times as wide as its row is tall, depending on the numbers of
 * genes and groups, and 0.8 for 6 genes by 5 groups.
 */
const DEFAULT_ASPECT = 0.8;

export const defaultViolinOptions: ViolinOptions = {
  violinWidth: 0.85,
  violinAspect: DEFAULT_ASPECT,
  scalePerViolin: false,
  showMedian: true,
  showFeatureLabels: true,
  showValueAxis: true,
  theme: {},
};

/** Right gutter that holds the value axis and its labels, at the least. */
const VALUE_AXIS_W = 44;
/** Bounds of the left gutter; the upper one is for the default text size. */
const MIN_LEFT = 50;
const MAX_LEFT = 150;
/** The largest share of the widget's width or height that a gutter takes. */
const MAX_GUTTER_SHARE = 0.35;
/**
 * The `violinAspect` cap never makes the widest violin narrower than
 * this many times the label text size. scanpy keeps its ratio by
 * making the figure taller; a widget has a fixed height, so without a
 * floor many features would shrink the violins to specks. The floor
 * is in px, not a share of the column, so a wider widget does not
 * widen it past the cap.
 */
const MIN_WIDTH_IN_LABELS = 4;
const DEFAULT_SIZES = textSizes(defaultTheme);

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/violin.test.ts)
// ---------------------------------------------------------------------------

export interface ViolinLayout {
  left: number;
  top: number;
  cellW: number;
  rowH: number;
  plotW: number;
  plotH: number;
  bottom: number;
}

/** Widths in px of the text that sets the gutters of {@link layoutViolin}. */
export interface ViolinText {
  /** Text sizes of the plot; the default theme's when absent. */
  sizes?: TextSizes;
  /** The longest feature label. */
  rowLabel?: number;
  /** The longest group label. */
  colLabel?: number;
  /** The widest value axis label. */
  valueLabel?: number;
}

/**
 * Frame the grid of violins. The left gutter takes the longest feature
 * name, the bottom gutter the longest group name turned 45 degrees and the
 * right gutter the value axis labels, all measured at the theme's text
 * size. A gutter takes at most a share of the widget; the plot cuts a
 * longer label to fit.
 */
export function layoutViolin(
  width: number,
  height: number,
  nFeatures: number,
  nGroups: number,
  opts: Pick<ViolinOptions, "showFeatureLabels"> &
    Partial<Pick<ViolinOptions, "showValueAxis">>,
  text: ViolinText = {},
): ViolinLayout {
  const size = (text.sizes ?? DEFAULT_SIZES).label;
  // Eight characters of a label, for a width that was not measured.
  const guess = 8 * 0.58 * size;
  const maxLeft = Math.min(
    (MAX_LEFT * size) / DEFAULT_SIZES.label,
    Math.floor(width * MAX_GUTTER_SHARE),
  );
  // Value labels start 9 px right of the grid and keep 4 px from the edge.
  const right = opts.showValueAxis
    ? Math.max(VALUE_AXIS_W, Math.ceil((text.valueLabel ?? 0) + 13))
    : 14;
  // Room above the first row for the top of its label when rows are tight.
  const top = Math.max(10, Math.ceil(0.8 * size));
  const colLabel = text.colLabel ?? guess;
  const bottom = Math.min(
    Math.ceil((colLabel + 0.3 * size) * Math.SQRT1_2) + 12,
    Math.floor(height * MAX_GUTTER_SHARE),
  );
  let left = opts.showFeatureLabels
    ? Math.min(
        Math.max(MIN_LEFT, (text.rowLabel ?? guess) + 12),
        Math.max(MIN_LEFT, maxLeft),
      )
    : 16;
  // The first group label runs down and to the left of its column; widen
  // the gutter until that label stays inside the widget.
  if (nGroups > 0) {
    const reach =
      (Math.min(colLabel, colLabelRoom(bottom, size)) + 1.1 * size) *
        Math.SQRT1_2 +
      2;
    const half = 1 / (2 * nGroups);
    left = Math.max(left, (reach - (width - right) * half) / (1 - half));
  }
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  return {
    left,
    top,
    cellW: nGroups > 0 ? plotW / nGroups : plotW,
    rowH: nFeatures > 0 ? plotH / nFeatures : plotH,
    plotW,
    plotH,
    bottom,
  };
}

/**
 * Length in px a group label may take, turned 45 degrees under the grid in
 * a gutter `bottom` px tall, at `size` px.
 */
function colLabelRoom(bottom: number, size: number): number {
  return Math.max(0, (bottom - 12) * Math.SQRT2 - 0.3 * size);
}

/**
 * The cap a `violinAspect` option sets: a positive finite number as it
 * is, `null` for no cap when the option is `null` or `Infinity`, and
 * the default 0.8 for any other value.
 */
export function resolveViolinAspect(value: unknown): number | null {
  if (value === null || value === Number.POSITIVE_INFINITY) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_ASPECT;
}

/**
 * Width in px of the widest violin in a row: `violinWidth` of its cell,
 * capped at `violinAspect` times the row height, but never under four
 * times `labelSize`, unless the cell is narrower than that. Every
 * violin in the plot is drawn against this one width, so the widths
 * in a row stay comparable.
 */
export function violinMaxWidth(
  layout: Pick<ViolinLayout, "cellW" | "rowH">,
  violinWidth: number,
  violinAspect: unknown,
  labelSize: number = DEFAULT_SIZES.label,
): number {
  const full = layout.cellW * violinWidth;
  const aspect = resolveViolinAspect(violinAspect);
  if (aspect === null) return full;
  const floor = MIN_WIDTH_IN_LABELS * labelSize;
  return Math.min(full, Math.max(layout.rowH * aspect, floor));
}

/**
 * Read one violin's density row out of the flattened matrix.
 * Returns zeros for a missing or out-of-range row, so a malformed feed draws
 * a flat line rather than throwing.
 */
export function densityRow(
  density: ArrayLike<number> | undefined,
  index: number,
  gridLen: number,
): number[] {
  const out = new Array<number>(gridLen).fill(0);
  if (!density || gridLen <= 0 || index < 0) return out;
  const base = index * gridLen;
  if (base + gridLen > density.length) return out;
  for (let i = 0; i < gridLen; i += 1) out[i] = density[base + i] as number;
  return out;
}

/**
 * The grid for one feature row. With `grids` supplied, each row gets its own
 * slice; otherwise every row shares `grid`. Falls back to the shared grid when
 * the slice would run past the end, so a short `grids` cannot blank a row.
 */
export function gridForRow(
  grid: ArrayLike<number>,
  grids: ArrayLike<number> | undefined,
  row: number,
): number[] {
  const n = grid.length;
  const shared = Array.from({ length: n }, (_, i) => grid[i] as number);
  if (!grids || n === 0 || row < 0) return shared;
  const base = row * n;
  if (base + n > grids.length) return shared;
  return Array.from({ length: n }, (_, i) => grids[base + i] as number);
}

/**
 * Largest density in a set of rows, used to put every violin in a row on one
 * scale. Returns 1 for empty or degenerate input so nothing divides by zero.
 */
export function maxDensity(rows: readonly number[][]): number {
  let max = 0;
  for (const row of rows) {
    for (const v of row) if (isFinite(v) && v > max) max = v;
  }
  return max > 0 ? max : 1;
}

/**
 * Build one violin outline as a closed polygon in unit space: x in
 * `[-1, 1]` (density, mirrored) and y the grid value. The caller scales it.
 */
export function violinPolygon(
  grid: ArrayLike<number>,
  density: readonly number[],
  max: number,
): { x: number; y: number }[] {
  const n = Math.min(grid.length, density.length);
  if (n === 0 || max <= 0) return [];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({ x: (density[i] as number) / max, y: grid[i] as number });
  }
  // Mirror back down the other side to close the shape.
  for (let i = n - 1; i >= 0; i -= 1) {
    pts.push({ x: -((density[i] as number) / max), y: grid[i] as number });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createViolin: PlotomicsFactory<ViolinOptions> = (el, initial) => {
  let opts: ViolinOptions = mergeOptions(defaultViolinOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutViolin(0, 0, 0, 0, opts, { sizes });

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
  const featureCol = () => (data.columns.feature as string[]) ?? [];
  const groupCol = () => (data.columns.group as string[]) ?? [];
  const grid = () => (data.meta?.grid as ArrayLike<number>) ?? [];
  const grids = () => data.meta?.grids as ArrayLike<number> | undefined;
  const density = () => data.meta?.density as ArrayLike<number> | undefined;
  const medians = () => data.meta?.median as ArrayLike<number> | undefined;
  function features(): string[] {
    const given = data.meta?.features as string[] | undefined;
    return given && given.length ? given : uniq(featureCol());
  }
  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    return given && given.length ? given : uniq(groupCol());
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, groups().length);
  }
  // ---- text ----
  const tw = (s: string, size: number) => textWidth(s, size, theme.fontFamily);
  /** `s` cut with an ellipsis to fit `maxW` px at `size` px. */
  function fit(s: string, maxW: number, size: number): string {
    if (tw(s, size) <= maxW) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (tw(`${s.slice(0, mid)}\u2026`, size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? `${s.slice(0, lo)}\u2026` : "";
  }
  /** Width of the widest value axis label. */
  function valueLabelWidth(nFeatures: number): number {
    const gr = grid();
    if (!opts.showValueAxis || !gr.length) return 0;
    const grs = grids();
    let w = 0;
    for (let r = 0; r < nFeatures; r += 1) {
      const rowGrid = gridForRow(gr, grs, r);
      const lo = rowGrid[0] as number;
      const hi = rowGrid[rowGrid.length - 1] as number;
      w = Math.max(
        w,
        tw(fmtAxis(lo), sizes.label),
        tw(fmtAxis(hi), sizes.label),
      );
    }
    return w;
  }

  /** Index of the violin for (feature, group), or -1. */
  function violinIndex(feature: string, group: string): number {
    const fc = featureCol();
    const gc = groupCol();
    for (let i = 0; i < fc.length; i += 1) {
      if (fc[i] === feature && gc[i] === group) return i;
    }
    return -1;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);
    const f = features();
    const g = groups();
    const col = Math.floor((mx - layout.left) / layout.cellW);
    const row = Math.floor((my - layout.top) / layout.rowH);
    if (col < 0 || col >= g.length || row < 0 || row >= f.length) {
      tooltip.hide();
      return;
    }
    const i = violinIndex(f[row] as string, g[col] as string);
    if (i < 0) {
      tooltip.hide();
      return;
    }
    const med = medians();
    // R sends a missing median (a violin with no finite values) as null.
    const m = med && i < med.length ? (med[i] as number) : undefined;
    const medTxt =
      m === undefined
        ? ""
        : Number.isFinite(m)
          ? `<br/>median ${m.toFixed(2)}`
          : "<br/>no data";
    // R sends a missing name as null, and Python now does too; it reads
    // "NA", as in the dot plot and the legend keys.
    tooltip.show(
      `<b>${esc(f[row] ?? "NA")}</b> in ${esc(g[col] ?? "NA")}${medTxt}`,
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
    const f = features();
    const g = groups();
    const gr = grid();
    const longest = (labels: string[]) =>
      labels.reduce((m, s) => Math.max(m, tw(s, sizes.label)), 0);
    layout = layoutViolin(width, height, f.length, g.length, opts, {
      sizes,
      rowLabel: opts.showFeatureLabels ? longest(f) : 0,
      colLabel: longest(g),
      valueLabel: valueLabelWidth(f.length),
    });

    ctx.clearRect(0, 0, width, height);
    // var() and currentColor read inside the element, as a canvas cannot.
    const background = plainColour(theme.background, el);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    if (!f.length || !g.length || !gr.length) {
      renderOverlay();
      return;
    }

    const dens = density();
    const cols = groupColors();
    const med = medians();
    const grs = grids();
    const halfW =
      violinMaxWidth(layout, opts.violinWidth, opts.violinAspect, sizes.label) /
      2;

    // Row separators, so a tall stack does not read as one continuous field.
    // They go first, under the violins, so no line crosses a violin's tip. A
    // grid colour that paints nothing, such as "none", draws no line.
    if (setCanvasColour(ctx, "strokeStyle", theme.grid, el)) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 1; r < f.length; r += 1) {
        // On a half pixel, so the 1 px line fills one row of pixels.
        const y = Math.round(layout.top + r * layout.rowH) + 0.5;
        ctx.moveTo(layout.left, y);
        ctx.lineTo(layout.left + layout.plotW, y);
      }
      ctx.stroke();
    }

    for (let r = 0; r < f.length; r += 1) {
      // Collect the row first so every violin in it shares one density scale.
      const rows: number[][] = [];
      const idx: number[] = [];
      for (let c = 0; c < g.length; c += 1) {
        const i = violinIndex(f[r] as string, g[c] as string);
        idx.push(i);
        rows.push(
          i < 0 ? new Array(gr.length).fill(0) : densityRow(dens, i, gr.length),
        );
      }
      const rowMax = maxDensity(rows);

      // Each row is framed on its own grid when one is supplied, so a highly
      // expressed feature cannot compress the rest into flat lines.
      const rowGrid = gridForRow(gr, grs, r);
      const gmin = rowGrid[0] as number;
      const gmax = rowGrid[rowGrid.length - 1] as number;
      const span = gmax - gmin || 1;
      const yTop = layout.top + r * layout.rowH + 2;
      const yBot = layout.top + (r + 1) * layout.rowH - 2;
      const toY = (v: number) => yBot - ((v - gmin) / span) * (yBot - yTop);

      for (let c = 0; c < g.length; c += 1) {
        const row = rows[c] as number[];
        const scale = opts.scalePerViolin ? maxDensity([row]) : rowMax;
        const poly = violinPolygon(rowGrid, row, scale);
        if (!poly.length) continue;
        const cx = layout.left + (c + 0.5) * layout.cellW;
        ctx.beginPath();
        for (let k = 0; k < poly.length; k += 1) {
          const p = poly[k] as { x: number; y: number };
          const px = cx + p.x * halfW;
          const py = toY(p.y);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = cols[c] ?? theme.foreground;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        const i = idx[c] as number;
        if (
          opts.showMedian &&
          background &&
          med &&
          i >= 0 &&
          i < med.length &&
          Number.isFinite(med[i] as number)
        ) {
          const my = toY(med[i] as number);
          ctx.strokeStyle = background;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx - halfW * 0.35, my);
          ctx.lineTo(cx + halfW * 0.35, my);
          ctx.stroke();
        }
      }
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const f = features();
    const g = groups();

    const { label } = sizes;
    if (opts.showFeatureLabels) {
      const step = Math.max(1, Math.ceil(label / layout.rowH));
      for (let r = 0; r < f.length; r += step) {
        svg.appendChild(
          text(
            layout.left - 7,
            layout.top + (r + 0.5) * layout.rowH + 0.35 * label,
            fit(f[r] ?? "", layout.left - 9, label),
            theme.foreground,
            "end",
            label,
          ),
        );
      }
    }

    // A value axis per row on the right: each row can have its own range, so
    // each gets its own lowest and highest value. The lowest is left out when
    // the row is too short for both labels, and on rows tighter than the
    // labels, only every k-th row is labelled, as with the feature labels.
    const gr = grid();
    if (opts.showValueAxis && gr.length) {
      const grs = grids();
      const x = layout.left + layout.plotW + 4;
      const step = Math.max(1, Math.ceil(label / layout.rowH));
      for (let r = 0; r < f.length; r += step) {
        const rowGrid = gridForRow(gr, grs, r);
        const lo = rowGrid[0] as number;
        const hi = rowGrid[rowGrid.length - 1] as number;
        const yTop = layout.top + r * layout.rowH + 2;
        const yBot = layout.top + (r + 1) * layout.rowH - 2;
        svg.appendChild(line(x, yTop, x, yBot, theme.axis));
        svg.appendChild(line(x, yTop, x + 3, yTop, theme.axis));
        svg.appendChild(
          text(
            x + 5,
            yTop + 0.75 * label,
            fmtAxis(hi),
            theme.muted,
            "start",
            label,
          ),
        );
        if (yBot - yTop >= 2 * label + 2) {
          // Large text sits a little higher, clear of the next row's top
          // label 4 px under it.
          svg.appendChild(line(x, yBot, x + 3, yBot, theme.axis));
          svg.appendChild(
            text(
              x + 5,
              yBot - Math.max(0, 0.3 * label - 3.5),
              fmtAxis(lo),
              theme.muted,
              "start",
              label,
            ),
          );
        }
      }
    }

    // Group labels, rotated: cluster names are long and would collide flat.
    // Turned 45 degrees, the lines of two neighbours are cellW / sqrt(2)
    // from each other; when that is less than the label size, only every
    // k-th label is drawn.
    const colRoom = colLabelRoom(layout.bottom, label);
    const colStep = Math.max(
      1,
      Math.ceil(label / (layout.cellW * Math.SQRT1_2) - 1e-9),
    );
    for (let c = 0; c < g.length; c += colStep) {
      const x = layout.left + (c + 0.5) * layout.cellW;
      const y = layout.top + layout.plotH + 8;
      const t = text(
        x,
        y,
        fit(g[c] ?? "", colRoom, label),
        theme.foreground,
        "end",
        label,
      );
      t.setAttribute("transform", `rotate(-45 ${x} ${y})`);
      svg.appendChild(t);
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

  const instance: PlotomicsInstance<ViolinOptions> = {
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

  return instance;
};

// ---- small utilities ----
/**
 * An axis value short enough for the right gutter: whole numbers below
 * 100,000 as they are, very large or very small values in exponent form,
 * and the rest to three significant digits.
 */
function fmtAxis(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-3)) return v.toExponential(1);
  if (Number.isInteger(v)) return String(v);
  if (a >= 100) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
}
function uniq(col: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of col) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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
  base: ViolinOptions,
  next?: Partial<ViolinOptions>,
): ViolinOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
