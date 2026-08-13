/**
 * Hi-C contact matrix — a symmetric genomic contact map rendered on the GPU.
 *
 * Chromatin contact matrices are large (thousands of bins per axis, i.e.
 * millions of cells) and heavily skewed, so the intensity is shown on a log
 * scale with a perceptually-uniform sequential colormap. The whole matrix is
 * uploaded once as a single-channel float texture and drawn as one textured
 * quad via `regl`; the colormap and the log/linear transform run in the
 * fragment shader, so pan/zoom is just a UV-space affine transform (no
 * per-cell DOM, no re-upload). A precomputed level-of-detail (LOD) pyramid of
 * mean-pooled downsamples keeps very large matrices smooth: at each zoom level
 * the coarsest texture whose resolution still exceeds the viewport is sampled.
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
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
  viridis,
  type RGB,
} from "../core/index.js";
import createREGL from "regl";
import type { Regl, Texture2D, DrawCommand } from "regl";

export type HicColormap = "viridis";
export type HicTransform = "log" | "linear";

export interface HicOptions {
  /** Sequential colormap for intensity. */
  colormap: HicColormap;
  /** Intensity transform applied before color mapping. */
  transform: HicTransform;
  /** Upper clip of the intensity scale; null auto-picks a high percentile. */
  vmax: number | null;
  /** Lower clip of the intensity scale (values <= vmin map to color 0). */
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

const MARGIN = { top: 16, right: 96, bottom: 46, left: 60 };
const SVG_NS = "http://www.w3.org/2000/svg";
const COLORBAR_W = 14;
const COLORMAP_SIZE = 256;

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
    const val = v[k] as number;
    if (r < 0 || r >= n || c < 0 || c >= n) continue;
    out[r * n + c] = val;
    if (symmetric) out[c * n + r] = val;
  }
  return out;
}

/**
 * Approximate an upper percentile of the strictly positive entries via a fixed
 * log-spaced histogram — O(len) with no allocation of a sorted copy, so it
 * scales to millions of cells. Returns 1 when there are no positive values.
 */
export function autoVmax(values: ArrayLike<number>, percentile = 0.99): number {
  const n = values.length;
  let max = 0;
  let positive = 0;
  for (let k = 0; k < n; k += 1) {
    const v = values[k] as number;
    if (v > 0) {
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
    if (v <= 0) continue;
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
 * Build a mean-pooled level-of-detail pyramid. Level 0 is the full matrix;
 * each subsequent level halves resolution (2x2 average) until it is <=
 * `minSize`. Returns `{ size, data }[]` from finest (level 0) to coarsest.
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
            sum += cur[rr * size + cc] as number;
            cnt += 1;
          }
        }
        next[r * half + c] = cnt > 0 ? sum / cnt : 0;
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

/** Tick positions (bin indices) across the current visible window [lo, hi]. */
export function axisTicks(lo: number, hi: number, target = 6): number[] {
  const span = hi - lo;
  const step = niceTickStep(span, target);
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let t = start; t <= hi + 1e-9; t += step) out.push(t);
  return out;
}

/** Format a genomic coordinate (bp) compactly (bp / kb / Mb). */
export function formatCoord(bp: number): string {
  const a = Math.abs(bp);
  if (a >= 1e6) return `${(bp / 1e6).toPrecision(3).replace(/\.?0+$/, "")}Mb`;
  if (a >= 1e3) return `${(bp / 1e3).toPrecision(3).replace(/\.?0+$/, "")}kb`;
  return `${Math.round(bp)}`;
}

/** Sample the colormap into a Uint8 RGBA lookup texture (256x1). */
export function colormapLUT(_name: HicColormap): Uint8Array {
  const lut = new Uint8Array(COLORMAP_SIZE * 4);
  for (let i = 0; i < COLORMAP_SIZE; i += 1) {
    const [r, g, b]: RGB = viridis(i / (COLORMAP_SIZE - 1));
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
  texture: Texture2D | null;
}

export const createHic: PlotomicsFactory<HicOptions> = (el, initial) => {
  let opts: HicOptions = mergeOptions(defaultHicOptions, initial.options);
  let theme = resolveTheme(opts.theme);
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
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  let regl: Regl | null = null;
  let draw: DrawCommand | null = null;
  let cmapTex: Texture2D | null = null;

  function initGL() {
    if (regl) return;
    try {
      regl = createREGL({
        canvas,
        attributes: { antialias: false, preserveDrawingBuffer: true },
      });
    } catch {
      regl = null;
      return;
    }
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
        uniform sampler2D matrix;   // R/luminance channel = raw intensity
        uniform sampler2D cmap;     // 256x1 colormap LUT
        uniform float vmin, vmax;
        uniform int useLog;
        uniform vec3 background;
        float norm(float v) {
          if (useLog == 1) {
            float lo = log(1.0 + max(0.0, vmin));
            float hi = log(1.0 + max(vmin, vmax));
            if (hi <= lo) return 0.0;
            return clamp((log(1.0 + max(0.0, v)) - lo) / (hi - lo), 0.0, 1.0);
          }
          if (vmax <= vmin) return 0.0;
          return clamp((v - vmin) / (vmax - vmin), 0.0, 1.0);
        }
        void main() {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(background, 1.0);
            return;
          }
          float v = texture2D(matrix, uv).r;
          float t = norm(v);
          if (t <= 0.0) { gl_FragColor = vec4(background, 1.0); return; }
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
        vmin: () => Math.max(0, opts.vmin),
        vmax: () => vmaxResolved,
        useLog: () => (opts.transform === "log" ? 1 : 0),
        background: () => hexToUnitRGB(theme.background),
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
    level.texture = regl.texture({
      data: level.data,
      width: level.size,
      height: level.size,
      format: "luminance",
      type: "float",
      mag: "nearest",
      min: "linear",
      wrap: "clamp",
    });
    return level.texture;
  }

  function applyData() {
    // Reset GPU textures from the previous dataset.
    for (const lv of levels) lv.texture?.destroy?.();
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
      viewLo = 0;
      viewHi = 1;
      render();
      return;
    }

    vmaxResolved =
      opts.vmax != null ? opts.vmax : autoVmax(dense, opts.vmaxPercentile);
    const pyramid = buildLODPyramid(dense, n);
    levels = pyramid.map((p) => ({ ...p, texture: null }));

    viewLo = 0;
    viewHi = n;
    render();
  }

  // ---- pixel <-> bin mapping for the plot region ----
  const innerW = () => Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerH = () => Math.max(1, height - MARGIN.top - MARGIN.bottom);
  // Square plot area (Hi-C maps are square); center within the inner box.
  const plotSize = () => Math.max(1, Math.min(innerW(), innerH()));
  const plotLeft = () => MARGIN.left + (innerW() - plotSize()) / 2;
  const plotTop = () => MARGIN.top + (innerH() - plotSize()) / 2;

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
    drawMatrix();
    renderOverlay();
  }

  function drawMatrix() {
    if (!regl || !draw) return;
    regl.clear({ color: [...hexToUnitRGB(theme.background), 1], depth: 1 });
    if (!levels.length || n === 0) return;

    const ratio = dpr();
    const visibleBins = viewHi - viewLo;
    const level = pickLODLevel(levels, visibleBins, plotSize() * ratio);
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

    // Plot frame.
    svg.appendChild(rectStroke(left, top, size, size, ax, 1.5));

    if (n > 0) {
      for (const t of axisTicks(viewLo, viewHi)) {
        if (t < viewLo - 1e-6 || t > viewHi + 1e-6) continue;
        const label =
          binSize > 1 ? formatCoord(t * binSize) : String(Math.round(t));
        // bottom axis
        const x = binToPx(t);
        svg.appendChild(line(x, top + size, x, top + size + 5, ax, 1));
        svg.appendChild(text(x, top + size + 18, label, ax, "middle"));
        // left axis
        const y = top + ((t - viewLo) / (viewHi - viewLo)) * size;
        svg.appendChild(line(left - 5, y, left, y, ax, 1));
        svg.appendChild(text(left - 8, y + 4, label, ax, "end"));
      }
    }

    // Axis titles.
    const title =
      opts.label || (data.meta?.chrom ? String(data.meta.chrom) : "");
    if (title) {
      svg.appendChild(
        text(left + size / 2, top + size + 40, title, fg, "middle", 13),
      );
      const yTitle = text(16, top + size / 2, title, fg, "middle", 13);
      yTitle.setAttribute("transform", `rotate(-90 16 ${top + size / 2})`);
      svg.appendChild(yTitle);
    }

    renderColorbar(left + size + 22, top, size);
  }

  function renderColorbar(x: number, top: number, h: number) {
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    const gid = "hic-cbar-grad";
    grad.setAttribute("id", gid);
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "1");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "0");
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const [r, g, b] = viridis(t);
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

    // vmin at bottom, vmax at top.
    svg.appendChild(
      text(
        x + COLORBAR_W + 4,
        top + 8,
        fmtVal(vmaxResolved),
        theme.axis,
        "start",
        10,
      ),
    );
    svg.appendChild(
      text(
        x + COLORBAR_W + 4,
        top + h,
        fmtVal(Math.max(0, opts.vmin)),
        theme.axis,
        "start",
        10,
      ),
    );
    const cbTitle = text(
      x + COLORBAR_W + 22,
      top + h / 2,
      opts.transform === "log" ? "contacts (log)" : "contacts",
      theme.foreground,
      "middle",
      11,
    );
    cbTitle.setAttribute(
      "transform",
      `rotate(90 ${x + COLORBAR_W + 22} ${top + h / 2})`,
    );
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
    const rect = el.getBoundingClientRect();
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
    // Hover tooltip.
    if (n === 0 || !dense) {
      tooltip.hide();
      return;
    }
    const bx = Math.floor(pxToBin(e.clientX - rect.left));
    const by = Math.floor(
      viewLo +
        ((e.clientY - rect.top - plotTop()) / plotSize()) * (viewHi - viewLo),
    );
    if (bx < 0 || bx >= n || by < 0 || by >= n) {
      tooltip.hide();
      return;
    }
    const val = dense[by * n + bx] as number;
    const coord = (b: number) =>
      binSize > 1 ? formatCoord(b * binSize) : String(b);
    tooltip.show(
      `<b>${coord(bx)} × ${coord(by)}</b><br/>contacts: ${fmtVal(val)}`,
      e.clientX,
      e.clientY,
    );
  };

  const onWheel = (e: WheelEvent) => {
    if (n === 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const anchorX = pxToBin(e.clientX - rect.left);
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    let span = (viewHi - viewLo) * factor;
    span = Math.max(4, Math.min(n, span)); // stop at a few bins / the whole map
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

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", () => tooltip.hide());
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function doResize(w: number, h: number) {
    width = w;
    height = h;
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
      const prevCmap = opts.colormap;
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      if (regl && cmapTex && opts.colormap !== prevCmap) {
        cmapTex.subimage({
          data: colormapLUT(opts.colormap),
          width: COLORMAP_SIZE,
          height: 1,
        });
      }
      // vmax may have switched between auto and fixed; recompute if needed.
      if (dense) {
        vmaxResolved =
          opts.vmax != null ? opts.vmax : autoVmax(dense, opts.vmaxPercentile);
      }
      render();
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
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      drawMatrix();
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      tooltip.destroy();
      for (const lv of levels) lv.texture?.destroy?.();
      cmapTex?.destroy?.();
      regl?.destroy?.();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
function toFloat32(col: ArrayLike<number>, len: number): Float32Array {
  if (col instanceof Float32Array && col.length === len) return col;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) out[i] = (col[i] as number) ?? 0;
  return out;
}

function fmtVal(v: number): string {
  if (!isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a >= 10000 || (a > 0 && a < 0.01)) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}

function hexToUnitRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return [r / 255, g / 255, b / 255];
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

function mergeOptions(base: HicOptions, next?: Partial<HicOptions>): HicOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
