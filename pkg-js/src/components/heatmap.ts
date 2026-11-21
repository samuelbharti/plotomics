/**
 * Expression heatmap — a large samples x genes matrix rendered on the GPU.
 *
 * The matrix is normalized to [0,1] on the CPU (one linear pass over the typed
 * array), uploaded as a single-channel `luminance` texture (1 byte/cell, so a
 * 1000x1000 matrix is ~1 MB of GPU memory) and colormapped in a fragment
 * shader via a 256x1 lookup texture baked from a `plotomics/core` ramp. Pan/zoom
 * is a UV transform applied entirely on the GPU, so interaction stays at 60fps
 * regardless of matrix size — there is never one DOM node per cell.
 *
 * SVG is reserved for the low-cardinality overlay: the colorbar legend and the
 * row/column tick labels (every k-th one when rows are too tight for all).
 * This mirrors the Volcano reference component's structure: exported pure
 * helpers plus a `PlotomicsFactory` returning a `PlotomicsInstance`.
 *
 * The view always stays inside the matrix: zooming out stops at the whole
 * matrix and zooming in at 1/10,000 of it. A double-click or the reset
 * button in the top right corner of the matrix goes back to the whole
 * matrix (see core/view.ts).
 *
 * A missing cell (NaN from Python, null from R) is drawn in a neutral grey and
 * left out of the colour range and the z-score. A matrix with more rows or
 * columns than the GPU's texture limit, or than the plot has pixels, is
 * mean-pooled for drawing (see `poolBlocks` in the core and `axisPlan`
 * below): each pixel shows the mean of the finite cells under it, so a lone
 * outlier row still shows, fainter the more rows share its pixel, and a
 * pixel is grey only when every cell under it is missing. The tooltip still
 * reads the cell under the cursor.
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
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
  ramp,
  isDivergingRamp,
  matrixRamp,
  type Blocks,
  alignedBlocks,
  evenBlocks,
  poolBlocks,
  serializeSVG,
  padSVG,
  compositePNG,
  fitDomainTicks,
  formatTicks,
  isFlatRange,
  MIN_VIEW_SHARE,
  createResetButton,
} from "../core/index.js";
import { releaseRegl } from "../core/gl.js";
import { guardDestroy, uniqueId } from "../core/dom.js";
import { colourBytes, hideUnreadableColours } from "../core/paint.js";
import createREGL from "regl";
import type { Regl, Texture2D, DrawCommand } from "regl";

export interface HeatmapOptions {
  /**
   * Colour ramp: sequential 'viridis' or 'ltc', or diverging 'rdbu' or
   * 'ltcdiv'. `null` (the default) uses 'rdbu' when `zScore` is on and
   * 'viridis' otherwise.
   */
  colormap: RampName | null;
  /** Per-row z-score normalization before coloring (row-centered heatmap). */
  zScore: boolean;
  /** Lower clamp of the color domain; `null` = auto from the data. */
  vmin: number | null;
  /** Upper clamp of the color domain; `null` = auto from the data. */
  vmax: number | null;
  /** Draw the colorbar legend on the SVG overlay. */
  showColorbar: boolean;
  /** Colour bar title. `null` gives "value", or "z-score" with `zScore` on. */
  legendTitle: string | null;
  theme: Partial<PlotomicsTheme>;
}

/** The handle {@link createHeatmap} returns. */
export interface HeatmapInstance extends PlotomicsInstance<HeatmapOptions> {
  /**
   * Go back to the view of the whole matrix, as a double-click or the
   * reset button does. Does nothing after `destroy()`.
   */
  resetView(): void;
}

export const defaultHeatmapOptions: HeatmapOptions = {
  colormap: null,
  zScore: false,
  vmin: null,
  vmax: null,
  showColorbar: true,
  legendTitle: null,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORBAR_W = 14;
const DEFAULT_SIZES = textSizes(defaultTheme);
/**
 * Bounds for the label margins, which grow with the longest label. They are
 * for the default text size and scale with it.
 */
const MIN_LABEL_MARGIN = 40;
const MAX_LABEL_MARGIN = 120;
/** Right margin for the colour bar, at the least. */
const MIN_RIGHT_MARGIN = 84;
/** The largest share of the widget's width or height that a margin takes. */
const MAX_MARGIN_SHARE = 0.35;
/** Fill for a missing cell, and its colour bar swatch. */
const MISSING_COLOR = "#CCCCCC";
/**
 * Pooled textures kept for reuse as the view pans and zooms, besides the
 * base texture; the one for the whole matrix is kept among them.
 */
const MAX_POOLED = 4;
/** How long the view rests after a wheel step or a drag before pooling. */
const SETTLE_MS = 120;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/heatmap.test.ts)
// ---------------------------------------------------------------------------

/** Matrix shape + optional labels pulled out of `data.meta`. */
export interface MatrixShape {
  nrows: number;
  ncols: number;
  rowLabels?: string[];
  colLabels?: string[];
}

/**
 * Labels as text. A missing label (null, as R and Python send an NA or
 * NaN name) is empty text, not the word "null".
 */
export function labelTexts(values: unknown[]): string[] {
  return values.map((v) => (v == null ? "" : String(v)));
}

/** Read {nrows, ncols, rowLabels, colLabels} from a meta object, defaulting
 * shape to a single row spanning the value column when absent. */
export function readShape(
  meta: Record<string, unknown> | undefined,
  valueCount: number,
): MatrixShape {
  const nrows = Math.max(0, Math.trunc(Number(meta?.nrows ?? 0)) || 0);
  const ncols = Math.max(0, Math.trunc(Number(meta?.ncols ?? 0)) || 0);
  const rowLabels = Array.isArray(meta?.rowLabels)
    ? labelTexts(meta.rowLabels as unknown[])
    : undefined;
  const colLabels = Array.isArray(meta?.colLabels)
    ? labelTexts(meta.colLabels as unknown[])
    : undefined;
  if (nrows > 0 && ncols > 0) return { nrows, ncols, rowLabels, colLabels };
  // Fall back to a 1 x N strip so a bare value column still renders.
  return { nrows: 1, ncols: valueCount, rowLabels, colLabels };
}

/**
 * Row-wise z-score: for each row subtract its mean and divide by its
 * (population) standard deviation. Rows with zero variance are left centered at
 * 0. Returns a new Float32Array; the input is not mutated. `values` is
 * row-major (row r, col c is index r*ncols + c).
 */
export function zScoreRows(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
): Float32Array {
  const out = new Float32Array(nrows * ncols);
  for (let r = 0; r < nrows; r += 1) {
    const base = r * ncols;
    // Mean and sd over the finite cells only, so one missing cell does not
    // turn the whole row into NaN. Missing cells stay missing.
    let n = 0;
    let mean = 0;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) continue;
      n += 1;
      mean += v;
    }
    mean /= n || 1;
    let variance = 0;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) continue;
      variance += (v - mean) * (v - mean);
    }
    variance /= n || 1;
    const sd = Math.sqrt(variance);
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) out[base + c] = Number.NaN;
      else out[base + c] = sd === 0 ? 0 : (v - mean) / sd;
    }
  }
  return out;
}

/** Copy a value column to a Float32Array, reading null (R's NA) as NaN. */
export function toFloat32(values: ArrayLike<number | null>): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    out[i] = v == null ? Number.NaN : v;
  }
  return out;
}

/**
 * How many texels to pool rows (or columns) into when the fraction `view`
 * of them shows across `px` device pixels and the rows in view outnumber
 * the pixels: the largest size on the ladder px, px * 1.1, px * 1.21, and
 * so on (each rounded down), that gives every texel in view a pixel or
 * more. No texel then falls between the pixels, a view keeps nine tenths
 * of the detail its pixels can show or more, and the sizes come back as
 * the view changes, so a pooled texture can be kept and used again.
 */
export function pooledSize(view: number, px: number, ratio = 1.1): number {
  let m = Math.floor(px);
  if (!(m >= 1)) return 1;
  // A view of no rows (or not a number) has nothing to fit: a texel a pixel.
  if (!(view > 0)) return m;
  for (;;) {
    const next = Math.max(m + 1, Math.floor(m * ratio));
    if (next * view > px + 1e-9) return m;
    m = next;
  }
}

/**
 * How the rows (or columns) of a matrix go into a texture: `count` texels,
 * from even blocks (`size` 0) or from blocks of `size` rows that start at
 * row 0 (`size` 1 is a texel a row), and the scale from data to texture
 * coordinates, below 1 when the last block is short.
 */
export interface AxisPlan {
  key: string;
  count: number;
  size: number;
  scale: number;
}

/**
 * The plan for `n` rows while each row in view has a pixel or more: a
 * texel a row, or past the texture limit `max`, blocks of the fewest rows
 * that fit, each drawn exactly over its rows.
 */
export function basePlan(n: number, max: number): AxisPlan {
  if (n <= max) return { key: "r", count: n, size: 1, scale: 1 };
  const size = Math.ceil(n / max);
  const count = Math.ceil(n / size);
  return { key: `a${size}`, count, size, scale: n / (size * count) };
}

/**
 * The plan for `n` rows of which the fraction `view` shows across `px`
 * device pixels, within the texture limit `max`: the base plan while each
 * row in view has a pixel or more, else even blocks, one a pixel or a
 * little fewer (see {@link pooledSize}). An even block is drawn less than a
 * row, so less than a pixel, from its rows.
 */
export function axisPlan(
  n: number,
  view: number,
  px: number,
  max: number,
): AxisPlan {
  if (n * view <= px + 1e-9) return basePlan(n, max);
  const count = Math.min(pooledSize(view, px), max);
  return { key: `e${count}`, count, size: 0, scale: 1 };
}

/**
 * The rows (or columns) of a window texture, from `lo` up to `hi`, for a
 * view that starts at the fraction `start` of `n` rows and shows the
 * fraction `view` of them across `px` device pixels, within the texture
 * limit `max`: the rows in view, and as many again on each side so a pan
 * stays inside it, cut to the limit and to the matrix. Past the limit the
 * whole matrix goes in blocks of rows; a window holds a texel a row, so
 * rows that each have a pixel show one by one. Null when the rows in view
 * outnumber the pixels, which pooling serves, or pass the limit.
 */
export function windowRange(
  n: number,
  start: number,
  view: number,
  px: number,
  max: number,
): [number, number] | null {
  if (!(n * view <= px + 1e-9)) return null;
  const [first, last] = rowsInView(n, start, view);
  if (last - first > max) return null;
  if (n <= max) return [0, n];
  const pad = Math.min(last - first, Math.floor((max - (last - first)) / 2));
  return [Math.max(0, first - pad), Math.min(n, last + pad)];
}

/** The rows of `n` a view starting at `start` and `view` long shows. */
function rowsInView(n: number, start: number, view: number): [number, number] {
  return [
    Math.max(0, Math.floor(start * n + 1e-6)),
    Math.min(n, Math.ceil((start + view) * n - 1e-6)),
  ];
}

/** The block of each of `n` rows under `plan`. */
function blocksFor(plan: AxisPlan, n: number): Blocks {
  return plan.size === 0
    ? evenBlocks(n, plan.count)
    : alignedBlocks(n, plan.size);
}

/**
 * Which tick labels to draw: every one when cells are at least `minPx` tall
 * (or wide), every k-th one when they are a little tighter, and none past
 * every 4th, where the labels would no longer say which cell they name.
 * `minPx` is the label size and 2 px; the default is for the default text
 * size. Returns k, or 0 for none.
 */
export function labelEvery(
  cellPx: number,
  minPx = DEFAULT_SIZES.label + 2,
): number {
  if (!(cellPx > 0)) return 0;
  const k = Math.ceil(minPx / cellPx - 1e-9);
  return k <= 4 ? Math.max(1, k) : 0;
}

/**
 * Resolve the color domain [lo, hi]. Explicit vmin/vmax win; otherwise the data
 * min/max are used. For a diverging ramp the neutral midpoint lands on 0: the
 * auto domain is symmetric around zero, and a positive vmax or a negative vmin
 * given alone is mirrored to the other side of zero. NaN/Inf values are
 * skipped.
 */
export function colorDomain(
  values: ArrayLike<number>,
  opts: { vmin: number | null; vmax: number | null; diverging: boolean },
): [number, number] {
  let lo = opts.vmin;
  let hi = opts.vmax;
  if (opts.diverging) {
    if (lo == null && hi != null && hi > 0) lo = -hi;
    else if (hi == null && lo != null && lo < 0) hi = -lo;
  }
  if (lo == null || hi == null) {
    let dmin = Infinity;
    let dmax = -Infinity;
    const n = values.length;
    for (let i = 0; i < n; i += 1) {
      const v = values[i] as number;
      if (!Number.isFinite(v)) continue;
      if (v < dmin) dmin = v;
      if (v > dmax) dmax = v;
    }
    if (!Number.isFinite(dmin) || !Number.isFinite(dmax)) {
      dmin = 0;
      dmax = 1;
    }
    if (opts.diverging && lo == null && hi == null) {
      const m = Math.max(Math.abs(dmin), Math.abs(dmax)) || 1;
      dmin = -m;
      dmax = m;
    }
    if (lo == null) lo = dmin;
    if (hi == null) hi = dmax;
  }
  if (isFlatRange(lo, hi)) {
    // Degenerate domain, or one whose ends differ only in their last digits
    // (0.3 and 0.1 + 0.2): widen around its middle, so the shader division is
    // well-defined and the cells take the middle of the ramp. From 2 ** 52 on,
    // 0.5 is below the spacing of the numbers and the ends would not move, so
    // the widening grows with the middle; at a quarter of the width
    // isFlatRange allows, the domain stays flat and keeps one colour bar
    // label.
    const mid = lo / 2 + hi / 2;
    const w = Math.max(0.5, Math.abs(mid) * 2.5e-13);
    lo = mid - w;
    hi = mid + w;
  }
  return [lo, hi];
}

/**
 * Normalize `values` into a Uint8Array for the luminance texture. Level 0 is
 * a missing cell; levels 1 to 255 run from the low end of the color domain to
 * the high end, clamped.
 */
export function normalizeToU8(
  values: ArrayLike<number>,
  lo: number,
  hi: number,
): Uint8Array {
  const n = values.length;
  const out = new Uint8Array(n);
  const span = hi - lo || 1;
  for (let i = 0; i < n; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    let t = (v - lo) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = 1 + Math.round(t * 254);
  }
  return out;
}

/**
 * Bake a `plotomics/core` ramp into a 256x4 RGBA lookup table matching
 * {@link normalizeToU8}: entry 0 is the missing-cell grey and entries 1 to
 * 255 run along the ramp.
 */
export function buildRampLUT(name: RampName): Uint8Array {
  const fn = ramp(name);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const hex = i === 0 ? MISSING_COLOR : fn((i - 1) / 254);
    lut[i * 4] = parseInt(hex.slice(1, 3), 16);
    lut[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    lut[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

/** Evenly-spaced integer tick indices for `n` items, at most `max` of them. */
export function tickIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const step = (n - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(Math.round(i * step));
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createHeatmap: PlotomicsFactory<
  HeatmapOptions,
  HeatmapInstance
> = (el, initial) => {
  let opts: HeatmapOptions = mergeOptions(
    defaultHeatmapOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };
  /** The ramp drawn: the one given, else one picked by `zScore`. */
  const rampName = () => matrixRamp(opts.colormap, opts.zScore);

  // Layout / view state.
  let width = 0;
  let height = 0;
  let shape: MatrixShape = { nrows: 0, ncols: 0 };
  let domain: [number, number] = [0, 1];
  // Values after any z-scoring, kept for tooltips (when zScore is on we show the
  // z-scored value, which is what is colored).
  let scaled: Float32Array = new Float32Array(0);
  // Set when the GPU refused the matrix, so the overlay can say so.
  let drawFailed = false;
  // The GPU's texture limit, the plans for the rows and columns of the
  // base texture (the matrix, or past the limit aligned blocks of it), and
  // its scale. The plans are null when the value column is short of the
  // matrix, which then goes up as it is and is refused.
  let maxTex = Number.POSITIVE_INFINITY;
  let basePlans: [AxisPlan, AxisPlan] | null = null;
  let baseScale: [number, number] = [1, 1];
  // Copies of the matrix pooled for views with more cells than pixels, by
  // their plans, the one drawn last at the end; a few are kept.
  const pooled = new Map<string, PooledTexture>();
  // Pending pooling for the view once a wheel or a drag lets it rest.
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  // A window of the matrix at a texel a row and column, for a view at rest
  // past the texture limit (see windowRange), and the rows and columns it
  // holds; one at a time.
  let windowTex: {
    rows: [number, number];
    cols: [number, number];
    texture: PooledTexture;
  } | null = null;
  // Where the texture the next draw reads starts, in data coordinates.
  let drawOffset: [number, number] = [0, 0];
  // The texture the next draw reads, and its scale.
  let drawTex: Texture2D | null = null;
  let drawScale: [number, number] = [1, 1];
  // Whether the matrix has a missing cell, found once per data or option
  // change, not on every pan or zoom.
  let anyMissing = false;
  // Labels already cut to a width, so a pan or zoom does not measure again.
  const fitted = new Map<string, string>();
  // Margins, sized from the longest labels and the colour bar's text.
  const margin = { top: 16, right: 84, bottom: 64, left: 96 };
  const gradId = uniqueId("plotomics-heatmap-cb");

  // View transform in UV space [0,1]: which sub-rectangle of the matrix is
  // visible. Pan/zoom mutates these; the shader maps quad UV -> data UV.
  let viewX = 0; // left edge in [0,1]
  let viewY = 0; // top edge in [0,1]
  let viewW = 1; // width in [0,1]
  let viewH = 1; // height in [0,1]

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;";
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
  // Over the matrix, in its top right corner.
  const resetButton = createResetButton(
    plot.box,
    el,
    () => resetView(),
    () => canvas,
  );

  // --- regl setup ---------------------------------------------------------
  // luminance uint8 is core WebGL1 (no float-texture extension needed).
  let regl: Regl | null = null;
  let valueTex: Texture2D | null = null;
  let lutTex: Texture2D | null = null;
  let draw: DrawCommand | null = null;
  let reglBroken = false;

  try {
    regl = createREGL({
      canvas,
      attributes: { antialias: false, preserveDrawingBuffer: true },
    });
  } catch {
    reglBroken = true;
  }

  if (regl) {
    lutTex = regl.texture({
      width: 256,
      height: 1,
      format: "rgba",
      data: buildRampLUT(rampName()),
      min: "nearest",
      mag: "nearest",
      wrapS: "clamp",
      wrapT: "clamp",
    });
    // Full-screen quad. The fragment shader reads the value texture then indexes
    // the ramp LUT. `nearest` on both keeps cell edges crisp and keeps the
    // missing level (0) from blending into the low end of the ramp.
    draw = regl({
      frag: `
        precision highp float;
        uniform sampler2D valueTex;
        uniform sampler2D lut;
        uniform vec2 texScale;
        uniform vec2 texOffset;
        varying vec2 uv;
        void main() {
          float level = floor(texture2D(valueTex, (uv - texOffset) * texScale).r * 255.0 + 0.5);
          gl_FragColor = texture2D(lut, vec2((level + 0.5) / 256.0, 0.5));
        }
      `,
      vert: `
        precision highp float;
        attribute vec2 position;
        uniform vec2 viewOrigin;
        uniform vec2 viewSize;
        varying vec2 uv;
        void main() {
          // position is a [0,1] quad corner. Map it into the visible data
          // sub-rectangle, then to clip space (flip Y so row 0 is at the top).
          vec2 quad = position;
          uv = viewOrigin + quad * viewSize;
          vec2 clip = quad * 2.0 - 1.0;
          gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        }
      `,
      attributes: {
        position: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      },
      uniforms: {
        valueTex: () => drawTex as Texture2D,
        lut: () => lutTex as Texture2D,
        viewOrigin: () => [viewX, viewY] as [number, number],
        viewSize: () => [viewW, viewH] as [number, number],
        texScale: () => drawScale,
        texOffset: () => drawOffset,
      },
      count: 4,
      primitive: "triangle strip",
      depth: { enable: false },
    });
  }

  // --- pixel geometry (overlay + interaction) -----------------------------
  const innerW = () => Math.max(1, width - margin.left - margin.right);
  const innerH = () => Math.max(1, height - margin.top - margin.bottom);

  function labelWidth(s: string, size = sizes.label): number {
    return textWidth(s, size, theme.fontFamily);
  }
  // The longest label of each label array, measured once per font.
  const longestCache = new WeakMap<string[], { font: string; w: number }>();
  /** Width of the longest label, or of the longest index when unlabelled. */
  function longestLabel(labels: string[] | undefined, n: number): number {
    if (!labels) return labelWidth(String(Math.max(0, n - 1)));
    const font = `${sizes.label}px ${theme.fontFamily}`;
    const hit = longestCache.get(labels);
    if (hit && hit.font === font) return hit.w;
    let w = 0;
    for (const l of labels) w = Math.max(w, labelWidth(l));
    longestCache.set(labels, { font, w });
    return w;
  }
  const colorbarTitle = () =>
    opts.legendTitle ?? (opts.zScore ? "z-score" : "value");
  /**
   * From the top of the colour bar up to the baseline of its title: room
   * for the top half of a label centred on the top of the bar.
   */
  const colorbarTitleGap = () => 0.9 * sizes.label + 4;
  /**
   * Top and height of the colour bar beside a plot that starts at `y0` and
   * is `h` tall. They do not depend on the right margin, so that margin can
   * be sized from the bar's labels. The title stands over the bar, so the
   * bar starts low enough for it, and the bar is at least three labels tall.
   */
  function colorbarBox(
    y0 = margin.top,
    h = innerH(),
  ): { cbY: number; cbH: number } {
    const { label, axisTitle } = sizes;
    const minY = Math.ceil(1.1 * axisTitle + colorbarTitleGap());
    const cbH = Math.max(3 * label, Math.min(220, y0 + h - Math.max(y0, minY)));
    const cbY = Math.max(minY, y0 + (h - cbH) / 2);
    return { cbY, cbH };
  }
  /**
   * The colour bar's ticks: round values inside the colour domain, as many
   * as the bar holds a line and a half of text from each other.
   */
  function colorbarTicks(): {
    ticks: number[];
    labels: string[];
    flat: boolean;
  } {
    const { ticks, step } = fitDomainTicks(
      domain[0],
      domain[1],
      colorbarBox().cbH,
      { maxCount: 4, minGapPx: 1.6 * sizes.label, endGapPx: sizes.label + 2 },
    );
    return {
      ticks,
      labels: formatTicks(ticks, step),
      // A flat domain has one tick and no step.
      flat: !(step > 0),
    };
  }
  /**
   * Size the left and bottom margins from the longest labels, and the right
   * margin from the colour bar: the 24 px gap, the bar, its tick labels 5 px
   * right of it, and its title centred over it. A margin takes at most a
   * share of the widget, so the matrix keeps the rest; the labels are cut to
   * fit.
   */
  function fitMargins() {
    const k = sizes.label / DEFAULT_SIZES.label;
    const lo = Math.round(MIN_LABEL_MARGIN * k);
    const hi = Math.round(MAX_LABEL_MARGIN * k);
    const capW = Math.floor(width * MAX_MARGIN_SHARE);
    const capH = Math.floor(height * MAX_MARGIN_SHARE);
    const clampM = (v: number, cap: number) =>
      Math.min(cap, hi, Math.max(lo, Math.ceil(v)));
    margin.left = clampM(longestLabel(shape.rowLabels, shape.nrows) + 12, capW);
    margin.bottom = clampM(
      longestLabel(shape.colLabels, shape.ncols) + 20,
      capH,
    );
    margin.right = Math.min(capW, MIN_RIGHT_MARGIN);
    if (!opts.showColorbar) return;
    let tickW = anyMissing ? labelWidth("NA") : 0;
    for (const t of colorbarTicks().labels) {
      tickW = Math.max(tickW, labelWidth(t));
    }
    const titleW = labelWidth(colorbarTitle(), sizes.axisTitle);
    margin.right = Math.min(
      capW,
      Math.max(
        MIN_RIGHT_MARGIN,
        Math.ceil(24 + COLORBAR_W + 5 + tickW + 4),
        Math.ceil(24 + COLORBAR_W / 2 + titleW / 2 + 4),
        // A title wider than that starts 4 px right of the matrix.
        Math.ceil(4 + titleW + 4),
      ),
    );
  }
  /**
   * A label cut with an ellipsis to fit `maxW` px at `size` px. The cut
   * point is found by bisection and kept, so a long label is measured a few
   * times, once.
   */
  function fitLabel(label: string, maxW: number, size = sizes.label): string {
    const key = `${maxW}\u0000${size}\u0000${label}`;
    const hit = fitted.get(key);
    if (hit !== undefined) return hit;
    let out = label;
    if (labelWidth(label, size) > maxW) {
      let lo = 0;
      let hi = label.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (labelWidth(`${label.slice(0, mid)}\u2026`, size) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out = lo > 0 ? `${label.slice(0, lo)}\u2026` : "";
    }
    fitted.set(key, out);
    return out;
  }

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = `${margin.left}px`;
    canvas.style.top = `${margin.top}px`;
    canvas.style.width = `${innerW()}px`;
    canvas.style.height = `${innerH()}px`;
    canvas.width = Math.round(innerW() * ratio);
    canvas.height = Math.round(innerH() * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    resetButton.place(
      { left: margin.left, top: margin.top, width: innerW(), height: innerH() },
      theme,
    );
  }

  function computeScaled(): Float32Array {
    const raw = data.columns.values as ArrayLike<number> | undefined;
    if (!raw || raw.length === 0) {
      anyMissing = false;
      return new Float32Array(0);
    }
    // Copy into a Float32Array so tooltip lookups and domain share one source,
    // reading R's null as missing (a Float32Array would store it as 0).
    const values = toFloat32(raw);
    const out = opts.zScore
      ? zScoreRows(values, shape.nrows, shape.ncols)
      : values;
    anyMissing = out.some((v) => !Number.isFinite(v));
    return out;
  }

  function uploadMatrix() {
    drawFailed = false;
    dropPooled();
    basePlans = null;
    const n = scaled.length;
    if (n === 0 || shape.nrows === 0 || shape.ncols === 0) {
      valueTex?.destroy();
      valueTex = null;
      return;
    }
    domain = colorDomain(scaled, {
      vmin: opts.vmin,
      vmax: opts.vmax,
      diverging: isDivergingRamp(rampName()),
    });
    if (!regl || reglBroken) return;
    maxTex = Math.max(1, regl.limits.maxTextureSize);
    // Past the GPU's texture limit, mean-pool rows and columns down to it
    // in aligned blocks. Pooling needs the whole matrix; a short value
    // column goes up as it is, and the GPU refuses it.
    const whole = n === shape.nrows * shape.ncols;
    const limit = whole ? maxTex : Number.POSITIVE_INFINITY;
    const rows = basePlan(shape.nrows, limit);
    const cols = basePlan(shape.ncols, limit);
    basePlans = whole ? [rows, cols] : null;
    baseScale = [cols.scale, rows.scale];
    const texOpts = textureOptions(
      levelsFor(rows, cols),
      rows.count,
      cols.count,
    );
    try {
      if (valueTex) valueTex(texOpts);
      else valueTex = regl.texture(texOpts);
    } catch {
      // The GPU refused the texture (out of memory, or a limit regl checks
      // that the pooling did not cover): draw the overlay and say so.
      valueTex?.destroy();
      valueTex = null;
      drawFailed = true;
    }
  }

  /** The matrix as texture levels, mean-pooled as the plans say. */
  function levelsFor(rows: AxisPlan, cols: AxisPlan): Uint8Array {
    const values =
      rows.count < shape.nrows || cols.count < shape.ncols
        ? poolBlocks(
            scaled,
            shape.nrows,
            shape.ncols,
            blocksFor(rows, shape.nrows),
            blocksFor(cols, shape.ncols),
          )
        : scaled;
    return normalizeToU8(values, domain[0], domain[1]);
  }

  /**
   * The texture for the current view: the base texture while each row and
   * column in view has a device pixel or more, else the matrix pooled to
   * about a texel a pixel (see {@link axisPlan}), so that no row or column
   * falls between the pixels.
   *
   * Pooling reads the whole matrix, tens of milliseconds for ten million
   * cells, and each wheel step asks for a new size. So while a wheel or a
   * drag `moving` the view, a texture already built stands in (see
   * {@link standIn}), and the view's own texture is pooled once the view
   * rests for SETTLE_MS. A few pooled copies are kept, the one for the
   * whole matrix always among them, until the matrix or its colours change,
   * so a pan or a zoom back draws without pooling. Past the texture limit, a
   * view whose rows and columns each have a pixel draws from a window of the
   * matrix at a texel a row (see {@link windowRange}), built at rest.
   */
  function viewTexture(moving: boolean): PooledTexture {
    const base: PooledTexture = {
      tex: valueTex as Texture2D,
      rows: basePlans?.[0] ?? basePlan(shape.nrows, Number.POSITIVE_INFINITY),
      cols: basePlans?.[1] ?? basePlan(shape.ncols, Number.POSITIVE_INFINITY),
      scale: baseScale,
      offset: [0, 0],
    };
    if (!regl || !basePlans) return base;
    // The texture for the whole matrix fits every view, so it is the one a
    // moving view can always stand on. Pooled textures are dropped when the
    // matrix or its colours change, and its size follows the plot's, so
    // each render at rest builds it again when it is missing.
    const wholeRows = axisPlan(shape.nrows, 1, canvas.height, maxTex);
    const wholeCols = axisPlan(shape.ncols, 1, canvas.width, maxTex);
    const whole = `${wholeRows.key}x${wholeCols.key}`;
    const wholeIsBase =
      wholeRows.key === basePlans[0].key && wholeCols.key === basePlans[1].key;
    if (!moving && !wholeIsBase && !pooled.has(whole)) {
      pooled.set(whole, pooledTexture(wholeRows, wholeCols));
    }
    // Past the texture limit, rows that each have a pixel come from a
    // window at a texel a row. It is drawn whenever it holds the view, a
    // moving one too, and built only at rest.
    const win = viewWindow();
    if (win) {
      if (windowTex && holdsView(windowTex)) return windowTex.texture;
      if (!moving) {
        windowTex?.texture.tex.destroy();
        windowTex = { ...win, texture: windowTexture(win.rows, win.cols) };
        return windowTex.texture;
      }
      settleLater();
    }
    const rows = axisPlan(shape.nrows, viewH, canvas.height, maxTex);
    const cols = axisPlan(shape.ncols, viewW, canvas.width, maxTex);
    if (rows.key === basePlans[0].key && cols.key === basePlans[1].key) {
      return base;
    }
    const key = `${rows.key}x${cols.key}`;
    let hit = pooled.get(key);
    if (hit) pooled.delete(key);
    else if (moving) {
      settleLater();
      return standIn(base);
    } else hit = pooledTexture(rows, cols);
    pooled.set(key, hit);
    // Drop the copies drawn longest ago, but not the one for the whole
    // matrix.
    for (const [oldKey, old] of pooled) {
      if (pooled.size <= MAX_POOLED) break;
      if (oldKey === whole || oldKey === key) continue;
      old.tex.destroy();
      pooled.delete(oldKey);
    }
    return hit;
  }

  /** The matrix pooled by the given plans, as a texture. */
  function pooledTexture(rows: AxisPlan, cols: AxisPlan): PooledTexture {
    return {
      tex: (regl as Regl).texture(
        textureOptions(levelsFor(rows, cols), rows.count, cols.count),
      ),
      rows,
      cols,
      scale: [cols.scale, rows.scale],
      offset: [0, 0],
    };
  }

  /**
   * The window the view wants: past the texture limit on either axis, when
   * the rows and columns in view each have a pixel; else null.
   */
  function viewWindow(): {
    rows: [number, number];
    cols: [number, number];
  } | null {
    if (!basePlans || (basePlans[0].size <= 1 && basePlans[1].size <= 1)) {
      return null;
    }
    const rows = windowRange(shape.nrows, viewY, viewH, canvas.height, maxTex);
    const cols = windowRange(shape.ncols, viewX, viewW, canvas.width, maxTex);
    return rows && cols ? { rows, cols } : null;
  }

  /** Whether a window holds every row and column in view. */
  function holdsView(w: {
    rows: [number, number];
    cols: [number, number];
  }): boolean {
    const [r0, r1] = rowsInView(shape.nrows, viewY, viewH);
    const [c0, c1] = rowsInView(shape.ncols, viewX, viewW);
    return (
      w.rows[0] <= r0 && r1 <= w.rows[1] && w.cols[0] <= c0 && c1 <= w.cols[1]
    );
  }

  /**
   * The rows `rows` and columns `cols` of the matrix as a texture, a texel
   * each, placed over them by its offset and scale.
   */
  function windowTexture(
    rows: [number, number],
    cols: [number, number],
  ): PooledTexture {
    const [r0, r1] = rows;
    const [c0, c1] = cols;
    const h = r1 - r0;
    const w = c1 - c0;
    const cells = new Float32Array(h * w);
    for (let r = 0; r < h; r += 1) {
      const from = (r0 + r) * shape.ncols + c0;
      cells.set(scaled.subarray(from, from + w), r * w);
    }
    const plan = (n: number, count: number): AxisPlan => ({
      key: "w",
      count,
      size: 1,
      scale: n / count,
    });
    return {
      tex: (regl as Regl).texture(
        textureOptions(normalizeToU8(cells, domain[0], domain[1]), h, w),
      ),
      rows: plan(shape.nrows, h),
      cols: plan(shape.ncols, w),
      scale: [shape.ncols / w, shape.nrows / h],
      offset: [c0 / shape.ncols, r0 / shape.nrows],
    };
  }

  /**
   * The texture to draw while the view moves: of those already built, the
   * finest whose rows and columns in view each still have a pixel, so no
   * row falls between the pixels; the coarsest when none of them does.
   */
  function standIn(base: PooledTexture): PooledTexture {
    const fits = (t: PooledTexture) =>
      t.rows.count * viewH <= canvas.height + 1e-9 &&
      t.cols.count * viewW <= canvas.width + 1e-9;
    const cells = (t: PooledTexture) => t.rows.count * t.cols.count;
    let best: PooledTexture | null = null;
    let coarsest = base;
    for (const t of [base, ...pooled.values()]) {
      if (fits(t) && (!best || cells(t) > cells(best))) best = t;
      if (cells(t) < cells(coarsest)) coarsest = t;
    }
    return best ?? coarsest;
  }

  /** Pool the view's own texture once the view has rested. */
  function settleLater() {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      render();
    }, SETTLE_MS);
  }

  function dropPooled() {
    for (const p of pooled.values()) p.tex.destroy();
    pooled.clear();
    windowTex?.texture.tex.destroy();
    windowTex = null;
  }

  function rebuildLUT() {
    if (!regl || reglBroken || !lutTex) return;
    lutTex({
      width: 256,
      height: 1,
      format: "rgba",
      data: buildRampLUT(rampName()),
      min: "nearest",
      mag: "nearest",
      wrapS: "clamp",
      wrapT: "clamp",
    });
  }

  /**
   * The theme background as a WebGL clear colour, premultiplied by its alpha
   * as the canvas expects. Clear for a background that paints nothing.
   */
  function clearColour(): [number, number, number, number] {
    const rgba = colourBytes(theme.background, el);
    if (!rgba) return [0, 0, 0, 0];
    const a = rgba[3] / 255;
    return [(rgba[0] / 255) * a, (rgba[1] / 255) * a, (rgba[2] / 255) * a, a];
  }

  /**
   * Draw the matrix and the overlay. `moving` is set while a wheel or a drag
   * moves the view, which then draws from textures already built.
   */
  function render(moving = false) {
    // The reset button shows while the view is not the whole matrix.
    resetButton.show(
      !!shape.ncols && (viewX > 0 || viewY > 0 || viewW < 1 || viewH < 1),
    );
    if (!regl || reglBroken || !draw || !valueTex) {
      // Nothing to draw on the GPU (no data, a refused matrix, or no WebGL):
      // clear what an earlier matrix left, then draw the overlay only.
      if (regl && !reglBroken) {
        try {
          regl.poll();
          regl.clear({ color: clearColour(), depth: 1 });
        } catch {
          // The overlay still says what happened.
        }
      }
      renderOverlay();
      return;
    }
    try {
      regl.poll();
      regl.clear({ color: clearColour(), depth: 1 });
      const view = viewTexture(moving);
      drawTex = view.tex;
      drawScale = view.scale;
      drawOffset = view.offset;
      draw();
    } catch {
      drawFailed = true;
    }
    renderOverlay();
  }

  function applyData() {
    shape = readShape(
      data.meta,
      (data.columns.values as ArrayLike<number> | undefined)?.length ?? 0,
    );
    fitted.clear();
    scaled = computeScaled();
    // Reset the view to the full matrix on new data.
    viewX = 0;
    viewY = 0;
    viewW = 1;
    viewH = 1;
    uploadMatrix();
    // The right margin holds the colour bar's values, so the margins are
    // sized once the colour domain is known.
    fitMargins();
    layoutCanvas();
    render();
  }

  // --- overlay: frame + colorbar + tick labels ----------------------------
  /**
   * Draw the overlay, then give every colour in it that the page cannot
   * read the value "none", as the canvas leaves such marks out (see
   * hideUnreadableColours), so the screen and the exports agree.
   */
  function renderOverlay(...args: Parameters<typeof drawOverlay>) {
    drawOverlay(...args);
    hideUnreadableColours(el, theme, svg);
  }

  function drawOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const x0 = margin.left;
    const y0 = margin.top;
    const w = innerW();
    const h = innerH();

    svg.appendChild(rect(x0, y0, w, h, "none", theme.axis, 1));
    if (scaled.length && (drawFailed || reglBroken)) {
      svg.appendChild(
        text(
          x0 + w / 2,
          y0 + h / 2,
          "The matrix could not be drawn with WebGL here.",
          theme.muted,
          "middle",
          sizes.label,
        ),
      );
    }

    // Without values there is nothing to label or key.
    if (shape.nrows > 0 && shape.ncols > 0 && scaled.length) {
      renderColTicks(x0, y0, w, h);
      renderRowTicks(x0, y0, h);
    }
    if (opts.showColorbar && scaled.length) renderColorbar(x0, y0, h);
    // A label with no room at all is cut to nothing; drop its element.
    for (const t of Array.from(svg.querySelectorAll("text"))) {
      if (!t.textContent) t.remove();
    }
  }

  // Columns run left->right; the current view spans [viewX, viewX+viewW].
  // Labels are thinned to every k-th column by the cell width; k counts from
  // column 0, so the labelled columns do not jump while panning.
  function renderColTicks(x0: number, y0: number, w: number, h: number) {
    const { ncols, colLabels } = shape;
    const size = sizes.label;
    const every = labelEvery(w / (ncols * viewW), size + 2);
    if (!every) return;
    const firstCol = Math.max(0, Math.floor(viewX * ncols));
    const lastCol = Math.min(ncols - 1, Math.ceil((viewX + viewW) * ncols) - 1);
    const start = Math.ceil(firstCol / every) * every;
    const maxW = margin.bottom - 18;
    for (let c = start; c <= lastCol; c += every) {
      const uv = (c + 0.5) / ncols;
      const px = x0 + ((uv - viewX) / viewW) * w;
      if (px < x0 - 1 || px > x0 + w + 1) continue;
      const label = fitLabel(colLabels?.[c] ?? String(c), maxW);
      const t = text(px, y0 + h + 14, label, theme.foreground, "end", size);
      t.setAttribute("transform", `rotate(-90 ${px} ${y0 + h + 14})`);
      svg.appendChild(t);
    }
  }

  // Rows run top->bottom; the current view spans [viewY, viewY+viewH].
  function renderRowTicks(x0: number, y0: number, h: number) {
    const { nrows, rowLabels } = shape;
    const size = sizes.label;
    const every = labelEvery(h / (nrows * viewH), size + 2);
    if (!every) return;
    const firstRow = Math.max(0, Math.floor(viewY * nrows));
    const lastRow = Math.min(nrows - 1, Math.ceil((viewY + viewH) * nrows) - 1);
    const start = Math.ceil(firstRow / every) * every;
    const maxW = margin.left - 10;
    for (let r = start; r <= lastRow; r += every) {
      const uv = (r + 0.5) / nrows;
      const py = y0 + ((uv - viewY) / viewH) * h;
      if (py < y0 - 1 || py > y0 + h + 1) continue;
      const label = fitLabel(rowLabels?.[r] ?? String(r), maxW);
      svg.appendChild(
        text(x0 - 6, py + 0.35 * size, label, theme.foreground, "end", size),
      );
    }
  }

  function renderColorbar(x0: number, y0: number, h: number) {
    const { label, axisTitle } = sizes;
    const cbX = x0 + innerW() + 24;
    const { cbY, cbH } = colorbarBox(y0, h);
    const fn = ramp(rampName());
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

    svg.appendChild(
      rect(cbX, cbY, COLORBAR_W, cbH, `url(#${gradId})`, theme.axis, 1),
    );

    // Round values inside the colour domain, each centred on its place
    // along the bar, by a short tick. The labels and the title are cut to
    // the widget.
    const tx = cbX + COLORBAR_W + 5;
    const [lo, hi] = domain;
    const bar = colorbarTicks();
    bar.ticks.forEach((v, i) => {
      // The top of the bar is hi, also when a reversed domain puts it
      // below lo. The one tick of a flat domain sits in the middle.
      const y = cbY + (bar.flat ? 0.5 : (hi - v) / (hi - lo)) * cbH;
      svg.appendChild(
        rect(cbX + COLORBAR_W, y - 0.5, 3, 1, theme.axis, "none", 0),
      );
      svg.appendChild(
        text(
          tx,
          y + 0.35 * label,
          fitLabel(bar.labels[i] ?? "", width - 2 - tx),
          theme.foreground,
          "start",
          label,
        ),
      );
    });
    // The title is centred over the bar. A longer one moves right, so it
    // does not run over the matrix, and is cut to the widget.
    const plotRight = x0 + innerW();
    const title = fitLabel(colorbarTitle(), width - 6 - plotRight, axisTitle);
    const half = labelWidth(title, axisTitle) / 2;
    const titleX = Math.min(
      Math.max(cbX + COLORBAR_W / 2, plotRight + 4 + half),
      width - 2 - half,
    );
    svg.appendChild(
      text(
        titleX,
        cbY - colorbarTitleGap(),
        title,
        theme.muted,
        "middle",
        axisTitle,
      ),
    );
    // A grey swatch for missing cells, when the matrix has any, below a
    // label centred on the bottom of the bar.
    if (anyMissing) {
      const sy = Math.min(
        cbY + cbH + Math.round(0.6 * label) + 8,
        height - Math.ceil(6 + 0.7 * label),
      );
      svg.appendChild(
        rect(cbX, sy, COLORBAR_W, 10, MISSING_COLOR, theme.axis, 1),
      );
      svg.appendChild(
        text(
          tx,
          sy + 5 + 0.36 * label,
          fitLabel("NA", width - 2 - tx),
          theme.foreground,
          "start",
          label,
        ),
      );
    }
  }

  // --- SVG element helpers -------------------------------------------------
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

  // --- interaction: pan (drag) + zoom (wheel) ------------------------------
  // Pointer -> data-UV within the plot area, accounting for the current view.
  function pointerUV(
    clientX: number,
    clientY: number,
  ): { u: number; v: number } | null {
    const r = canvas.getBoundingClientRect();
    const fx = (clientX - r.left) / (r.width || 1);
    const fy = (clientY - r.top) / (r.height || 1);
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return { u: viewX + fx * viewW, v: viewY + fy * viewH };
  }

  function clampView() {
    viewW = Math.min(1, Math.max(MIN_VIEW_SHARE, viewW));
    viewH = Math.min(1, Math.max(MIN_VIEW_SHARE, viewH));
    viewX = Math.min(1 - viewW, Math.max(0, viewX));
    viewY = Math.min(1 - viewH, Math.max(0, viewY));
  }

  const lastPointer = { x: 0, y: 0 };
  let dragging = false;
  const dragStart = { x: 0, y: 0, viewX: 0, viewY: 0 };

  const onWheel = (e: WheelEvent) => {
    if (!shape.ncols || reglBroken) return;
    e.preventDefault();
    const at = pointerUV(e.clientX, e.clientY);
    if (!at) return;
    const factor = Math.exp(e.deltaY * 0.001); // >1 zoom out, <1 zoom in
    const newW = viewW * factor;
    const newH = viewH * factor;
    // Keep the point under the cursor fixed.
    viewX = at.u - (at.u - viewX) * (newW / viewW);
    viewY = at.v - (at.v - viewY) * (newH / viewH);
    viewW = newW;
    viewH = newH;
    clampView();
    render(true);
  };

  const onDown = (e: MouseEvent) => {
    if (!shape.ncols || reglBroken) return;
    dragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragStart.viewX = viewX;
    dragStart.viewY = viewY;
  };
  const onUp = () => {
    dragging = false;
  };
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (dragging) {
      const r = canvas.getBoundingClientRect();
      const du = ((e.clientX - dragStart.x) / (r.width || 1)) * viewW;
      const dv = ((e.clientY - dragStart.y) / (r.height || 1)) * viewH;
      viewX = dragStart.viewX - du;
      viewY = dragStart.viewY - dv;
      clampView();
      render(true);
      tooltip.hide();
      return;
    }
    // The reset button covers the cell under it.
    if (resetButton.element.contains(e.target as Node | null)) {
      tooltip.hide();
      return;
    }
    showTip(e.clientX, e.clientY);
  };
  const onLeave = () => tooltip.hide();
  // A double-click goes back to the whole matrix.
  const onDblClick = () => resetView();

  /** Show the whole matrix, the home view, unless it is shown. */
  function resetView() {
    if (viewX === 0 && viewY === 0 && viewW === 1 && viewH === 1) return;
    viewX = 0;
    viewY = 0;
    viewW = 1;
    viewH = 1;
    render();
  }

  function showTip(clientX: number, clientY: number) {
    if (!shape.ncols || !shape.nrows) return;
    const at = pointerUV(clientX, clientY);
    if (!at) {
      tooltip.hide();
      return;
    }
    const col = Math.min(shape.ncols - 1, Math.floor(at.u * shape.ncols));
    const row = Math.min(shape.nrows - 1, Math.floor(at.v * shape.nrows));
    const idx = row * shape.ncols + col;
    const value = scaled[idx] as number;
    // A missing label names the cell by its row or column number.
    const rowLabel = shape.rowLabels?.[row] || `row ${row}`;
    const colLabel = shape.colLabels?.[col] || `col ${col}`;
    tooltip.show(
      `<b>${escapeHTML(rowLabel)}</b> × <b>${escapeHTML(colLabel)}</b><br/>${
        opts.zScore ? "z" : "value"
      }: ${fmt(value)}`,
      clientX,
      clientY,
    );
  }

  canvas.style.pointerEvents = "auto";
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("dblclick", onDblClick);
  window.addEventListener("mouseup", onUp);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);

  function doResize(w: number, h: number) {
    fitBox(w, h);
    // The margins take at most a share of the widget.
    fitMargins();
    layoutCanvas();
    render();
  }

  // Initial sizing from the container (or defaults when detached/headless).
  {
    const m = measure(el);
    doResize(m.width, m.height);
    if (data.columns.values) applyData();
  }

  const instance: HeatmapInstance = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      const prev = opts;
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      sizes = textSizes(theme);
      fitted.clear();
      if (rampName() !== matrixRamp(prev.colormap, prev.zScore)) rebuildLUT();
      // Re-normalize when anything affecting the color domain changed.
      if (
        opts.zScore !== prev.zScore ||
        opts.vmin !== prev.vmin ||
        opts.vmax !== prev.vmax ||
        opts.colormap !== prev.colormap
      ) {
        scaled = computeScaled();
        uploadMatrix();
      }
      // The text size and the colour bar's values set the margins.
      fitBox();
      fitMargins();
      layoutCanvas();
      render();
    },
    resize(w, h) {
      doResize(w, h);
    },
    resetView() {
      resetView();
    },
    exportSVG() {
      // Hybrid figure: rasterized GPU matrix as an <image> + vector overlay.
      const out = svg.cloneNode(true) as SVGSVGElement;
      if (regl && !reglBroken && valueTex) {
        render(); // ensure the backing buffer is current before readback
        const img = document.createElementNS(SVG_NS, "image");
        img.setAttribute("x", String(margin.left));
        img.setAttribute("y", String(margin.top));
        img.setAttribute("width", String(innerW()));
        img.setAttribute("height", String(innerH()));
        img.setAttribute("preserveAspectRatio", "none");
        img.setAttribute("href", canvas.toDataURL("image/png"));
        out.insertBefore(img, out.firstChild);
      }
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
    },
    async exportPNG(scale = 2) {
      if (!regl || reglBroken) return null;
      render(); // ensure the backing buffer is current before readback
      // The matrix at its place, with the axes and colour bar over it.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        element: el,
        layers: [
          {
            canvas,
            x: margin.left,
            y: margin.top,
            width: innerW(),
            height: innerH(),
          },
        ],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      if (settleTimer !== null) clearTimeout(settleTimer);
      dropPooled();
      valueTex?.destroy();
      lutTex?.destroy();
      releaseRegl(regl);
      plot.remove();
    },
  };

  return guardDestroy(instance);
};

// ---- small utilities ------------------------------------------------------
/**
 * A texture of the matrix, the plans it was pooled by, and its scale and
 * offset from data to texture coordinates.
 */
interface PooledTexture {
  tex: Texture2D;
  rows: AxisPlan;
  cols: AxisPlan;
  scale: [number, number];
  offset: [number, number];
}
/** Texture options for an `nrows` x `ncols` matrix of levels. */
function textureOptions(data: Uint8Array, nrows: number, ncols: number) {
  return {
    width: ncols,
    height: nrows,
    format: "luminance" as const,
    data,
    min: "nearest" as const,
    mag: "nearest" as const,
    wrapS: "clamp" as const,
    wrapT: "clamp" as const,
    flipY: false,
  };
}
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "NA";
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
function mergeOptions(
  base: HeatmapOptions,
  next?: Partial<HeatmapOptions>,
): HeatmapOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
