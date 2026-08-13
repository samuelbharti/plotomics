/**
 * Embedding scatter — a large-scale 2-D viewer for dimensionality-reduction
 * output (UMAP, t-SNE, PCA).
 *
 * A specialization of the Volcano reference component: points render on the GPU
 * via regl-scatterplot (hundreds of thousands to millions of cells at 60fps)
 * while a crisp SVG overlay carries the legend and an optional axis frame. The
 * `color` column may be categorical (string cluster/cell-type labels → discrete
 * legend) or continuous (numeric → sequential colormap + colorbar). Lasso
 * selection is enabled and the selected indices are exposed via the `onSelect`
 * option and the returned instance's `selectedIndices`. Mirrors the volcano
 * structure: exported pure helpers plus a factory returning a PlotomicsInstance.
 *
 * ## Data contract
 * - `columns.x`, `columns.y`  `number[]`             embedding coordinates (required)
 * - `columns.color`           `string[] | number[]`  optional; strings ⇒ categorical,
 *                                                     numbers ⇒ continuous
 * - `columns.label`           `string[]`             optional per-point tooltip label
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type Column,
  type RampName,
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
  categoricalScale,
  OKABE_ITO,
  ramp,
  sampleRamp,
} from "@plotomics/core";
import createScatterplot from "regl-scatterplot";
import { scaleLinear } from "d3-scale";
import { ticks as d3ticks } from "d3-array";

export type EmbeddingColorMode = "auto" | "categorical" | "continuous";

export interface EmbeddingOptions {
  /** Point radius in pixels. See `pointScaleMode`: under the default the
   * renderer scales this by the camera, and on a view zoomed far out it clamps
   * to a single pixel no matter what you pass here. */
  pointSize: number;
  /** How `pointSize` responds to zoom. `"asinh"` (default) and `"linear"`
   * shrink points as you zoom out, which is what keeps a dense embedding
   * readable. Both floor at one pixel once the camera scale drops below
   * `1 / pointSize`, so on a widely-scaled plot — anything whose data range is
   * far from unit size, such as PCA scores — `pointSize` stops having any
   * visible effect. `"constant"` sizes points in literal pixels regardless of
   * zoom, which is what a small cohort scatter wants. */
  pointScaleMode: "asinh" | "linear" | "constant";
  /** Point opacity in `[0, 1]`. */
  opacity: number;
  /** How to interpret the `color` column. `"auto"` detects from its type
   * (strings ⇒ categorical, numbers ⇒ continuous). */
  colorMode: EmbeddingColorMode;
  /** Sequential ramp used for continuous coloring. */
  colormap: RampName;
  /** Explicit category order for categorical coloring. Categories are assigned
   * palette entries by their position here, and every one of them gets a legend
   * row even if no point carries it, so the colors stay put as the data
   * changes. `null` (default) falls back to first-appearance order. Categories
   * found in the data but missing from this list are appended after it. */
  categories: string[] | null;
  xLabel: string;
  yLabel: string;
  /** Draw the axis frame + ticks (embeddings usually hide axes). */
  showAxes: boolean;
  /** Draw the legend (discrete swatches, or a colorbar when continuous). */
  showLegend: boolean;
  /** Fraction of the data range to pad around the fitted view (larger = more
   * zoomed out). Defaults to 0.04. */
  padding: number;
  /** How the fitted view maps data units onto pixels. `"fill"` (default)
   * stretches each axis independently so the cloud fills the canvas, which is
   * what a UMAP wants: its axes carry no units and the shape is arbitrary.
   * `"equal"` gives both axes the same units per pixel, so a distance means
   * the same thing in x as in y. Use it whenever the axes share units and
   * their relative spread is part of the claim, such as PCA or PCoA scores,
   * where stretching draws a component explaining 4% as though it were worth
   * as much as one explaining 34%. */
  aspect: "fill" | "equal";
  /** Primary drag gesture. `"panZoom"` (default) pans and zooms; `"lasso"`
   * makes a plain drag draw a selection. Flip this to give users a lasso tool
   * (the wheel still zooms in either mode). */
  mouseMode: "panZoom" | "lasso";
  /** Called with the point indices after a lasso select / deselect. JS-only —
   * callbacks do not cross the R/Python bridge. */
  onSelect: ((indices: number[]) => void) | null;
  theme: Partial<PlotomicsTheme>;
}

export const defaultEmbeddingOptions: EmbeddingOptions = {
  pointSize: 3,
  pointScaleMode: "asinh",
  opacity: 0.8,
  colorMode: "auto",
  colormap: "viridis",
  categories: null,
  xLabel: "UMAP 1",
  yLabel: "UMAP 2",
  showAxes: false,
  showLegend: true,
  padding: 0.04,
  aspect: "fill",
  mouseMode: "panZoom",
  onSelect: null,
  theme: {},
};

/** Instance handle; extends the base contract with the current lasso selection. */
export interface EmbeddingInstance extends PlotomicsInstance<EmbeddingOptions> {
  /** Point indices currently selected via lasso (empty when none). */
  readonly selectedIndices: number[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const AXIS_MARGIN = { top: 16, right: 18, bottom: 46, left: 60 };
const BARE_MARGIN = { top: 10, right: 10, bottom: 10, left: 10 };
/** Gradient swatches sampled from the ramp for continuous coloring. */
const CONTINUOUS_STEPS = 256;
/** Cap on discrete legend rows before collapsing into a "+N more" line. */
const LEGEND_MAX = 20;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/embedding.test.ts)
// ---------------------------------------------------------------------------

/** Min/max of a numeric column with symmetric padding (fraction of range).
 * Degenerate/empty input widens to a unit range so scales stay well-defined. */
export function paddedExtent(col: ArrayLike<number>, pad = 0.04): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const n = col.length;
  for (let i = 0; i < n; i += 1) {
    const v = col[i] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const d = (max - min) * pad;
  return [min - d, max + d];
}

/** Widen the two domains so both axes carry the same data units per pixel.
 *
 * The axis that is already coarser wins and the other is expanded around its
 * midpoint, so this only ever zooms out: every point that fitted before still
 * fits. Returns the inputs unchanged when the plot area is degenerate, which
 * happens while a container is still being laid out. */
export function equalAspectDomains(
  xDomain: [number, number],
  yDomain: [number, number],
  width: number,
  height: number,
): [[number, number], [number, number]] {
  const xr = xDomain[1] - xDomain[0];
  const yr = yDomain[1] - yDomain[0];
  if (!(width > 0) || !(height > 0) || !(xr > 0) || !(yr > 0)) {
    return [xDomain, yDomain];
  }
  const unitsPerPx = Math.max(xr / width, yr / height);
  const halfX = (unitsPerPx * width) / 2;
  const halfY = (unitsPerPx * height) / 2;
  const cx = (xDomain[0] + xDomain[1]) / 2;
  const cy = (yDomain[0] + yDomain[1]) / 2;
  return [
    [cx - halfX, cx + halfX],
    [cy - halfY, cy + halfY],
  ];
}

/** True when a column holds strings (categorical) rather than numbers. */
export function isStringColumn(col: Column): col is string[] {
  return col.length > 0 && typeof (col as ArrayLike<unknown>)[0] === "string";
}

/**
 * Decide whether the `color` column should be drawn categorical or continuous.
 * A `force` of `"categorical"`/`"continuous"` wins; `"auto"` detects from the
 * column type (string column ⇒ categorical, else continuous).
 */
export function resolveColorMode(
  col: Column | undefined,
  force: EmbeddingColorMode = "auto",
): "categorical" | "continuous" {
  if (force !== "auto") return force;
  return col && isStringColumn(col) ? "categorical" : "continuous";
}

/**
 * Map categorical labels to dense integer indices plus the ordered category
 * list (first-appearance order, which is also the palette-assignment order).
 *
 * Pass `order` to fix that order yourself. Its entries come first and keep
 * their index whether or not any point carries them, which is what lets a
 * caller pin a specific color to a specific category; labels outside it are
 * appended in first-appearance order behind them.
 */
export function categoryToIndex(
  labels: string[],
  order?: readonly string[] | null,
): {
  indices: Int32Array;
  categories: string[];
} {
  const lookup = new Map<string, number>();
  const categories: string[] = [];
  const indices = new Int32Array(labels.length);
  if (order) {
    for (const name of order) {
      const key = String(name);
      if (lookup.has(key)) continue;
      lookup.set(key, categories.length);
      categories.push(key);
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    // Stringify: a numeric column forced to categorical arrives here as numbers,
    // and a number has no `.length`, which would make the legend box width NaN.
    const key = String(labels[i]);
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = categories.length;
      lookup.set(key, idx);
      categories.push(key);
    }
    indices[i] = idx;
  }
  return { indices, categories };
}

/**
 * Normalize a numeric column into `[0, 1]`. Uses an explicit `[min, max]` range
 * when given, else the column's own extent. A degenerate range maps everything
 * to `0.5`; out-of-range values clamp; non-finite values map to `0`.
 */
export function normalizeToUnit(
  col: ArrayLike<number>,
  range?: [number, number],
): Float32Array {
  const n = col.length;
  const out = new Float32Array(n);
  let lo: number;
  let hi: number;
  if (range) {
    [lo, hi] = range;
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const v = col[i] as number;
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
  }
  const span = hi - lo;
  if (span === 0) {
    out.fill(0.5);
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    const v = col[i] as number;
    let t = (v - lo) / span;
    if (!Number.isFinite(t)) t = 0;
    else if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = t;
  }
  return out;
}

/** Nice axis tick values for a domain. */
export function niceTicks(domain: [number, number], count = 6): number[] {
  return d3ticks(domain[0], domain[1], count);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type LegendState =
  | { mode: "categorical"; categories: string[]; palette: string[] }
  | { mode: "continuous"; domain: [number, number] }
  | null;

// Monotonic per-page counter so multiple embeddings get distinct SVG element
// ids. A shared id would make every colorbar's `url(#…)` resolve to the first
// instance's gradient in document order (silent legend/point mismatch).
let embeddingSeq = 0;

export const createEmbedding: PlotomicsFactory<EmbeddingOptions> = (el, initial) => {
  let opts: EmbeddingOptions = mergeOptions(defaultEmbeddingOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  // Layout / view state.
  let width = 0;
  let height = 0;
  let xDomain: [number, number] = [0, 1];
  let yDomain: [number, number] = [0, 1];
  let legend: LegendState = null;
  let selected: number[] = [];
  // The construction-time draw happens at `measure()`'s 640×480 fallback when
  // the container hasn't been laid out yet (e.g. the dev harness). Re-fit once
  // when the first real size arrives so the camera frames the data instead of
  // staying zoomed into the fallback viewport.
  let needsInitialFit = true;
  const uid = `plotomics-embedding-${embeddingSeq++}`;

  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);

  // DOM: a canvas (GPU points) inset by margins, plus a full-size SVG overlay.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // GPU scatter. Passing d3 scales makes draw() accept *data* coordinates and
  // keeps domains in sync with pan/zoom. Lasso selection is enabled (the
  // volcano reference disables it).
  const scatterplot = createScatterplot({
    canvas,
    xScale,
    yScale,
    pointSize: opts.pointSize,
    pointScaleMode: opts.pointScaleMode,
    opacity: opts.opacity,
    backgroundColor: theme.background,
    mouseMode: opts.mouseMode,
    // Extra lasso affordances even in panZoom mode: click the handle that
    // appears, or press-and-hold then drag (touch-friendly).
    lassoInitiator: true,
    lassoOnLongPress: true,
  });

  scatterplot.subscribe("pointOver", (i: number) => showTip(i));
  scatterplot.subscribe("pointOut", () => tooltip.hide());
  scatterplot.subscribe("select", ({ points }: { points: number[] }) => {
    selected = points.slice();
    opts.onSelect?.(selected.slice());
  });
  scatterplot.subscribe("deselect", () => {
    selected = [];
    opts.onSelect?.([]);
  });
  scatterplot.subscribe("view", () => {
    // Domains were mutated in place by the scatterplot; redraw the overlay.
    xDomain = xScale.domain() as [number, number];
    yDomain = yScale.domain() as [number, number];
    renderOverlay();
  });

  const lastPointer = { x: 0, y: 0 };
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  };
  el.addEventListener("mousemove", onMove);

  function showTip(i: number) {
    const cols = data.columns;
    const x = num(cols.x, i);
    const y = num(cols.y, i);
    const label = str(cols.label, i) ?? `#${i}`;
    const parts = [`<b>${escapeHTML(label)}</b>`, `${fmt(x)}, ${fmt(y)}`];
    if (cols.color) {
      if (legend?.mode === "continuous") parts.push(`value: ${fmt(num(cols.color, i))}`);
      else parts.push(escapeHTML(str(cols.color, i) ?? ""));
    }
    tooltip.show(parts.join("<br/>"), lastPointer.x, lastPointer.y);
  }

  // ---- pixel mapping (overlay) ----
  const margin = () => (opts.showAxes ? AXIS_MARGIN : BARE_MARGIN);
  const innerW = () => Math.max(1, width - margin().left - margin().right);
  const innerH = () => Math.max(1, height - margin().top - margin().bottom);
  const pxX = (v: number) =>
    margin().left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW();
  const pxY = (v: number) =>
    margin().top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH();

  function layoutCanvas() {
    const m = margin();
    const ratio = dpr();
    canvas.style.left = `${m.left}px`;
    canvas.style.top = `${m.top}px`;
    canvas.style.width = `${innerW()}px`;
    canvas.style.height = `${innerH()}px`;
    canvas.width = Math.round(innerW() * ratio);
    canvas.height = Math.round(innerH() * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  /** N stable palette colors, one per category index, cycling the theme palette. */
  function categoricalPalette(n: number): string[] {
    const base = theme.categorical.length ? theme.categorical : OKABE_ITO;
    const scale = categoricalScale(base);
    return Array.from({ length: Math.max(1, n) }, (_, i) => scale(String(i)));
  }

  // `fit` recomputes the view to frame the data (used on new data); pass false
  // to recolor/redraw at the current pan/zoom (used on option changes) so a
  // re-render — e.g. toggling the drag mode — never snaps the camera back.
  function applyData(fit = true) {
    const cols = data.columns;
    const x = cols.x as ArrayLike<number> | undefined;
    const y = cols.y as ArrayLike<number> | undefined;
    if (!x || !y || x.length === 0) {
      scatterplot.clear?.();
      legend = null;
      renderOverlay();
      return;
    }
    if (fit) {
      xDomain = paddedExtent(x, opts.padding);
      yDomain = paddedExtent(y, opts.padding);
      if (opts.aspect === "equal") {
        [xDomain, yDomain] = equalAspectDomains(
          xDomain, yDomain, innerW(), innerH());
      }
      xScale.domain(xDomain);
      yScale.domain(yDomain);
    }

    const color = cols.color;
    const mode = color && color.length ? resolveColorMode(color, opts.colorMode) : null;

    if (mode === "categorical") {
      const { indices, categories } = categoryToIndex(
        color as string[], opts.categories);
      const palette = categoricalPalette(categories.length);
      legend = { mode, categories, palette };
      scatterplot.set({
        colorBy: "category",
        pointColor: palette,
        pointSize: opts.pointSize,
        pointScaleMode: opts.pointScaleMode,
        opacity: opts.opacity,
      });
      // Integer category indices in the z channel; pointColor[z] selects the hue.
      scatterplot.draw({ x, y, z: indices }, { zDataType: "categorical" });
    } else if (mode === "continuous") {
      const values = color as ArrayLike<number>;
      const domain = paddedExtent(values, 0);
      const z = normalizeToUnit(values, domain);
      const palette = sampleRamp(opts.colormap, CONTINUOUS_STEPS);
      legend = { mode, domain };
      scatterplot.set({
        colorBy: "valueA",
        pointColor: palette,
        pointSize: opts.pointSize,
        pointScaleMode: opts.pointScaleMode,
        opacity: opts.opacity,
      });
      // Normalized [0,1] values interpolate across the sampled ramp.
      scatterplot.draw({ x, y, z }, { zDataType: "continuous" });
    } else {
      // No color column: one flat hue, no legend.
      legend = null;
      scatterplot.set({
        colorBy: "category",
        pointColor: [theme.categorical[0] ?? OKABE_ITO[0] ?? "#0072B2"],
        pointSize: opts.pointSize,
        pointScaleMode: opts.pointScaleMode,
        opacity: opts.opacity,
      });
      scatterplot.draw({ x, y, z: new Float32Array(x.length) }, { zDataType: "categorical" });
    }
    renderOverlay();
  }

  // ---- overlay rendering (optional axes + legend) ----
  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    if (opts.showAxes) renderAxes();
    if (opts.showLegend && legend) renderLegend();
  }

  function renderAxes() {
    const m = margin();
    const axisColor = theme.axis;
    const gridColor = theme.grid;
    for (const t of niceTicks(xDomain)) {
      const x = pxX(t);
      if (x < m.left - 1 || x > width - m.right + 1) continue;
      svg.appendChild(line(x, m.top, x, height - m.bottom, gridColor, 1));
      svg.appendChild(text(x, height - m.bottom + 16, fmt(t), axisColor, "middle"));
    }
    for (const t of niceTicks(yDomain)) {
      const y = pxY(t);
      if (y < m.top - 1 || y > height - m.bottom + 1) continue;
      svg.appendChild(line(m.left, y, width - m.right, y, gridColor, 1));
      svg.appendChild(text(m.left - 8, y + 4, fmt(t), axisColor, "end"));
    }
    svg.appendChild(
      line(m.left, height - m.bottom, width - m.right, height - m.bottom, axisColor, 1.5),
    );
    svg.appendChild(line(m.left, m.top, m.left, height - m.bottom, axisColor, 1.5));
    svg.appendChild(
      text(m.left + innerW() / 2, height - 8, opts.xLabel, theme.foreground, "middle", 13),
    );
    const yTitle = text(16, m.top + innerH() / 2, opts.yLabel, theme.foreground, "middle", 13);
    yTitle.setAttribute("transform", `rotate(-90 16 ${m.top + innerH() / 2})`);
    svg.appendChild(yTitle);
  }

  function renderLegend() {
    if (legend?.mode === "categorical") {
      renderCategoricalLegend(legend.categories, legend.palette);
    } else if (legend?.mode === "continuous") {
      renderColorbar(legend.domain);
    }
  }

  function renderCategoricalLegend(categories: string[], palette: string[]) {
    const m = margin();
    const shown = Math.min(categories.length, LEGEND_MAX);
    const rows = categories.slice(0, shown);
    const overflow = categories.length - shown;
    const labels = overflow > 0 ? [...rows, `+${overflow} more`] : rows;
    const rowH = 16;
    const swatch = 10;
    const pad = 8;
    const longest = labels.reduce((mx, s) => Math.max(mx, s.length), 1);
    const boxW = pad * 2 + swatch + 6 + Math.ceil(longest * 6.6);
    const boxH = pad * 2 + labels.length * rowH;
    const x0 = Math.max(m.left + 4, width - m.right - boxW - 6);
    const y0 = m.top + 6;
    svg.appendChild(legendBg(x0, y0, boxW, boxH));
    for (let r = 0; r < labels.length; r += 1) {
      const cy = y0 + pad + r * rowH;
      const isOverflow = overflow > 0 && r === labels.length - 1;
      if (!isOverflow) {
        svg.appendChild(rect(x0 + pad, cy + 2, swatch, swatch, palette[r] ?? theme.muted, "none", 0));
      }
      svg.appendChild(
        text(
          x0 + pad + swatch + 6,
          cy + swatch,
          labels[r] ?? "",
          isOverflow ? theme.muted : theme.foreground,
          "start",
          11,
        ),
      );
    }
  }

  function renderColorbar(domain: [number, number]) {
    const m = margin();
    const cbW = 12;
    const cbH = Math.min(160, Math.max(80, innerH() - 40));
    const x0 = width - m.right - cbW - 46;
    const y0 = m.top + 12;
    const fn = ramp(opts.colormap);
    const gradId = `${uid}-cb`;
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "1");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "0"); // bottom = low, top = high
    const STOPS = 16;
    for (let i = 0; i <= STOPS; i += 1) {
      const t = i / STOPS;
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", `${t * 100}%`);
      stop.setAttribute("stop-color", fn(t));
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    svg.appendChild(legendBg(x0 - 6, y0 - 8, cbW + 52, cbH + 16));
    svg.appendChild(rect(x0, y0, cbW, cbH, `url(#${gradId})`, theme.axis, 1));
    const mid = (domain[0] + domain[1]) / 2;
    svg.appendChild(text(x0 + cbW + 5, y0 + 4, fmt(domain[1]), theme.foreground, "start", 10));
    svg.appendChild(text(x0 + cbW + 5, y0 + cbH / 2 + 3, fmt(mid), theme.foreground, "start", 10));
    svg.appendChild(text(x0 + cbW + 5, y0 + cbH, fmt(domain[0]), theme.foreground, "start", 10));
  }

  // ---- SVG element helpers ----
  function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", String(w));
    return l;
  }
  function rect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke: string,
    sw: number,
  ) {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("fill", fill);
    r.setAttribute("stroke", stroke);
    r.setAttribute("stroke-width", String(sw));
    return r;
  }
  function legendBg(x: number, y: number, w: number, h: number) {
    const r = rect(x, y, w, h, theme.background, theme.grid, 1);
    r.setAttribute("fill-opacity", "0.82");
    r.setAttribute("rx", "4");
    return r;
  }
  function text(x: number, y: number, content: string, fill: string, anchor: string, size = 11) {
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

  function doResize(w: number, h: number) {
    // Under equal aspect, carry the current units-per-pixel across the resize
    // rather than re-deriving it from the new box. Both axes share it here, so
    // reusing it keeps the zoom level exactly and keeps the two axes matched.
    // Re-deriving would only ever widen the finer axis, which creeps outward a
    // little on every resize.
    const unitsPerPx = opts.aspect === "equal" && innerW() > 0
      ? (xDomain[1] - xDomain[0]) / innerW()
      : 0;
    width = w;
    height = h;
    layoutCanvas();
    if (unitsPerPx > 0) {
      const cx = (xDomain[0] + xDomain[1]) / 2;
      const cy = (yDomain[0] + yDomain[1]) / 2;
      const halfX = (unitsPerPx * innerW()) / 2;
      const halfY = (unitsPerPx * innerH()) / 2;
      xDomain = [cx - halfX, cx + halfX];
      yDomain = [cy - halfY, cy + halfY];
      xScale.domain(xDomain);
      yScale.domain(yDomain);
    }
    scatterplot.set({ width: innerW(), height: innerH() });
    renderOverlay();
  }

  // Initial sizing from the container (or sensible defaults when detached).
  {
    const m = measure(el);
    doResize(m.width, m.height);
    if (data.columns.x) applyData();
  }

  const instance: EmbeddingInstance = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      scatterplot.set({
        backgroundColor: theme.background,
        mouseMode: opts.mouseMode,
        // pointSize and opacity were previously only honoured at construction,
        // so setOptions({pointSize}) silently did nothing and a size control
        // could never work.
        pointSize: opts.pointSize,
        pointScaleMode: opts.pointScaleMode,
        opacity: opts.opacity,
      });
      // Re-layout in case showAxes toggled (it changes the canvas inset), then
      // recolor/redraw with the merged options — preserving the current view.
      doResize(width, height);
      applyData(false);
    },
    resize(w, h) {
      doResize(w, h);
      if (needsInitialFit && w > 0 && h > 0 && data.columns.x) {
        needsInitialFit = false;
        applyData(true);
      }
    },
    get selectedIndices() {
      return selected.slice();
    },
    exportSVG() {
      // Hybrid figure: rasterized GPU layer + vector legend/axes.
      const m = margin();
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", String(m.left));
      img.setAttribute("y", String(m.top));
      img.setAttribute("width", String(innerW()));
      img.setAttribute("height", String(innerH()));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      tooltip.destroy();
      scatterplot.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
function num(col: Column | undefined, i: number): number {
  return col ? ((col as ArrayLike<number>)[i] as number) : 0;
}
function str(col: Column | undefined, i: number): string | undefined {
  if (!col) return undefined;
  const v = (col as unknown[])[i];
  return v == null ? undefined : String(v);
}
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}
function escapeHTML(s: string): string {
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
function mergeOptions(base: EmbeddingOptions, next?: Partial<EmbeddingOptions>): EmbeddingOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
