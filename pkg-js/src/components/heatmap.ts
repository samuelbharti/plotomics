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
 * row/column tick labels (only drawn when the count is small enough to be
 * legible). This mirrors the Volcano reference component's structure: exported
 * pure helpers plus a `PlotomicsFactory` returning a `PlotomicsInstance`.
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

const MARGIN = { top: 16, right: 84, bottom: 64, left: 96 };
const SVG_NS = "http://www.w3.org/2000/svg";
/** Below this many visible rows/cols, tick labels are legible enough to draw. */
const MAX_TICK_LABELS = 60;
const COLORBAR_W = 14;

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
    let mean = 0;
    for (let c = 0; c < ncols; c += 1) mean += values[base + c] as number;
    mean /= ncols || 1;
    let variance = 0;
    for (let c = 0; c < ncols; c += 1) {
      const d = (values[base + c] as number) - mean;
      variance += d * d;
    }
    variance /= ncols || 1;
    const sd = Math.sqrt(variance);
    if (sd === 0) {
      for (let c = 0; c < ncols; c += 1) out[base + c] = 0;
    } else {
      for (let c = 0; c < ncols; c += 1) {
        out[base + c] = ((values[base + c] as number) - mean) / sd;
      }
    }
  }
  return out;
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
 * Normalize `values` into a Uint8Array of [0,255] levels for the luminance
 * texture, clamping to the color domain. Non-finite values map to 0 (rendered
 * as the ramp's low color).
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
    let t = (v - lo) / span;
    if (!Number.isFinite(t)) t = 0;
    else if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = Math.round(t * 255);
  }
  return out;
}

/** Bake a `plotomics/core` ramp into a 256x4 RGBA Uint8Array lookup table. */
export function buildRampLUT(name: RampName): Uint8Array {
  const fn = ramp(name);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const hex = fn(i / 255);
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

export const createHeatmap: PlotomicsFactory<HeatmapOptions> = (el, initial) => {
  let opts: HeatmapOptions = mergeOptions(defaultHeatmapOptions, initial.options);
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
      min: "linear",
      mag: "linear",
      wrapS: "clamp",
      wrapT: "clamp",
    });
    // Full-screen quad. The fragment shader reads the value texture then indexes
    // the ramp LUT. `nearest` on the value texture keeps cell edges crisp.
    draw = regl({
      frag: `
        precision highp float;
        uniform sampler2D valueTex;
        uniform sampler2D lut;
        varying vec2 uv;
        void main() {
          float v = texture2D(valueTex, uv).r;
          gl_FragColor = texture2D(lut, vec2(v, 0.5));
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
      },
      count: 4,
      primitive: "triangle strip",
      depth: { enable: false },
    });
  }

  // --- pixel geometry (overlay + interaction) -----------------------------
  const innerW = () => Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerH = () => Math.max(1, height - MARGIN.top - MARGIN.bottom);

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = `${MARGIN.left}px`;
    canvas.style.top = `${MARGIN.top}px`;
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
    if (opts.zScore) return zScoreRows(raw, shape.nrows, shape.ncols);
    // Copy into a Float32Array so tooltip lookups and domain share one source.
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] as number;
    return out;
  }

  function uploadMatrix() {
    if (!regl || reglBroken) return;
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
    const u8 = normalizeToU8(scaled, domain[0], domain[1]);
    const texOpts = {
      width: shape.ncols,
      height: shape.nrows,
      format: "luminance" as const,
      data: u8,
      min: "nearest" as const,
      mag: "nearest" as const,
      wrapS: "clamp" as const,
      wrapT: "clamp" as const,
      flipY: false,
    };
    if (valueTex) valueTex(texOpts);
    else valueTex = regl.texture(texOpts);
  }

  function rebuildLUT() {
    if (!regl || reglBroken || !lutTex) return;
    lutTex({
      width: 256,
      height: 1,
      format: "rgba",
      data: buildRampLUT(opts.colormap),
      min: "linear",
      mag: "linear",
      wrapS: "clamp",
      wrapT: "clamp",
    });
  }

  function render() {
    if (!regl || reglBroken || !draw || !valueTex) {
      // Nothing on the GPU (no data or no WebGL); draw the overlay only.
      renderOverlay();
      return;
    }
    regl.poll();
    regl.clear({ color: [1, 1, 1, 1], depth: 1 });
    draw();
    renderOverlay();
  }

  function applyData() {
    shape = readShape(
      data.meta,
      (data.columns.values as ArrayLike<number> | undefined)?.length ?? 0,
    );
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
    const x0 = MARGIN.left;
    const y0 = MARGIN.top;
    const w = innerW();
    const h = innerH();

    svg.appendChild(rect(x0, y0, w, h, "none", theme.axis, 1));

    if (shape.nrows > 0 && shape.ncols > 0) {
      renderColTicks(x0, y0, w, h);
      renderRowTicks(x0, y0, h);
    }
    if (opts.showColorbar) renderColorbar(x0, y0, h);
  }

  // Columns run left->right; the current view spans [viewX, viewX+viewW].
  function renderColTicks(x0: number, y0: number, w: number, h: number) {
    const { ncols, colLabels } = shape;
    const visibleCols = ncols * viewW;
    if (visibleCols > MAX_TICK_LABELS) return;
    const firstCol = Math.max(0, Math.floor(viewX * ncols));
    const lastCol = Math.min(ncols - 1, Math.ceil((viewX + viewW) * ncols) - 1);
    for (let c = firstCol; c <= lastCol; c += 1) {
      const uv = (c + 0.5) / ncols;
      const px = x0 + ((uv - viewX) / viewW) * w;
      if (px < x0 - 1 || px > x0 + w + 1) continue;
      const label = colLabels?.[c] ?? String(c);
      const t = text(px, y0 + h + 14, label, theme.foreground, "end", 10);
      t.setAttribute("transform", `rotate(-90 ${px} ${y0 + h + 14})`);
      svg.appendChild(t);
    }
  }

  // Rows run top->bottom; the current view spans [viewY, viewY+viewH].
  function renderRowTicks(x0: number, y0: number, h: number) {
    const { nrows, rowLabels } = shape;
    const visibleRows = nrows * viewH;
    if (visibleRows > MAX_TICK_LABELS) return;
    const firstRow = Math.max(0, Math.floor(viewY * nrows));
    const lastRow = Math.min(nrows - 1, Math.ceil((viewY + viewH) * nrows) - 1);
    for (let r = firstRow; r <= lastRow; r += 1) {
      const uv = (r + 0.5) / nrows;
      const py = y0 + ((uv - viewY) / viewH) * h;
      if (py < y0 - 1 || py > y0 + h + 1) continue;
      const label = rowLabels?.[r] ?? String(r);
      svg.appendChild(text(x0 - 6, py + 3, label, theme.foreground, "end", 10));
    }
  }

  function renderColorbar(x0: number, y0: number, h: number) {
    const cbX = x0 + innerW() + 24;
    const cbH = Math.min(h, 220);
    const cbY = y0 + (h - cbH) / 2;
    const fn = ramp(opts.colormap);
    const gradId = "plotomics-heatmap-cb";
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

    svg.appendChild(rect(cbX, cbY, COLORBAR_W, cbH, `url(#${gradId})`, theme.axis, 1));

    const mid = (domain[0] + domain[1]) / 2;
    svg.appendChild(
      text(cbX + COLORBAR_W + 5, cbY + 4, fmt(domain[1]), theme.foreground, "start", 10),
    );
    svg.appendChild(
      text(cbX + COLORBAR_W + 5, cbY + cbH / 2 + 3, fmt(mid), theme.foreground, "start", 10),
    );
    svg.appendChild(
      text(cbX + COLORBAR_W + 5, cbY + cbH, fmt(domain[0]), theme.foreground, "start", 10),
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
  function pointerUV(clientX: number, clientY: number): { u: number; v: number } | null {
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
        img.setAttribute("x", String(MARGIN.left));
        img.setAttribute("y", String(MARGIN.top));
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
      regl?.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ------------------------------------------------------
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
function mergeOptions(base: HeatmapOptions, next?: Partial<HeatmapOptions>): HeatmapOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
