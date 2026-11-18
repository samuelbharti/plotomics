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
 * left out of the colour range and the z-score. A matrix larger than the
 * GPU's texture limit is mean-pooled down to the limit for drawing; the
 * tooltip still reads the cell under the cursor.
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  ramp,
  serializeSVG,
  canvasToPNG,
} from "../core/index.js";
import { releaseRegl } from "../core/gl.js";
import { uniqueId } from "../core/dom.js";
import createREGL from "regl";
import type { Regl, Texture2D, DrawCommand } from "regl";

export interface HeatmapOptions {
  /** Sequential ('viridis') or diverging ('rdbu') color ramp. */
  colormap: RampName;
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
  colormap: "viridis",
  zScore: false,
  vmin: null,
  vmax: null,
  showColorbar: true,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORBAR_W = 14;
/** Tick label font size, and the spacing a label needs to stay legible. */
const LABEL_FONT = 10;
const LABEL_MIN_PX = LABEL_FONT + 2;
/** Bounds for the label margins, which grow with the longest label. */
const MIN_LABEL_MARGIN = 40;
const MAX_LABEL_MARGIN = 120;
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
 * Mean-pool a row-major matrix by `fr` rows and `fc` columns, skipping
 * missing cells (a block with no finite cell stays missing). Used to fit a
 * matrix into the GPU's texture limit. Returns the pooled values and shape.
 */
export function poolMatrix(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
  fr: number,
  fc: number,
): { values: Float32Array; nrows: number; ncols: number } {
  const pr = Math.ceil(nrows / fr);
  const pc = Math.ceil(ncols / fc);
  const sum = new Float64Array(pr * pc);
  const cnt = new Uint32Array(pr * pc);
  for (let r = 0; r < nrows; r += 1) {
    const prow = Math.floor(r / fr) * pc;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[r * ncols + c] as number;
      if (!Number.isFinite(v)) continue;
      const k = prow + Math.floor(c / fc);
      sum[k] = (sum[k] as number) + v;
      cnt[k] = (cnt[k] as number) + 1;
    }
  }
  const out = new Float32Array(pr * pc);
  for (let k = 0; k < out.length; k += 1) {
    const n = cnt[k] as number;
    out[k] = n > 0 ? (sum[k] as number) / n : Number.NaN;
  }
  return { values: out, nrows: pr, ncols: pc };
}

/**
 * Which tick labels to draw: every one when cells are at least `minPx` tall
 * (or wide), every k-th one when they are a little tighter, and none past
 * every 4th, where the labels would no longer say which cell they name.
 * Returns k, or 0 for none.
 */
export function labelEvery(cellPx: number, minPx = LABEL_MIN_PX): number {
  if (!(cellPx > 0)) return 0;
  const k = Math.ceil(minPx / cellPx - 1e-9);
  return k <= 4 ? Math.max(1, k) : 0;
}

/**
 * Resolve the color domain [lo, hi]. Explicit vmin/vmax win; otherwise the data
 * min/max are used. For a diverging ramp the auto domain is made symmetric
 * around zero so the neutral midpoint lands on 0. NaN/Inf values are skipped.
 */
export function colorDomain(
  values: ArrayLike<number>,
  opts: { vmin: number | null; vmax: number | null; diverging: boolean },
): [number, number] {
  let lo = opts.vmin;
  let hi = opts.vmax;
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
  let data: PlotomicsData = initial.data ?? { columns: {} };

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
  // Whether the matrix has a missing cell, found once per data or option
  // change, not on every pan or zoom.
  let anyMissing = false;
  // Labels already cut to a width, so a pan or zoom does not measure again.
  const fitted = new Map<string, string>();
  // Label margins, sized from the longest labels when the data arrives.
  const margin = { top: 16, right: 84, bottom: 64, left: 96 };
  const gradId = uniqueId("plotomics-heatmap-cb");
  const measureCtx = document.createElement("canvas").getContext("2d");

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
      data: buildRampLUT(opts.colormap),
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
        valueTex: () => valueTex as Texture2D,
        lut: () => lutTex as Texture2D,
        viewOrigin: () => [viewX, viewY] as [number, number],
        viewSize: () => [viewW, viewH] as [number, number],
        texScale: () => texScale,
      },
      count: 4,
      primitive: "triangle strip",
      depth: { enable: false },
    });
  }

  // --- pixel geometry (overlay + interaction) -----------------------------
  const innerW = () => Math.max(1, width - margin.left - margin.right);
  const innerH = () => Math.max(1, height - margin.top - margin.bottom);

  function labelWidth(s: string): number {
    if (!measureCtx) return s.length * LABEL_FONT * 0.56;
    measureCtx.font = `${LABEL_FONT}px ${theme.fontFamily}`;
    return measureCtx.measureText(s).width;
  }
  /** Width of the longest label, or of the longest index when unlabelled. */
  function longestLabel(labels: string[] | undefined, n: number): number {
    if (!labels) return labelWidth(String(Math.max(0, n - 1)));
    let w = 0;
    for (const l of labels) w = Math.max(w, labelWidth(l));
    return w;
  }
  /** Size the left and bottom margins from the longest labels. */
  function fitMargins() {
    const clampM = (v: number) =>
      Math.min(MAX_LABEL_MARGIN, Math.max(MIN_LABEL_MARGIN, Math.ceil(v)));
    margin.left = clampM(longestLabel(shape.rowLabels, shape.nrows) + 12);
    margin.bottom = clampM(longestLabel(shape.colLabels, shape.ncols) + 20);
  }
  /**
   * A label cut with an ellipsis to fit `maxW` px. The cut point is found by
   * bisection and kept, so a long label is measured a few times, once.
   */
  function fitLabel(label: string, maxW: number): string {
    const key = `${maxW}\u0000${label}`;
    const hit = fitted.get(key);
    if (hit !== undefined) return hit;
    let out = label;
    if (labelWidth(label) > maxW) {
      let lo = 1;
      let hi = label.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (labelWidth(`${label.slice(0, mid)}\u2026`) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out = `${label.slice(0, lo)}\u2026`;
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
    if (!raw || raw.length === 0) return new Float32Array(0);
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
    const n = scaled.length;
    if (n === 0 || shape.nrows === 0 || shape.ncols === 0) {
      valueTex?.destroy();
      valueTex = null;
      return;
    }
    domain = colorDomain(scaled, {
      vmin: opts.vmin,
      vmax: opts.vmax,
      diverging: opts.colormap === "rdbu",
    });
    if (!regl || reglBroken) return;
    // Past the GPU's texture limit, mean-pool rows and columns down to it.
    const maxTex = Math.max(1, regl.limits.maxTextureSize);
    const fr = Math.ceil(shape.nrows / maxTex);
    const fc = Math.ceil(shape.ncols / maxTex);
    const pooled =
      fr > 1 || fc > 1
        ? poolMatrix(scaled, shape.nrows, shape.ncols, fr, fc)
        : { values: scaled, nrows: shape.nrows, ncols: shape.ncols };
    texScale = [
      shape.ncols / (pooled.ncols * fc),
      shape.nrows / (pooled.nrows * fr),
    ];
    const u8 = normalizeToU8(pooled.values, domain[0], domain[1]);
    const texOpts = {
      width: pooled.ncols,
      height: pooled.nrows,
      format: "luminance" as const,
      data: u8,
      min: "nearest" as const,
      mag: "nearest" as const,
      wrapS: "clamp" as const,
      wrapT: "clamp" as const,
      flipY: false,
    };
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

  function rebuildLUT() {
    if (!regl || reglBroken || !lutTex) return;
    lutTex({
      width: 256,
      height: 1,
      format: "rgba",
      data: buildRampLUT(opts.colormap),
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
    fitMargins();
    layoutCanvas();
    scaled = computeScaled();
    // Reset the view to the full matrix on new data.
    viewX = 0;
    viewY = 0;
    viewW = 1;
    viewH = 1;
    uploadMatrix();
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
          11,
        ),
      );
    }

    if (shape.nrows > 0 && shape.ncols > 0) {
      renderColTicks(x0, y0, w, h);
      renderRowTicks(x0, y0, h);
    }
    if (opts.showColorbar) renderColorbar(x0, y0, h);
  }

  // Columns run left->right; the current view spans [viewX, viewX+viewW].
  // Labels are thinned to every k-th column by the cell width; k counts from
  // column 0, so the labelled columns do not jump while panning.
  function renderColTicks(x0: number, y0: number, w: number, h: number) {
    const { ncols, colLabels } = shape;
    const every = labelEvery(w / (ncols * viewW));
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
      const t = text(
        px,
        y0 + h + 14,
        label,
        theme.foreground,
        "end",
        LABEL_FONT,
      );
      t.setAttribute("transform", `rotate(-90 ${px} ${y0 + h + 14})`);
      svg.appendChild(t);
    }
  }

  // Rows run top->bottom; the current view spans [viewY, viewY+viewH].
  function renderRowTicks(x0: number, y0: number, h: number) {
    const { nrows, rowLabels } = shape;
    const every = labelEvery(h / (nrows * viewH));
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
        text(x0 - 6, py + 3, label, theme.foreground, "end", LABEL_FONT),
      );
    }
  }

  function renderColorbar(x0: number, y0: number, h: number) {
    const cbX = x0 + innerW() + 24;
    const cbH = Math.min(h, 220);
    const cbY = y0 + (h - cbH) / 2;
    const fn = ramp(opts.colormap);
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

    const mid = (domain[0] + domain[1]) / 2;
    svg.appendChild(
      text(
        cbX + COLORBAR_W + 5,
        cbY + 4,
        fmt(domain[1]),
        theme.foreground,
        "start",
        10,
      ),
    );
    svg.appendChild(
      text(
        cbX + COLORBAR_W + 5,
        cbY + cbH / 2 + 3,
        fmt(mid),
        theme.foreground,
        "start",
        10,
      ),
    );
    svg.appendChild(
      text(
        cbX + COLORBAR_W + 5,
        cbY + cbH,
        fmt(domain[0]),
        theme.foreground,
        "start",
        10,
      ),
    );
    svg.appendChild(
      text(
        cbX + COLORBAR_W / 2,
        cbY - 8,
        opts.zScore ? "z-score" : "value",
        theme.muted,
        "middle",
        10,
      ),
    );
    // A grey swatch for missing cells, when the matrix has any.
    if (anyMissing) {
      const sy = Math.min(cbY + cbH + 14, height - 14);
      svg.appendChild(
        rect(cbX, sy, COLORBAR_W, 10, MISSING_COLOR, theme.axis, 1),
      );
      svg.appendChild(
        text(cbX + COLORBAR_W + 5, sy + 9, "NA", theme.foreground, "start", 10),
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
    size = 11,
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
      if (opts.colormap !== prev.colormap) rebuildLUT();
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
      render();
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
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
