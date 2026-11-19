/**
 * Hi-C contact matrix — a symmetric genomic contact map rendered on the GPU.
 *
 * Chromatin contact matrices are large (thousands of bins per axis, i.e.
 * millions of cells) and heavily skewed, so the intensity is shown on a log
 * scale with a perceptually-uniform sequential colormap. Each level of the
 * matrix is normalized on the CPU into an 8-bit single-channel texture (byte 0
 * is "no data", bytes 1-255 span the color scale) and drawn as one textured
 * quad via `regl`; the colormap lookup runs in the fragment shader, so pan/zoom
 * is just a UV-space affine transform (no per-cell DOM, no re-upload). 8-bit
 * textures need no WebGL extension, unlike float textures. A precomputed
 * level-of-detail (LOD) pyramid of mean-pooled downsamples keeps very large
 * matrices smooth: at each zoom level the coarsest texture whose resolution
 * still exceeds the viewport is sampled, and levels larger than the GPU's
 * maximum texture size are skipped.
 *
 * SVG is reserved for the low-cardinality overlay only: genomic coordinate
 * ticks along both axes and a colorbar legend. The data interface is designed
 * so multi-resolution / binned tiles could later feed the same renderer — it
 * consumes a dense row-major matrix (or a sparse i/j/v triplet that is filled
 * symmetric into a dense buffer) and needs no tile server (no HiGlass).
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
  resolveTheme,
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
  RAMPS,
  type RGB,
} from "../core/index.js";
import { releaseRegl } from "../core/gl.js";
import createREGL from "regl";
import type { Regl, Texture2D, DrawCommand } from "regl";

/** Any colour ramp of the core: "viridis", "rdbu", "ltc" or "ltcdiv". */
export type HicColormap = RampName;
export type HicTransform = "log" | "linear";

export interface HicOptions {
  /**
   * Colormap for intensity: sequential `"viridis"` or `"ltc"`, or diverging
   * `"rdbu"` or `"ltcdiv"`.
   */
  colormap: HicColormap;
  /** Intensity transform applied before color mapping. */
  transform: HicTransform;
  /** Upper clip of the intensity scale; null auto-picks a high percentile. */
  vmax: number | null;
  /**
   * Lower clip of the intensity scale. With the log transform, or when `vmin`
   * is 0 or more, values at or below it are drawn as background (no
   * contacts). With the linear transform and a negative `vmin` (for example
   * observed/expected log2 ratios), values below it take the lowest color.
   */
  vmin: number;
  /** Percentile (0-1) used for auto vmax when `vmax` is null. */
  vmaxPercentile: number;
  /** Treat the matrix as symmetric (mirror sparse i/j/v across the diagonal). */
  symmetric: boolean;
  /** Axis title / chromosome label. */
  label: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultHicOptions: HicOptions = {
  colormap: "viridis",
  transform: "log",
  vmax: null,
  vmin: 0,
  vmaxPercentile: 0.99,
  symmetric: true,
  label: "",
  theme: {},
};

/** Margins at the least; the text of the axes and colour bar can widen them. */
const MARGIN = { top: 16, right: 96, bottom: 46, left: 60 };
/** The largest share of the widget's width or height that a margin takes. */
const MAX_MARGIN_SHARE = 0.35;
const SVG_NS = "http://www.w3.org/2000/svg";
const COLORBAR_W = 14;
const COLORMAP_SIZE = 256;
/** Smallest zoom window, in bins (or the whole matrix when it is smaller). */
const MIN_VIEW_BINS = 4;

let hicSeq = 0;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/hic.test.ts)
// ---------------------------------------------------------------------------

/** Read `n` from meta (or infer from a dense column length). */
export function matrixSize(
  meta: Record<string, unknown> | undefined,
  denseLength?: number,
): number {
  const n = meta?.n;
  if (typeof n === "number" && n > 0) return Math.floor(n);
  if (denseLength && denseLength > 0) {
    const s = Math.round(Math.sqrt(denseLength));
    if (s * s === denseLength) return s;
  }
  return 0;
}

/**
 * Build a dense row-major `Float32Array` of length n*n from a sparse COO
 * triplet. When `symmetric`, each (i,j) also fills (j,i). Out-of-range indices
 * are skipped rather than throwing so a partially-specified upper triangle is
 * accepted.
 */
export function densifySymmetric(
  i: ArrayLike<number>,
  j: ArrayLike<number>,
  v: ArrayLike<number>,
  n: number,
  symmetric = true,
): Float32Array {
  const out = new Float32Array(n * n);
  const m = Math.min(i.length, j.length, v.length);
  for (let k = 0; k < m; k += 1) {
    const r = i[k] as number;
    const c = j[k] as number;
    // A missing value (null, which is how R's JSON sends NA) is NaN, not 0.
    const raw = v[k] as number | null | undefined;
    const val = raw == null ? Number.NaN : raw;
    if (r < 0 || r >= n || c < 0 || c >= n) continue;
    out[r * n + c] = val;
    if (symmetric) out[c * n + r] = val;
  }
  return out;
}

/**
 * Approximate an upper percentile of the strictly positive, finite entries via
 * a fixed log-spaced histogram — O(len) with no allocation of a sorted copy, so
 * it scales to millions of cells. NaN and Infinity are left out. Returns 1 when
 * there are no positive values.
 */
export function autoVmax(values: ArrayLike<number>, percentile = 0.99): number {
  const n = values.length;
  let max = 0;
  let positive = 0;
  for (let k = 0; k < n; k += 1) {
    const v = values[k] as number;
    if (v > 0 && v < Infinity) {
      positive += 1;
      if (v > max) max = v;
    }
  }
  if (positive === 0 || max <= 0) return 1;
  const BINS = 1024;
  const logMax = Math.log1p(max);
  const hist = new Int32Array(BINS);
  for (let k = 0; k < n; k += 1) {
    const v = values[k] as number;
    if (!(v > 0 && v < Infinity)) continue;
    let b = Math.floor((Math.log1p(v) / logMax) * BINS);
    if (b >= BINS) b = BINS - 1;
    if (b < 0) b = 0;
    hist[b] = (hist[b] as number) + 1;
  }
  const target = percentile * positive;
  let cum = 0;
  for (let b = 0; b < BINS; b += 1) {
    cum += hist[b] as number;
    if (cum >= target) {
      const frac = (b + 1) / BINS;
      return Math.max(1e-9, Math.expm1(frac * logMax));
    }
  }
  return max;
}

/** Normalize a value into [0,1] given a transform and clip bounds. */
export function normalizeIntensity(
  v: number,
  vmin: number,
  vmax: number,
  transform: HicTransform,
): number {
  if (transform === "log") {
    const lo = Math.log1p(Math.max(0, vmin));
    const hi = Math.log1p(Math.max(vmin, vmax));
    if (hi <= lo) return 0;
    const t = (Math.log1p(Math.max(0, v)) - lo) / (hi - lo);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  if (vmax <= vmin) return 0;
  const t = (v - vmin) / (vmax - vmin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Encode raw intensities as texture bytes for the shader. Byte 0 means "draw
 * the background" (NaN, or a value at or below a floor of no signal); bytes
 * 1-255 map linearly onto the color scale. The floor counts as background
 * with the log transform and whenever `vmin >= 0`; with the linear transform
 * and a negative `vmin`, low values clamp to the lowest color instead.
 */
export function encodeIntensity(
  values: ArrayLike<number>,
  vmin: number,
  vmax: number,
  transform: HicTransform,
): Uint8Array {
  const out = new Uint8Array(values.length);
  const floorIsBackground = transform === "log" || vmin >= 0;
  for (let k = 0; k < values.length; k += 1) {
    const v = values[k] as number;
    if (Number.isNaN(v)) continue;
    const t = normalizeIntensity(v, vmin, vmax, transform);
    if (t <= 0 && floorIsBackground) continue;
    out[k] = 1 + Math.round(t * 254);
  }
  return out;
}

/**
 * Build a mean-pooled level-of-detail pyramid. Level 0 is the full matrix;
 * each subsequent level halves resolution (2x2 average) until it is <=
 * `minSize`. NaN cells (masked bins in a balanced matrix) are left out of the
 * mean, so one masked bin does not blank its block; a block with no numbers
 * stays NaN. Returns `{ size, data }[]` from finest (level 0) to coarsest.
 * Cheap enough to compute once per dataset.
 */
export function buildLODPyramid(
  dense: Float32Array,
  n: number,
  minSize = 64,
): { size: number; data: Float32Array }[] {
  const levels: { size: number; data: Float32Array }[] = [
    { size: n, data: dense },
  ];
  let cur = dense;
  let size = n;
  while (size > minSize && size > 1) {
    const half = Math.ceil(size / 2);
    const next = new Float32Array(half * half);
    for (let r = 0; r < half; r += 1) {
      for (let c = 0; c < half; c += 1) {
        const r0 = r * 2;
        const c0 = c * 2;
        let sum = 0;
        let cnt = 0;
        for (let dr = 0; dr < 2; dr += 1) {
          const rr = r0 + dr;
          if (rr >= size) continue;
          for (let dc = 0; dc < 2; dc += 1) {
            const cc = c0 + dc;
            if (cc >= size) continue;
            const v = cur[rr * size + cc] as number;
            if (Number.isNaN(v)) continue;
            sum += v;
            cnt += 1;
          }
        }
        next[r * half + c] = cnt > 0 ? sum / cnt : Number.NaN;
      }
    }
    levels.push({ size: half, data: next });
    cur = next;
    size = half;
  }
  return levels;
}

/**
 * Pick the LOD level to sample: the coarsest level that still shows at least
 * one texel per device pixel inside the visible window, returned as an index
 * into the pyramid (0 = finest). Each coarser level is the *whole* matrix at
 * half resolution, so the effective texels covering the window scale with the
 * visible fraction `visibleBins / fullSize`. Sampling the coarsest level that
 * still meets the pixel budget minimizes GPU texture reads without visible
 * blur; the shader keeps `linear` minification for a smooth look between.
 */
export function pickLODLevel(
  levels: { size: number }[],
  visibleBins: number,
  pixelSpan: number,
): number {
  if (levels.length <= 1) return 0;
  const fullSize = (levels[0] as { size: number }).size;
  const frac = Math.min(1, visibleBins / fullSize);
  // Walk coarse -> fine; the first level whose in-window texel count meets the
  // pixel budget is the cheapest acceptable one.
  for (let l = levels.length - 1; l >= 0; l -= 1) {
    const windowTexels = (levels[l] as { size: number }).size * frac;
    if (windowTexels >= pixelSpan) return l;
  }
  return 0;
}

/** Nice, human-friendly tick step for a bin/coordinate span. */
export function niceTickStep(span: number, target = 6): number {
  if (span <= 0) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

/**
 * Tick step for the window [lo, hi], never below `minStep`. Bin-index axes pass
 * 1 so a narrow window does not get half-bin ticks.
 */
export function tickStep(
  lo: number,
  hi: number,
  target = 6,
  minStep = 0,
): number {
  return Math.max(minStep, niceTickStep(hi - lo, target));
}

/** Tick positions (bin indices) across the current visible window [lo, hi]. */
export function axisTicks(
  lo: number,
  hi: number,
  target = 6,
  minStep = 0,
): number[] {
  const step = tickStep(lo, hi, target, minStep);
  const first = Math.ceil(lo / step - 1e-9);
  const out: number[] = [];
  // Multiply, do not accumulate, so 0.1-sized steps do not drift.
  // `+ 0` turns -0 (from ceil of a tiny negative) into 0.
  for (let k = first; k * step <= hi + 1e-9; k += 1) out.push(k * step + 0);
  return out;
}

/**
 * Format a genomic coordinate (bp) compactly as bp, kb or Mb. `step` is the
 * spacing in bp between the values being labelled (the tick step, or the bin
 * size for a single bin); it sets the number of decimals, so neighbouring
 * labels never print the same text. Without a step, up to three significant
 * digits are kept and trailing zeros after the decimal point are dropped.
 */
export function formatCoord(bp: number, step = 0): string {
  const a = Math.abs(bp);
  const [div, unit] = a >= 1e6 ? [1e6, "Mb"] : a >= 1e3 ? [1e3, "kb"] : [1, ""];
  const v = bp / div;
  if (step > 0) return `${v.toFixed(decimalsFor(step / div))}${unit}`;
  if (div === 1) return `${Math.round(bp)}`;
  const s = v.toPrecision(3);
  return `${s.includes(".") ? s.replace(/\.?0+$/, "") : s}${unit}`;
}

/**
 * Decimals needed to write `x` exactly (2.5 needs 1, 0.25 needs 2), at most 6.
 * Tick values are whole multiples of the step, so they need no more.
 */
function decimalsFor(x: number): number {
  for (let d = 0; d < 6; d += 1) {
    const scaled = x * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) {
      return d;
    }
  }
  return 6;
}

/** Sample the named colormap into a Uint8 RGBA lookup texture (256x1). */
export function colormapLUT(name: HicColormap): Uint8Array {
  const fn = RAMPS[name] ?? RAMPS.viridis;
  const lut = new Uint8Array(COLORMAP_SIZE * 4);
  for (let i = 0; i < COLORMAP_SIZE; i += 1) {
    const [r, g, b]: RGB = fn(i / (COLORMAP_SIZE - 1));
    lut[i * 4 + 0] = Math.round(r);
    lut[i * 4 + 1] = Math.round(g);
    lut[i * 4 + 2] = Math.round(b);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface Level {
  size: number;
  data: Float32Array;
  /** Encoded bytes for the current scale; built on first use. */
  bytes: Uint8Array | null;
  texture: Texture2D | null;
}

export const createHic: PlotomicsFactory<HicOptions> = (el, initial) => {
  let opts: HicOptions = mergeOptions(defaultHicOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  // Matrix state.
  let n = 0; // bins per axis
  let binSize = 1; // bp per bin (from meta.binSize)
  let dense: Float32Array | null = null;
  let levels: Level[] = [];
  let vmaxResolved = 1;

  // View window in bin coordinates: [lo, hi] on both axes (square, symmetric).
  let viewLo = 0;
  let viewHi = 1;

  let width = 0;
  let height = 0;

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;cursor:grab;";
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

  let regl: Regl | null = null;
  let draw: DrawCommand | null = null;
  let cmapTex: Texture2D | null = null;
  let maxTextureSize = Infinity;
  // Set when WebGL is missing or a draw failed; the overlay still renders and
  // no method throws.
  let glBroken = false;
  const uid = `plotomics-hic-${hicSeq++}`;

  /** Set up WebGL once; on any failure, mark it broken and draw no matrix. */
  function initGL() {
    if (regl || glBroken) return;
    try {
      setupGL();
    } catch (err) {
      // setupGL assigns these, which TypeScript cannot see from here.
      (cmapTex as Texture2D | null)?.destroy?.();
      releaseRegl(regl as Regl | null);
      regl = null;
      draw = null;
      cmapTex = null;
      glBroken = true;
      console.error("plotomics hic: WebGL setup failed", err);
    }
  }

  function setupGL() {
    regl = createREGL({
      canvas,
      attributes: { antialias: false, preserveDrawingBuffer: true },
    });
    maxTextureSize = regl.limits.maxTextureSize;
    cmapTex = regl.texture({
      data: colormapLUT(opts.colormap),
      width: COLORMAP_SIZE,
      height: 1,
      format: "rgba",
      type: "uint8",
      mag: "linear",
      min: "linear",
      wrap: "clamp",
    });
    draw = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        varying vec2 uv;
        uniform vec2 uvLo, uvHi;
        void main() {
          vec2 t = position * 0.5 + 0.5;      // [0,1] quad space
          uv = mix(uvLo, uvHi, t);            // window into the matrix
          // flip Y so bin 0 is at the top (matrix / image convention)
          gl_Position = vec4(position.x, -position.y, 0.0, 1.0);
        }`,
      frag: `
        precision highp float;
        varying vec2 uv;
        uniform sampler2D matrix;   // luminance byte: 0 = background, 1-255 = scale
        uniform sampler2D cmap;     // 256x1 colormap LUT
        uniform vec3 background;
        void main() {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(background, 1.0);
            return;
          }
          float b = texture2D(matrix, uv).r * 255.0;
          if (b < 0.5) { gl_FragColor = vec4(background, 1.0); return; }
          float t = clamp((b - 1.0) / 254.0, 0.0, 1.0);
          gl_FragColor = texture2D(cmap, vec2(t, 0.5));
        }`,
      attributes: {
        position: [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ],
      },
      uniforms: {
        matrix: regl.prop<{ matrix: Texture2D }, "matrix">("matrix"),
        cmap: () => cmapTex as Texture2D,
        uvLo: regl.prop<{ uvLo: [number, number] }, "uvLo">("uvLo"),
        uvHi: regl.prop<{ uvHi: [number, number] }, "uvHi">("uvHi"),
        background: () => cssColorToUnitRGB(theme.background),
      },
      count: 4,
      primitive: "triangle strip",
      viewport: regl.prop<
        { viewport: { x: number; y: number; width: number; height: number } },
        "viewport"
      >("viewport"),
    });
  }

  function levelTexture(level: Level): Texture2D | null {
    if (!regl) return null;
    if (level.texture) return level.texture;
    if (!level.bytes) {
      level.bytes = encodeIntensity(
        level.data,
        opts.vmin,
        vmaxResolved,
        opts.transform,
      );
    }
    level.texture = regl.texture({
      data: level.bytes,
      width: level.size,
      height: level.size,
      format: "luminance",
      type: "uint8",
      mag: "nearest",
      min: "linear",
      wrap: "clamp",
    });
    return level.texture;
  }

  /** Drop the encoded bytes and textures, after the color scale changed. */
  function invalidateLevels() {
    for (const lv of levels) {
      lv.texture?.destroy?.();
      lv.texture = null;
      lv.bytes = null;
    }
  }

  function resolveVmax() {
    vmaxResolved =
      dense == null
        ? 1
        : opts.vmax != null
          ? opts.vmax
          : autoVmax(dense, opts.vmaxPercentile);
  }

  /** Read the data into the dense matrix and its LOD pyramid. */
  function buildMatrix() {
    invalidateLevels();
    levels = [];
    dense = null;

    const cols = data.columns;
    const meta = data.meta;
    const values = cols.values as ArrayLike<number> | undefined;
    const iCol = cols.i as ArrayLike<number> | undefined;
    const jCol = cols.j as ArrayLike<number> | undefined;
    const vCol = cols.v as ArrayLike<number> | undefined;

    n = matrixSize(meta, values ? values.length : undefined);
    binSize = typeof meta?.binSize === "number" ? (meta.binSize as number) : 1;

    if (values && values.length >= n * n && n > 0) {
      dense = toFloat32(values, n * n);
    } else if (iCol && jCol && vCol && n > 0) {
      dense = densifySymmetric(iCol, jCol, vCol, n, opts.symmetric);
    }
    if (!dense || n === 0) {
      dense = null;
      n = 0;
      return;
    }
    resolveVmax();
    levels = buildLODPyramid(dense, n).map((p) => ({
      ...p,
      bytes: null,
      texture: null,
    }));
  }

  const isSparse = () =>
    !data.columns.values &&
    !!data.columns.i &&
    !!data.columns.j &&
    !!data.columns.v;

  function applyData() {
    buildMatrix();
    viewLo = 0;
    viewHi = n > 0 ? n : 1;
    tickRoom = 0;
    render();
  }

  // ---- text and margins ----
  const tw = (s: string, size: number) => textWidth(s, size, theme.fontFamily);
  const axisTitle = () =>
    opts.label || (data.meta?.chrom ? String(data.meta.chrom) : "");
  const colorbarTitle = () =>
    opts.transform === "log" ? "contacts (log)" : "contacts";
  /** The colour bar's values: the top and the bottom of the scale. */
  const colorbarValues = () => [
    vmaxResolved,
    opts.transform === "log" ? Math.max(0, opts.vmin) : opts.vmin,
  ];
  const colorbarTicks = () => colorbarValues().map(fmtVal);
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
  /**
   * `v` as text that fits `maxW` px at `size` px: as the colour bar writes
   * it, else to three significant digits or whole, and cut only when none
   * fits.
   */
  function fitValue(v: number, maxW: number, size: number): string {
    const forms = [fmtVal(v)];
    if (Number.isFinite(v) && Math.abs(v) >= 1) {
      forms.push(String(Number(v.toPrecision(3))), String(Math.round(v)));
    }
    for (const s of forms) if (tw(s, size) <= maxW) return s;
    return fit(forms[forms.length - 1] as string, maxW, size);
  }
  /** The label of tick `t` (in bins) on an axis ticked every `stepBp`. */
  const tickLabel = (t: number, stepBp: number) =>
    binSize > 1 ? formatCoord(t * binSize, stepBp) : String(Math.round(t));
  /**
   * Width of the widest tick label of the view at the finest step the axis
   * uses, which has the most decimals.
   */
  function widestTick(): number {
    if (n === 0) return 0;
    const minStep = binSize > 1 ? 0 : 1;
    const stepBp = tickStep(viewLo, viewHi, 6, minStep) * binSize;
    let w = 0;
    for (const t of axisTicks(viewLo, viewHi, 6, minStep)) {
      w = Math.max(w, tw(tickLabel(t, stepBp), sizes.label));
    }
    return w;
  }
  // The widest tick label since the data, the options or the size last
  // changed. The left margin follows it and only grows on pan and zoom, so
  // the plot does not shift back and forth as the labels change.
  let tickRoom = 0;
  const margin = { ...MARGIN };
  // Whether each margin has room for its title.
  const titleOn = { left: false, bottom: false, right: false };
  /**
   * Widen the margins for the text: the left one for the tick labels, 8 px
   * from the plot, with the axis title upright left of them; the bottom one
   * for the tick labels and the axis title under them; the right one for the
   * colour bar, its labels and its title, upright right of them. A margin
   * takes at most a share of the widget, so the map keeps the rest. A title
   * that would pass that share is left out, and labels that still do not fit
   * are cut.
   */
  function fitMargins() {
    const { label, axisTitle: titleSize } = sizes;
    const titled = axisTitle() !== "";
    tickRoom = Math.max(tickRoom, widestTick());
    const capW = Math.floor(width * MAX_MARGIN_SHARE);
    const capH = Math.floor(height * MAX_MARGIN_SHARE);
    // A margin for `bare` px of text, and `title` px more when that fits.
    const withTitle = (
      least: number,
      cap: number,
      bare: number,
      title: number,
    ) => {
      const on = title > 0 && bare + title <= cap;
      const px = Math.min(
        cap,
        Math.max(least, Math.ceil(on ? bare + title : bare)),
      );
      return [px, on] as const;
    };
    [margin.left, titleOn.left] = withTitle(
      MARGIN.left,
      capW,
      tickRoom + 10,
      titled ? 1.4 * titleSize + 4 : 0,
    );
    [margin.bottom, titleOn.bottom] = withTitle(
      MARGIN.bottom,
      capH,
      9 + 1.3 * label,
      titled ? 8 + 1.15 * titleSize : 0,
    );
    let valueW = 0;
    for (const t of colorbarTicks()) valueW = Math.max(valueW, tw(t, label));
    [margin.right, titleOn.right] = withTitle(
      MARGIN.right,
      capW,
      22 + COLORBAR_W + 4 + valueW + 2,
      1.4 * titleSize + 4,
    );
  }

  // ---- pixel <-> bin mapping for the plot region ----
  const innerW = () => Math.max(1, width - margin.left - margin.right);
  const innerH = () => Math.max(1, height - margin.top - margin.bottom);
  // Square plot area (Hi-C maps are square); center within the inner box.
  const plotSize = () => Math.max(1, Math.min(innerW(), innerH()));
  const plotLeft = () => margin.left + (innerW() - plotSize()) / 2;
  const plotTop = () => margin.top + (innerH() - plotSize()) / 2;

  function binToPx(b: number): number {
    return plotLeft() + ((b - viewLo) / (viewHi - viewLo)) * plotSize();
  }
  function pxToBin(px: number): number {
    return viewLo + ((px - plotLeft()) / plotSize()) * (viewHi - viewLo);
  }

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = "0px";
    canvas.style.top = "0px";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  function render() {
    initGL();
    fitMargins();
    drawMatrix();
    renderOverlay();
  }

  /** Draw the matrix; on any WebGL failure, log once and stop drawing. */
  function drawMatrix() {
    if (!regl || !draw || glBroken) return;
    try {
      drawMatrixUnsafe();
    } catch (err) {
      glBroken = true;
      console.error("plotomics hic: WebGL drawing failed", err);
    }
  }

  function drawMatrixUnsafe() {
    if (!regl || !draw) return;
    regl.clear({
      color: [...cssColorToUnitRGB(theme.background), 1],
      depth: 1,
    });
    if (!levels.length || n === 0) return;

    const ratio = dpr();
    const visibleBins = viewHi - viewLo;
    let level = pickLODLevel(levels, visibleBins, plotSize() * ratio);
    // A level wider than the GPU allows cannot be uploaded; use the finest
    // one that fits.
    while (
      level < levels.length - 1 &&
      (levels[level] as Level).size > maxTextureSize
    ) {
      level += 1;
    }
    const tex = levelTexture(levels[level] as Level);
    if (!tex) return;

    // UV window into the (normalized) full matrix. All levels share [0,1] UV.
    const uvLo: [number, number] = [viewLo / n, viewLo / n];
    const uvHi: [number, number] = [viewHi / n, viewHi / n];

    // Viewport in device pixels; GL origin is bottom-left, so flip Y.
    const px = plotLeft() * ratio;
    const py = plotTop() * ratio;
    const ps = plotSize() * ratio;
    draw({
      matrix: tex,
      uvLo,
      uvHi,
      viewport: {
        x: Math.round(px),
        y: Math.round(canvas.height - py - ps),
        width: Math.round(ps),
        height: Math.round(ps),
      },
    });
  }

  // ---- SVG overlay: genomic axis ticks + colorbar ----
  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;

    const ax = theme.axis;
    const fg = theme.foreground;
    const left = plotLeft();
    const top = plotTop();
    const size = plotSize();
    const { label: labelSize, axisTitle: titleSize } = sizes;
    // Baseline of the bottom tick labels: under the 5 px ticks, with a gap.
    const tickY = top + size + 7 + labelSize;

    // Plot frame.
    svg.appendChild(rectStroke(left, top, size, size, ax, 1.5));

    if (n > 0) {
      // Bin-index axes tick whole bins only; genomic axes may tick inside a bin.
      const minStep = binSize > 1 ? 0 : 1;
      // Fewer ticks when the labels are wider than the gaps between them: a
      // coarser step first, then every k-th tick of the coarsest step.
      let ticks: number[] = [];
      let labels: string[] = [];
      let gap = 0;
      let need = 0;
      for (let target = 6; target >= 2; target -= 1) {
        const step = tickStep(viewLo, viewHi, target, minStep);
        ticks = axisTicks(viewLo, viewHi, target, minStep).filter(
          (t) => t >= viewLo - 1e-6 && t <= viewHi + 1e-6,
        );
        labels = ticks.map((t) => tickLabel(t, step * binSize));
        let widest = 0;
        for (const s of labels) widest = Math.max(widest, tw(s, labelSize));
        gap = (step / (viewHi - viewLo)) * size;
        need = widest + 8;
        if (gap >= need) break;
      }
      const every = gap >= need ? 1 : Math.ceil(need / Math.max(gap, 1e-9));
      // The tick labels on the left stop 2 px from the edge, or from the
      // axis title when it is drawn.
      const yRoom = left - 10 - (titleOn.left ? 1.4 * titleSize + 4 : 0);
      for (let i = 0; i < ticks.length; i += every) {
        const t = ticks[i] as number;
        const label = labels[i] as string;
        // bottom axis
        const x = binToPx(t);
        svg.appendChild(line(x, top + size, x, top + size + 5, ax, 1));
        svg.appendChild(text(x, tickY, label, ax, "middle", labelSize));
        // left axis
        const y = top + ((t - viewLo) / (viewHi - viewLo)) * size;
        svg.appendChild(line(left - 5, y, left, y, ax, 1));
        svg.appendChild(
          text(
            left - 8,
            y + 0.35 * labelSize,
            fit(label, yRoom, labelSize),
            ax,
            "end",
            labelSize,
          ),
        );
      }
    }

    // Axis titles, under the bottom tick labels and upright at the left edge,
    // each where its margin made room for it, cut to the widget.
    const title = axisTitle();
    if (title && titleOn.bottom) {
      const cx = left + size / 2;
      svg.appendChild(
        text(
          cx,
          tickY + 0.3 * labelSize + 8 + 0.85 * titleSize,
          fit(title, 2 * Math.min(cx, width - cx) - 4, titleSize),
          fg,
          "middle",
          titleSize,
        ),
      );
    }
    if (title && titleOn.left) {
      const tx = 2 + 1.1 * titleSize;
      const cy = top + size / 2;
      const yTitle = text(
        tx,
        cy,
        fit(title, 2 * Math.min(cy, height - cy) - 4, titleSize),
        fg,
        "middle",
        titleSize,
      );
      yTitle.setAttribute("transform", `rotate(-90 ${tx} ${cy})`);
      svg.appendChild(yTitle);
    }

    renderColorbar(left + size + 22, top, size);
  }

  function renderColorbar(x: number, top: number, h: number) {
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    // One id per instance: `url(#id)` resolves to the first match in the whole
    // document, so a shared id would paint every colorbar with the first one.
    const gid = `${uid}-cbar`;
    grad.setAttribute("id", gid);
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "1");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "0");
    const rampFn = RAMPS[opts.colormap] ?? RAMPS.viridis;
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const [r, g, b] = rampFn(t);
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", `${(t * 100).toFixed(0)}%`);
      stop.setAttribute("stop-color", `rgb(${r | 0},${g | 0},${b | 0})`);
      grad.appendChild(stop);
    }
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.appendChild(grad);
    svg.appendChild(defs);

    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", String(x));
    bar.setAttribute("y", String(top));
    bar.setAttribute("width", String(COLORBAR_W));
    bar.setAttribute("height", String(h));
    bar.setAttribute("fill", `url(#${gid})`);
    bar.setAttribute("stroke", theme.axis);
    bar.setAttribute("stroke-width", "1");
    svg.appendChild(bar);

    // vmin at bottom, vmax at top, cut to the widget.
    const { label, axisTitle: titleSize } = sizes;
    const vx = x + COLORBAR_W + 4;
    const [hiTick, loTick] = colorbarValues().map((v) =>
      fitValue(v, width - 2 - vx, label),
    ) as [string, string];
    svg.appendChild(
      text(vx, top + 0.75 * label, hiTick, theme.axis, "start", label),
    );
    svg.appendChild(text(vx, top + h, loTick, theme.axis, "start", label));
    if (!titleOn.right) return;
    // The title is turned to read downward, so its letters stand right of
    // its baseline; it starts 4 px right of the wider label.
    const valueW = Math.max(tw(hiTick, label), tw(loTick, label));
    const tx = vx + valueW + 4 + 0.3 * titleSize;
    const cy = top + h / 2;
    const cbTitle = text(
      tx,
      cy,
      fit(colorbarTitle(), 2 * Math.min(cy, height - cy) - 4, titleSize),
      theme.foreground,
      "middle",
      titleSize,
    );
    cbTitle.setAttribute("transform", `rotate(90 ${tx} ${cy})`);
    svg.appendChild(cbTitle);
  }

  // ---- interaction: pan (drag) + zoom (wheel) ----
  let dragging = false;
  let dragStart = { x: 0, y: 0, lo: 0, hi: 0 };

  const onDown = (e: MouseEvent) => {
    if (n === 0) return;
    dragging = true;
    canvas.style.cursor = "grabbing";
    dragStart = { x: e.clientX, y: e.clientY, lo: viewLo, hi: viewHi };
  };
  const onUp = () => {
    dragging = false;
    canvas.style.cursor = "grab";
  };
  const onMove = (e: MouseEvent) => {
    const at = plot.pointer(e.clientX, e.clientY);
    if (dragging) {
      const span = dragStart.hi - dragStart.lo;
      const dxBins = ((e.clientX - dragStart.x) / plotSize()) * span;
      // Pan the symmetric window (drag moves the underlying map with the cursor).
      let lo = dragStart.lo - dxBins;
      let hi = dragStart.hi - dxBins;
      if (lo < 0) {
        lo = 0;
        hi = span;
      }
      if (hi > n) {
        hi = n;
        lo = n - span;
      }
      if (lo < 0) lo = 0;
      viewLo = lo;
      viewHi = hi;
      render();
      return;
    }
    // Hover tooltip, only over the plot square: when zoomed, the margins map to
    // bins outside the view that are not on screen.
    if (n === 0 || !dense) {
      tooltip.hide();
      return;
    }
    const mx = at.x - plotLeft();
    const my = at.y - plotTop();
    if (mx < 0 || my < 0 || mx >= plotSize() || my >= plotSize()) {
      tooltip.hide();
      return;
    }
    const bx = Math.floor(viewLo + (mx / plotSize()) * (viewHi - viewLo));
    const by = Math.floor(viewLo + (my / plotSize()) * (viewHi - viewLo));
    if (bx < 0 || bx >= n || by < 0 || by >= n) {
      tooltip.hide();
      return;
    }
    const val = dense[by * n + bx] as number;
    const coord = (b: number) =>
      binSize > 1 ? formatCoord(b * binSize, binSize) : String(b);
    tooltip.show(
      `<b>${coord(bx)} × ${coord(by)}</b><br/>contacts: ${fmtVal(val)}`,
      e.clientX,
      e.clientY,
    );
  };

  const onWheel = (e: WheelEvent) => {
    if (n === 0) return;
    e.preventDefault();
    const anchorX = pxToBin(plot.pointer(e.clientX, e.clientY).x);
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    let span = (viewHi - viewLo) * factor;
    // Stop at a few bins, or at the whole map when it has fewer bins than that.
    span = Math.max(Math.min(MIN_VIEW_BINS, n), Math.min(n, span));
    // Zoom about the cursor, keeping anchorX roughly fixed.
    const rel = (anchorX - viewLo) / (viewHi - viewLo);
    let lo = anchorX - rel * span;
    let hi = lo + span;
    if (lo < 0) {
      lo = 0;
      hi = span;
    }
    if (hi > n) {
      hi = n;
      lo = n - span;
    }
    viewLo = lo;
    viewHi = hi;
    render();
  };

  const onLeave = () => tooltip.hide();

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function doResize(w: number, h: number) {
    fitBox(w, h);
    tickRoom = 0;
    layoutCanvas();
    render();
  }

  // ---- SVG element helpers ----
  function line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    w: number,
  ) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", String(w));
    return l;
  }
  function rectStroke(
    x: number,
    y: number,
    w: number,
    h: number,
    stroke: string,
    sw: number,
  ) {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("fill", "none");
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

  // Initial sizing from the container (or sensible defaults when detached).
  {
    const m = measure(el);
    doResize(m.width, m.height);
    if (dense == null && (data.columns.values || data.columns.v)) applyData();
  }

  const instance: PlotomicsInstance<HicOptions> = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      const prev = opts;
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      sizes = textSizes(theme);
      tickRoom = 0;
      if (regl && cmapTex && opts.colormap !== prev.colormap) {
        cmapTex.subimage({
          data: colormapLUT(opts.colormap),
          width: COLORMAP_SIZE,
          height: 1,
        });
      }
      if (opts.symmetric !== prev.symmetric && isSparse()) {
        // The mirror is applied when the triplet is densified, so build the
        // matrix again; keep the current view.
        const [lo, hi] = [viewLo, viewHi];
        buildMatrix();
        if (n > 0) [viewLo, viewHi] = [lo, Math.min(hi, n)];
      } else if (
        opts.vmin !== prev.vmin ||
        opts.vmax !== prev.vmax ||
        opts.vmaxPercentile !== prev.vmaxPercentile ||
        opts.transform !== prev.transform
      ) {
        // The color scale is baked into the texture bytes.
        resolveVmax();
        invalidateLevels();
      }
      // A new padding changes the plot box.
      doResize(outerW, outerH);
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Hybrid figure: rasterized GPU matrix + vector axes/colorbar.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      const size = plotSize();
      img.setAttribute("x", String(plotLeft()));
      img.setAttribute("y", String(plotTop()));
      img.setAttribute("width", String(size));
      img.setAttribute("height", String(size));
      // Ensure the current frame is present in the drawing buffer.
      drawMatrix();
      img.setAttribute("href", cropCanvas(canvas, plotLeft(), plotTop(), size));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background),
      );
    },
    async exportPNG(scale = 2) {
      drawMatrix();
      // The plot square of the canvas, as in the SVG export, with the axes
      // and colour bar over it.
      const size = plotSize();
      const r = canvas.width / Math.max(1, width);
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        layers: [
          {
            canvas,
            x: plotLeft(),
            y: plotTop(),
            width: size,
            height: size,
            source: {
              x: plotLeft() * r,
              y: plotTop() * r,
              width: size * r,
              height: size * r,
            },
          },
        ],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      tooltip.destroy();
      invalidateLevels();
      cmapTex?.destroy?.();
      releaseRegl(regl);
      plot.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
/**
 * Copy a column into a Float32Array. A missing cell (null, which is how R's
 * JSON sends NA) becomes NaN, so it is drawn as background, not as 0.
 */
function toFloat32(col: ArrayLike<number>, len: number): Float32Array {
  if (col instanceof Float32Array && col.length === len) return col;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const v = col[i] as number | null | undefined;
    out[i] = v == null ? Number.NaN : v;
  }
  return out;
}

function fmtVal(v: number): string {
  if (Number.isNaN(v)) return "NA";
  if (!isFinite(v)) return v > 0 ? "Inf" : "-Inf";
  const a = Math.abs(v);
  if (a >= 10000 || (a > 0 && a < 0.01)) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}

const colorCache = new Map<string, [number, number, number]>();

/**
 * Any CSS color as unit RGB. Hex is parsed directly; other forms ("white",
 * "rgb(...)") go through a 2D context, which normalizes them. Unparseable or
 * fully transparent input falls back to white.
 */
export function cssColorToUnitRGB(color: string): [number, number, number] {
  const cached = colorCache.get(color);
  if (cached) return cached;
  let rgb: [number, number, number] = [1, 1, 1];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1] as string;
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    rgb = [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
  } else if (typeof document !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = color;
      const norm = String(ctx.fillStyle);
      if (norm.startsWith("#")) {
        rgb = cssColorToUnitRGB(norm);
      } else {
        // "rgba(r, g, b, a)". A fully transparent color has no RGB of its
        // own, so it keeps the white fallback; partial alpha keeps the RGB.
        const m = norm.match(/[\d.]+/g);
        if (m && m.length >= 3 && !(m.length >= 4 && Number(m[3]) === 0)) {
          rgb = [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
        }
      }
    }
  }
  colorCache.set(color, rgb);
  return rgb;
}

/** Crop a square region of the (device-pixel) canvas to a PNG data URL. */
function cropCanvas(
  canvas: HTMLCanvasElement,
  left: number,
  top: number,
  size: number,
): string {
  const ratio = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
  const off = document.createElement("canvas");
  off.width = Math.round(size * ratio);
  off.height = Math.round(size * ratio);
  const ctx = off.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");
  ctx.drawImage(
    canvas,
    Math.round(left * ratio),
    Math.round(top * ratio),
    off.width,
    off.height,
    0,
    0,
    off.width,
    off.height,
  );
  return off.toDataURL("image/png");
}

function mergeOptions(
  base: HicOptions,
  next?: Partial<HicOptions>,
): HicOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
