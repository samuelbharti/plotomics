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
 * A missing cell (NaN from Python, null from R) is drawn in a neutral grey and
 * left out of the colour range and the z-score. A matrix with more rows or
 * columns than the GPU's texture limit, or than the plot has pixels, is
 * pooled for drawing, each block keeping the cell farthest from the block's
 * mean, so a lone outlier row still shows; the tooltip still reads the cell
 * under the cursor.
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
  type Tooltip,
  measure,
  dpr,
  ramp,
  isDivergingRamp,
  matrixRamp,
  serializeSVG,
  compositePNG,
} from "../core/index.js";
import { releaseRegl } from "../core/gl.js";
import { uniqueId } from "../core/dom.js";
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
  theme: Partial<PlotomicsTheme>;
}

export const defaultHeatmapOptions: HeatmapOptions = {
  colormap: null,
  zScore: false,
  vmin: null,
  vmax: null,
  showColorbar: true,
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

/** Read {nrows, ncols, rowLabels, colLabels} from a meta object, defaulting
 * shape to a single row spanning the value column when absent. */
export function readShape(
  meta: Record<string, unknown> | undefined,
  valueCount: number,
): MatrixShape {
  const nrows = Math.max(0, Math.trunc(Number(meta?.nrows ?? 0)) || 0);
  const ncols = Math.max(0, Math.trunc(Number(meta?.ncols ?? 0)) || 0);
  const rowLabels = Array.isArray(meta?.rowLabels)
    ? (meta.rowLabels as unknown[]).map(String)
    : undefined;
  const colLabels = Array.isArray(meta?.colLabels)
    ? (meta.colLabels as unknown[]).map(String)
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
 * Pool a row-major matrix of texture levels (see {@link normalizeToU8}) by
 * `fr` rows and `fc` columns, for a texture within the GPU's limit or a view
 * with more cells than pixels. Each block keeps the level farthest from the
 * mean of its block, so a lone outlier row or column still shows when its
 * block is drawn as one pixel: a block mean would fade it by the block size,
 * and a block maximum would hide a low one. Level 0 (a missing cell) is left
 * out, and a block with no other level stays missing.
 */
export function poolLevels(
  levels: ArrayLike<number>,
  nrows: number,
  ncols: number,
  fr: number,
  fc: number,
): { values: Uint8Array; nrows: number; ncols: number } {
  const pr = Math.ceil(nrows / fr);
  const pc = Math.ceil(ncols / fc);
  // Levels are whole numbers up to 255, so the sums are exact.
  const sum = new Uint32Array(pr * pc);
  const cnt = new Uint32Array(pr * pc);
  for (let r = 0; r < nrows; r += 1) {
    const prow = Math.floor(r / fr) * pc;
    for (let c = 0; c < ncols; c += 1) {
      const v = levels[r * ncols + c] as number;
      if (v === 0) continue;
      const k = prow + Math.floor(c / fc);
      sum[k] = (sum[k] as number) + v;
      cnt[k] = (cnt[k] as number) + 1;
    }
  }
  const out = new Uint8Array(pr * pc);
  for (let r = 0; r < nrows; r += 1) {
    const prow = Math.floor(r / fr) * pc;
    for (let c = 0; c < ncols; c += 1) {
      const v = levels[r * ncols + c] as number;
      if (v === 0) continue;
      const k = prow + Math.floor(c / fc);
      const mean = (sum[k] as number) / (cnt[k] as number);
      const kept = out[k] as number;
      if (kept === 0 || Math.abs(v - mean) > Math.abs(kept - mean)) {
        out[k] = v;
      }
    }
  }
  return { values: out, nrows: pr, ncols: pc };
}

/**
 * The pooling step for `cells` rows (or columns) shown across `px` device
 * pixels: 1 while each cell has a pixel or more, else the smallest power of
 * two that leaves one pooled cell a pixel or fewer. Every pooled cell then
 * covers a pixel centre, so none falls between the pixels that sample them.
 */
export function poolStep(cells: number, px: number): number {
  const perPx = cells / Math.max(1, px);
  if (!(perPx > 1)) return 1;
  return 2 ** Math.ceil(Math.log2(perPx) - 1e-9);
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
  if (lo === hi) {
    // Degenerate domain: widen so the shader division is well-defined.
    lo -= 0.5;
    hi += 0.5;
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

export const createHeatmap: PlotomicsFactory<HeatmapOptions> = (
  el,
  initial,
) => {
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
  // Texture coordinates per data coordinate: below 1 when the matrix was
  // pooled into a texture whose blocks run past the last row or column.
  let texScale: [number, number] = [1, 1];
  // Set when the GPU refused the matrix, so the overlay can say so.
  let drawFailed = false;
  // The matrix as texture levels at full size, kept to pool coarser copies
  // from, and the pooling the GPU's texture limit set for the base texture.
  let levelBytes: Uint8Array | null = null;
  let baseStep: [number, number] = [1, 1];
  // Copies of the matrix pooled for views with more cells than pixels, by
  // pooling step, built as pan and zoom first need them.
  const pooled = new Map<string, PooledTexture>();
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
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

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
        varying vec2 uv;
        void main() {
          float level = floor(texture2D(valueTex, uv * texScale).r * 255.0 + 0.5);
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
  const colorbarTitle = () => (opts.zScore ? "z-score" : "value");
  /** The colour bar's values: high end, middle, low end. */
  const colorbarValues = (): [number, number, number] => [
    domain[1],
    (domain[0] + domain[1]) / 2,
    domain[0],
  ];
  /** The colour bar's tick labels: high end, middle, low end. */
  function colorbarTicks(): string[] {
    return colorbarValues().map(fmt);
  }
  /**
   * `v` as text that fits `maxW` px: as the colour bar writes it, else to
   * three significant digits or whole, and cut only when none fits.
   */
  function fitValue(v: number, maxW: number): string {
    const forms = [fmt(v)];
    if (Number.isFinite(v) && Math.abs(v) >= 1) {
      forms.push(String(Number(v.toPrecision(3))), String(Math.round(v)));
    }
    for (const s of forms) if (labelWidth(s) <= maxW) return s;
    return fitLabel(forms[forms.length - 1] as string, maxW);
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
    for (const t of colorbarTicks()) tickW = Math.max(tickW, labelWidth(t));
    const titleW = labelWidth(colorbarTitle(), sizes.axisTitle);
    margin.right = Math.min(
      capW,
      Math.max(
        MIN_RIGHT_MARGIN,
        Math.ceil(24 + COLORBAR_W + 5 + tickW + 4),
        Math.ceil(24 + COLORBAR_W / 2 + titleW / 2 + 4),
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
    levelBytes = null;
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
    const bytes = normalizeToU8(scaled, domain[0], domain[1]);
    // Pooling needs the whole matrix; a short value column goes up as it
    // is, and the GPU refuses it.
    const whole = bytes.length === shape.nrows * shape.ncols;
    levelBytes = whole ? bytes : null;
    // Past the GPU's texture limit, pool rows and columns down to it.
    const maxTex = Math.max(1, regl.limits.maxTextureSize);
    const fr = Math.ceil(shape.nrows / maxTex);
    const fc = Math.ceil(shape.ncols / maxTex);
    baseStep = [fr, fc];
    const base =
      whole && (fr > 1 || fc > 1)
        ? poolLevels(bytes, shape.nrows, shape.ncols, fr, fc)
        : { values: bytes, nrows: shape.nrows, ncols: shape.ncols };
    texScale = [
      shape.ncols / (base.ncols * fc),
      shape.nrows / (base.nrows * fr),
    ];
    const texOpts = textureOptions(base);
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

  /**
   * The texture for the current view, and its scale: the base texture while
   * each of its cells has a device pixel or more, else a copy pooled by a
   * power of two on each axis, so that no row or column falls between the
   * pixels. Pooled copies are kept until the matrix or its colours change.
   */
  function viewTexture(): PooledTexture {
    const base = { tex: valueTex as Texture2D, scale: texScale };
    const bytes = levelBytes;
    if (!regl || !bytes) return base;
    const [fr0, fc0] = baseStep;
    const sr = poolStep((shape.nrows * viewH) / fr0, canvas.height);
    const sc = poolStep((shape.ncols * viewW) / fc0, canvas.width);
    if (sr === 1 && sc === 1) return base;
    const key = `${sr}x${sc}`;
    let hit = pooled.get(key);
    if (!hit) {
      const fr = fr0 * sr;
      const fc = fc0 * sc;
      const p = poolLevels(bytes, shape.nrows, shape.ncols, fr, fc);
      hit = {
        tex: regl.texture(textureOptions(p)),
        scale: [shape.ncols / (p.ncols * fc), shape.nrows / (p.nrows * fr)],
      };
      pooled.set(key, hit);
    }
    return hit;
  }

  function dropPooled() {
    for (const p of pooled.values()) p.tex.destroy();
    pooled.clear();
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

  function render() {
    if (!regl || reglBroken || !draw || !valueTex) {
      // Nothing to draw on the GPU (no data, a refused matrix, or no WebGL):
      // clear what an earlier matrix left, then draw the overlay only.
      if (regl && !reglBroken) {
        try {
          regl.poll();
          regl.clear({ color: [1, 1, 1, 1], depth: 1 });
        } catch {
          // The overlay still says what happened.
        }
      }
      renderOverlay();
      return;
    }
    try {
      regl.poll();
      regl.clear({ color: [1, 1, 1, 1], depth: 1 });
      const view = viewTexture();
      drawTex = view.tex;
      drawScale = view.scale;
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
  function renderOverlay() {
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
    // The title stands over the bar, so the bar starts low enough for it.
    // The bar is tall enough that its three labels do not touch.
    const titleGap = 0.4 * label + 6;
    const minY = Math.ceil(1.1 * axisTitle + titleGap);
    const cbH = Math.max(3 * label, Math.min(220, y0 + h - Math.max(y0, minY)));
    const cbY = Math.max(minY, y0 + (h - cbH) / 2);
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

    // The labels and the title are cut to the widget.
    const tx = cbX + COLORBAR_W + 5;
    const [hiTick, midTick, loTick] = colorbarValues().map((v) =>
      fitValue(v, width - 2 - tx),
    ) as [string, string, string];
    svg.appendChild(
      text(tx, cbY + 0.4 * label, hiTick, theme.foreground, "start", label),
    );
    svg.appendChild(
      text(
        tx,
        cbY + cbH / 2 + 0.3 * label,
        midTick,
        theme.foreground,
        "start",
        label,
      ),
    );
    svg.appendChild(
      text(tx, cbY + cbH, loTick, theme.foreground, "start", label),
    );
    svg.appendChild(
      text(
        cbX + COLORBAR_W / 2,
        cbY - titleGap,
        fitLabel(
          colorbarTitle(),
          2 * (width - 2 - cbX - COLORBAR_W / 2),
          axisTitle,
        ),
        theme.muted,
        "middle",
        axisTitle,
      ),
    );
    // A grey swatch for missing cells, when the matrix has any.
    if (anyMissing) {
      const sy = Math.min(cbY + cbH + 14, height - Math.ceil(6 + 0.7 * label));
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
    viewW = Math.min(1, Math.max(1e-4, viewW));
    viewH = Math.min(1, Math.max(1e-4, viewH));
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
    render();
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
      render();
      tooltip.hide();
      return;
    }
    showTip(e.clientX, e.clientY);
  };
  const onLeave = () => tooltip.hide();

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
    const rowLabel = shape.rowLabels?.[row] ?? `row ${row}`;
    const colLabel = shape.colLabels?.[col] ?? `col ${col}`;
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
  window.addEventListener("mouseup", onUp);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);

  function doResize(w: number, h: number) {
    width = w;
    height = h;
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

  const instance: PlotomicsInstance<HeatmapOptions> = {
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
      fitMargins();
      layoutCanvas();
      render();
    },
    resize(w, h) {
      doResize(w, h);
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
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      if (!regl || reglBroken) return null;
      render(); // ensure the backing buffer is current before readback
      // The matrix at its place, with the axes and colour bar over it.
      return compositePNG({
        width,
        height,
        scale,
        background: theme.background,
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
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      dropPooled();
      valueTex?.destroy();
      lutTex?.destroy();
      releaseRegl(regl);
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ------------------------------------------------------
/** A texture of the matrix, and the scale from data to texture coordinates. */
interface PooledTexture {
  tex: Texture2D;
  scale: [number, number];
}
/** Texture options for a matrix of levels, one texel per cell. */
function textureOptions(m: {
  values: Uint8Array;
  nrows: number;
  ncols: number;
}) {
  return {
    width: m.ncols,
    height: m.nrows,
    format: "luminance" as const,
    data: m.values,
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
