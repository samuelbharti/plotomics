/**
 * Clustermap — hierarchically-clustered expression heatmap with dendrograms.
 *
 * Layout (like seaborn.clustermap / Morpheus):
 *
 *   ┌──────────┬──────────────────────────┐
 *   │  (blank) │   column dendrogram (SVG) │
 *   ├──────────┼──────────────────────────┤
 *   │  row     │                           │
 *   │  dendro  │   HEATMAP  (canvas/GPU)   │  ← col labels below
 *   │  (SVG)   │                           │
 *   └──────────┴──────────────────────────┘   ← colorbar legend (SVG)
 *
 * Performance rule of the repo: the *data layer* (every cell) is drawn on a
 * canvas, never as per-cell DOM. We paint one ImageData pixel per cell into a
 * small offscreen canvas and let the GPU upscale it (nearest-neighbour) to the
 * display canvas, which stays smooth for very large matrices. When the cells
 * outnumber the pixels, they are pooled to one block per pixel first, each
 * block keeping its cell farthest from the block's mean, so a lone outlier
 * row is not lost between the pixels. The
 * low-cardinality overlay — dendrograms, labels, colorbar, title — is crisp
 * vector SVG so figures export cleanly.
 *
 * Clustering (agglomerative, via ml-hclust) is >= O(n^2); we only auto-cluster
 * axes with <= MAX_CLUSTER_N leaves. Larger matrices should pass a precomputed
 * leaf order / dendrogram via `meta.rowLinkage` / `meta.colLinkage`.
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
  type TextSizes,
  resolveTheme,
  defaultTheme,
  textSizes,
  textWidth,
  ramp,
  RAMPS,
  isDivergingRamp,
  matrixRamp,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  compositePNG,
} from "../core/index.js";
import {
  type Dendrogram,
  type Linkage,
  type Metric,
  MAX_CLUSTER_N,
  cellAt,
  clusterVectors,
  dataExtent,
  dendrogramPositions,
  identityOrder,
  normalizePrecomputed,
  poolBlocks,
  symmetricExtent,
  toColVectors,
  toRowVectors,
  zScoreByRow,
} from "./clustermap-cluster.js";
import { uniqueId } from "../core/dom.js";

export interface ClustermapOptions {
  /** Distance metric for clustering. */
  metric: Metric;
  /** Agglomeration (linkage) method. */
  linkage: Linkage;
  /**
   * Colour ramp: sequential 'viridis' or 'ltc', or diverging 'rdbu' or
   * 'ltcdiv', whose range is symmetric about 0. `null` (the default) uses
   * 'rdbu' when `zScore` is on and 'viridis' otherwise.
   */
  colormap: RampName | null;
  /** Standardize each row to mean 0 / sd 1 before mapping to color. */
  zScore: boolean;
  /** Cluster + reorder rows (skipped if a precomputed row order is supplied). */
  clusterRows: boolean;
  /** Cluster + reorder columns. */
  clusterCols: boolean;
  /** Show the row (left) dendrogram. */
  showRowDendrogram: boolean;
  /** Show the column (top) dendrogram. */
  showColDendrogram: boolean;
  /** Show tick labels along the axes (auto-hidden when cells get too small). */
  showLabels: boolean;
  /** Colorbar legend title. */
  legendTitle: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultClustermapOptions: ClustermapOptions = {
  metric: "euclidean",
  linkage: "average",
  colormap: null,
  zScore: false,
  clusterRows: true,
  clusterCols: true,
  showRowDendrogram: true,
  showColDendrogram: true,
  showLabels: true,
  legendTitle: "value",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";

// Gutters around the heatmap. Dendrogram bands collapse to 0 when hidden
// or when the axis is not clustered. The label caps are for the default
// text size and scale with it.
const DENDRO = 60; // px band for a dendrogram
const MAX_ROW_LABEL = 140; // widest the row-label gutter gets, in px
const MAX_COL_LABEL = 120; // tallest the column-label band gets, in px
const COLORBAR_W = 78; // px on the right for the colour bar, at the least
const MAX_LABEL_SHARE = 0.3; // a label gutter takes at most this share
const MIN_HEAT = 60; // a label gutter stays only if the heatmap keeps this
const PAD = 12;
const DEFAULT_SIZES = textSizes(defaultTheme);
/** Fill for a missing cell, and its colour bar swatch. */
const MISSING_RGB: [number, number, number] = [0xcc, 0xcc, 0xcc];
const MISSING_COLOR = "#CCCCCC";

// ---------------------------------------------------------------------------
// Pure layout helper (kept here, exercised via the factory + tests)
// ---------------------------------------------------------------------------

export interface Layout {
  rowDendroW: number;
  colDendroH: number;
  labelW: number; // right-side row labels reserve
  labelH: number; // bottom col labels reserve
  heat: { x: number; y: number; w: number; h: number };
  /** Left edge of the colour bar, in the right-hand gutter. */
  colorbarX: number;
}

/**
 * Frame the heatmap. The row and column label gutters take the width of the
 * longest label (0 when no label is drawn), the dendrogram bands are 60 px,
 * and the colour bar sits in its own gutter on the right, so the heatmap
 * keeps the height. The caps on the label gutters scale with the label size
 * in `sizes`.
 */
export function computeLayout(
  width: number,
  height: number,
  opts: {
    showRowDendrogram: boolean;
    showColDendrogram: boolean;
    hasRowDendro: boolean;
    hasColDendro: boolean;
    showLabels: boolean;
  },
  /** Width of the longest row label in px; 0 when row labels are not drawn. */
  rowLabelW = 0,
  /** Length of the longest column label in px; 0 when they are not drawn. */
  colLabelH = 0,
  /** Width of the colour bar gutter: the bar, its tick labels and title. */
  colorbarW = COLORBAR_W,
  sizes: TextSizes = DEFAULT_SIZES,
): Layout {
  const k = sizes.label / DEFAULT_SIZES.label;
  const rowDendroW = opts.showRowDendrogram && opts.hasRowDendro ? DENDRO : 0;
  const colDendroH = opts.showColDendrogram && opts.hasColDendro ? DENDRO : 0;
  const labelW =
    opts.showLabels && rowLabelW > 0
      ? Math.max(
          PAD,
          Math.min(
            Math.round(MAX_ROW_LABEL * k),
            Math.floor(width * MAX_LABEL_SHARE),
            Math.ceil(rowLabelW) + 10,
          ),
        )
      : PAD;
  const labelH =
    opts.showLabels && colLabelH > 0
      ? Math.max(
          PAD,
          Math.min(
            Math.round(MAX_COL_LABEL * k),
            Math.floor(height * MAX_LABEL_SHARE),
            Math.ceil(colLabelH) + 10,
          ),
        )
      : PAD;
  const x = PAD + rowDendroW;
  const y = PAD + colDendroH;
  const w = Math.max(1, width - x - labelW - colorbarW);
  const h = Math.max(1, height - y - labelH);
  return {
    rowDendroW,
    colDendroH,
    labelW,
    labelH,
    heat: { x, y, w, h },
    colorbarX: x + w + labelW + 4,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createClustermap: PlotomicsFactory<ClustermapOptions> = (
  el,
  initial,
) => {
  let opts: ClustermapOptions = mergeOptions(
    defaultClustermapOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };
  /** The ramp drawn: the one given, else one picked by `zScore`. */
  const rampName = () => matrixRamp(opts.colormap, opts.zScore);

  let width = 0;
  let height = 0;

  // Derived model (recomputed on setData / relevant setOptions).
  let nrows = 0;
  let ncols = 0;
  let display: Float32Array = new Float32Array(0); // possibly z-scored values
  let rowOrder: number[] = [];
  let colOrder: number[] = [];
  let rowDendro: Dendrogram | null = null;
  let colDendro: Dendrogram | null = null;
  let rowLabels: string[] = [];
  let colLabels: string[] = [];
  let colorLo = 0;
  let colorHi = 1;
  let diverging = false;
  let anyMissing = false;
  const gradId = uniqueId("plotomics-clustermap-cb");
  // Clustering is the slow part (seconds per axis on a large matrix), so
  // each axis keeps its last result with the inputs that produced it. R and
  // Shiny send the data again on every update; unchanged values, shape,
  // linkage and options reuse the result.
  let lastValues: Float32Array | null = null;
  let rowCache: AxisCache | null = null;
  let colCache: AxisCache | null = null;
  // The cells pooled for the image size last asked for, until they change.
  let pooledImage: { w: number; h: number; canvas: HTMLCanvasElement } | null =
    null;

  // DOM: display canvas for the heatmap + full-size SVG overlay. A small
  // offscreen canvas holds one pixel per cell and is upscaled onto the display.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;display:block;image-rendering:pixelated;";
  const cellCanvas = document.createElement("canvas"); // offscreen (nrows×ncols)
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // Whether each axis has a label gutter in the current layout.
  let rowLabelsOn = false;
  let colLabelsOn = false;
  let layout: Layout = computeLayout(0, 0, {
    showRowDendrogram: false,
    showColDendrogram: false,
    hasRowDendro: false,
    hasColDendro: false,
    showLabels: false,
  });

  // ---- input parsing ----
  function readMeta(): {
    nrows: number;
    ncols: number;
    rowLabels: string[];
    colLabels: string[];
    rowLinkage: unknown;
    colLinkage: unknown;
  } {
    const meta = (data.meta ?? {}) as Record<string, unknown>;
    const values = data.columns.values as ArrayLike<number> | undefined;
    let nr = Number(meta.nrows);
    let nc = Number(meta.ncols);
    // Infer a square-ish shape only as a last resort.
    if ((!nr || !nc) && values) {
      nc = nc || (nr ? Math.floor(values.length / nr) : 0);
      nr = nr || (nc ? Math.floor(values.length / nc) : 0);
    }
    const rl = Array.isArray(meta.rowLabels)
      ? (meta.rowLabels as unknown[])
      : [];
    const cl = Array.isArray(meta.colLabels)
      ? (meta.colLabels as unknown[])
      : [];
    return {
      nrows: nr || 0,
      ncols: nc || 0,
      rowLabels: rl.map((v) => String(v)),
      colLabels: cl.map((v) => String(v)),
      rowLinkage: meta.rowLinkage,
      colLinkage: meta.colLinkage,
    };
  }

  function applyData() {
    const rawValues = data.columns.values as ArrayLike<number> | undefined;
    const meta = readMeta();
    nrows = meta.nrows;
    ncols = meta.ncols;

    if (
      !rawValues ||
      nrows <= 0 ||
      ncols <= 0 ||
      rawValues.length < nrows * ncols
    ) {
      nrows = 0;
      ncols = 0;
      display = new Float32Array(0);
      rowOrder = [];
      colOrder = [];
      rowDendro = null;
      colDendro = null;
      relayout();
      return;
    }

    // R sends NA as null; toFloat32 keeps it missing (NaN), never 0.
    const values = toFloat32(rawValues, nrows * ncols);
    if (!lastValues || !sameValues(lastValues, values)) {
      lastValues = values.slice();
      rowCache = null;
      colCache = null;
    }
    display = opts.zScore ? zScoreByRow(values, nrows, ncols) : values;
    anyMissing = display.some((v) => !Number.isFinite(v));
    computeColorDomain();

    rowLabels = meta.rowLabels;
    colLabels = meta.colLabels;

    // Row ordering: precomputed > cluster > identity, reused when nothing
    // the rows depend on changed.
    const rowKey = JSON.stringify([
      nrows,
      ncols,
      opts.metric,
      opts.linkage,
      opts.zScore,
      opts.clusterRows,
      meta.rowLinkage ?? null,
    ]);
    if (rowCache?.key !== rowKey) {
      const rowPre = normalizePrecomputed(meta.rowLinkage, nrows);
      const res = rowPre
        ? rowPre
        : opts.clusterRows && nrows <= MAX_CLUSTER_N && nrows >= 2
          ? clusterVectors(
              toRowVectors(display, nrows, ncols),
              opts.metric,
              opts.linkage,
            )
          : { order: identityOrder(nrows), dendrogram: null };
      rowCache = { key: rowKey, order: res.order, dendro: res.dendrogram };
    }
    rowOrder = rowCache.order;
    rowDendro = rowCache.dendro;

    const colKey = JSON.stringify([
      nrows,
      ncols,
      opts.metric,
      opts.linkage,
      opts.zScore,
      opts.clusterCols,
      meta.colLinkage ?? null,
    ]);
    if (colCache?.key !== colKey) {
      const colPre = normalizePrecomputed(meta.colLinkage, ncols);
      const res = colPre
        ? colPre
        : opts.clusterCols && ncols <= MAX_CLUSTER_N && ncols >= 2
          ? clusterVectors(
              toColVectors(display, nrows, ncols),
              opts.metric,
              opts.linkage,
            )
          : { order: identityOrder(ncols), dendrogram: null };
      colCache = { key: colKey, order: res.order, dendro: res.dendrogram };
    }
    colOrder = colCache.order;
    colDendro = colCache.dendro;

    paintCells();
    relayout();
  }

  /** Color domain: symmetric for diverging maps (rdbu / z-score), else data extent. */
  function computeColorDomain() {
    diverging = isDivergingRamp(rampName()) || opts.zScore;
    [colorLo, colorHi] = diverging
      ? symmetricExtent(display)
      : dataExtent(display);
  }

  // ---- heatmap painting (canvas data layer) ----
  function paintCells() {
    pooledImage = null;
    if (nrows === 0 || ncols === 0) return;
    cellCanvas.width = ncols;
    cellCanvas.height = nrows;
    const ctx = cellCanvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(ncols, nrows);
    const buf = img.data;
    const toColor = colorFn();
    const span = colorHi - colorLo || 1;
    for (let ry = 0; ry < nrows; ry += 1) {
      const srcRow = rowOrder[ry] as number;
      for (let cx = 0; cx < ncols; cx += 1) {
        const srcCol = colOrder[cx] as number;
        const v = cellAt(display, ncols, srcRow, srcCol);
        const [r, g, b] = Number.isFinite(v)
          ? toColor((v - colorLo) / span)
          : MISSING_RGB;
        const o = (ry * ncols + cx) * 4;
        buf[o] = r;
        buf[o + 1] = g;
        buf[o + 2] = b;
        buf[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    drawCanvas();
  }

  function colorFn(): (t: number) => [number, number, number] {
    const fn = RAMPS[rampName()];
    return (t: number) => fn(Math.min(1, Math.max(0, t)));
  }

  /**
   * The cells as an image to scale to `w` x `h` px: the one pixel per cell
   * canvas while every row and column has a pixel, else the cells pooled
   * to one block per pixel (see {@link poolBlocks}).
   */
  function cellImage(w: number, h: number): HTMLCanvasElement {
    if (nrows <= h && ncols <= w) return cellCanvas;
    if (pooledImage && pooledImage.w === w && pooledImage.h === h) {
      return pooledImage.canvas;
    }
    const outR = Math.min(nrows, Math.max(1, h));
    const outC = Math.min(ncols, Math.max(1, w));
    const pooled = poolBlocks(display, ncols, rowOrder, colOrder, outR, outC);
    const out = document.createElement("canvas");
    out.width = outC;
    out.height = outR;
    const ctx = out.getContext("2d");
    if (ctx) {
      const img = ctx.createImageData(outC, outR);
      const buf = img.data;
      const toColor = colorFn();
      const span = colorHi - colorLo || 1;
      for (let k = 0; k < pooled.length; k += 1) {
        const v = pooled[k] as number;
        const [r, g, b] = Number.isFinite(v)
          ? toColor((v - colorLo) / span)
          : MISSING_RGB;
        buf[k * 4] = r;
        buf[k * 4 + 1] = g;
        buf[k * 4 + 2] = b;
        buf[k * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    pooledImage = { w, h, canvas: out };
    return out;
  }

  function drawCanvas() {
    const ratio = dpr();
    const { x, y, w, h } = layout.heat;
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (nrows === 0 || ncols === 0) return;
    // Nearest-neighbour scaling from one pixel per cell, or per pooled block
    // when the cells outnumber the pixels.
    const src = cellImage(canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      src,
      0,
      0,
      src.width,
      src.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  function labelWidth(s: string, size = sizes.label): number {
    return textWidth(s, size, theme.fontFamily);
  }
  // The longest label of each label array, measured once per font.
  const longestCache = new WeakMap<string[], { font: string; w: number }>();
  function longest(labels: string[]): number {
    const font = `${sizes.label}px ${theme.fontFamily}`;
    const hit = longestCache.get(labels);
    if (hit && hit.font === font) return hit.w;
    let w = 0;
    for (const l of labels) w = Math.max(w, labelWidth(l));
    longestCache.set(labels, { font, w });
    return w;
  }
  /** The colour bar's tick labels: high end, middle, low end. */
  function colorbarTicks(): [string, string, string] {
    // A midpoint within rounding error of 0 (a symmetric range held in
    // float32) reads 0, not -2.4e-7.
    const mid = (colorLo + colorHi) / 2;
    return [
      fmt(colorHi),
      fmt(Math.abs(mid) < (colorHi - colorLo) * 1e-6 ? 0 : mid),
      fmt(colorLo),
    ];
  }
  /** Width of the widest tick label of the colour bar, or of its NA key. */
  function colorbarTickWidth(): number {
    let w = anyMissing ? labelWidth("NA") : 0;
    for (const t of colorbarTicks()) w = Math.max(w, labelWidth(t));
    return w;
  }
  /**
   * Width of the colour bar gutter: 4 px, the 12 px bar, 4 px, the tick
   * labels, 4 px, then the title turned upright, whose letters stand 1.1
   * times its size left of its baseline and 0.3 times right of it.
   */
  function colorbarWidth(): number {
    const need = 4 + 12 + 4 + colorbarTickWidth() + 4 + 1.4 * sizes.axisTitle;
    return Math.max(COLORBAR_W, Math.ceil(need + 2));
  }

  // ---- layout + overlay ----
  function relayout() {
    const flags = {
      showRowDendrogram: opts.showRowDendrogram,
      showColDendrogram: opts.showColDendrogram,
      hasRowDendro: !!rowDendro,
      hasColDendro: !!colDendro,
      showLabels: opts.showLabels,
    };
    // An axis gets a label gutter only when its cells can be at least as
    // tall or wide as the label size, so a large matrix measures no label.
    const minCell = sizes.label;
    const rowW =
      opts.showLabels &&
      rowLabels.length === nrows &&
      nrows > 0 &&
      nrows * minCell <= height
        ? longest(rowLabels)
        : 0;
    const colH =
      opts.showLabels &&
      colLabels.length === ncols &&
      ncols > 0 &&
      ncols * minCell <= width
        ? longest(colLabels)
        : 0;
    const cbW = colorbarWidth();
    // Take the first layout in which every gutter it keeps has cells big
    // enough for its labels and leaves the heatmap MIN_HEAT px or more:
    // both gutters, then the row gutter alone, the column gutter alone, none.
    const tries: [boolean, boolean][] = [
      [rowW > 0, colH > 0],
      [rowW > 0, false],
      [false, colH > 0],
      [false, false],
    ];
    for (const [rows, cols] of tries) {
      const l = computeLayout(
        width,
        height,
        flags,
        rows ? rowW : 0,
        cols ? colH : 0,
        cbW,
        sizes,
      );
      const rowsOk =
        !rows || (l.heat.h / nrows >= minCell && l.heat.w >= MIN_HEAT);
      const colsOk =
        !cols || (l.heat.w / ncols >= minCell && l.heat.h >= MIN_HEAT);
      if ((rowsOk && colsOk) || (!rows && !cols)) {
        layout = l;
        rowLabelsOn = rows;
        colLabelsOn = cols;
        break;
      }
    }
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    drawCanvas();
    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    if (nrows === 0 || ncols === 0) {
      svg.appendChild(
        text(
          width / 2,
          height / 2,
          "No data",
          theme.muted,
          "middle",
          sizes.label,
        ),
      );
      return;
    }
    const { heat } = layout;
    const cellW = heat.w / ncols;
    const cellH = heat.h / nrows;

    // Frame around the heatmap.
    svg.appendChild(
      rect(heat.x, heat.y, heat.w, heat.h, "none", theme.axis, 1),
    );

    if (opts.showColDendrogram && colDendro) {
      renderDendrogram(colDendro, "top");
    }
    if (opts.showRowDendrogram && rowDendro) {
      renderDendrogram(rowDendro, "left");
    }

    if (opts.showLabels) renderLabels(cellW, cellH);
    renderColorbar();
  }

  /**
   * Draw a dendrogram. `orientation` "top" spans the column band above the
   * heatmap (leaves along x, heights growing upward); "left" spans the row band
   * to the left (leaves along y, heights growing leftward).
   */
  function renderDendrogram(d: Dendrogram, orientation: "top" | "left") {
    const { pos, height: hgt } = dendrogramPositions(d);
    let maxH = 0;
    for (const v of hgt) if (v > maxH) maxH = v;
    if (maxH === 0) maxH = 1;
    const { heat } = layout;
    const stroke = theme.foreground;

    if (orientation === "top") {
      const leafToPx = (slot: number) => heat.x + (slot + 0.5) * (heat.w / d.n);
      const bandTop = PAD;
      const bandBottom = heat.y - 2;
      const bandH = Math.max(1, bandBottom - bandTop);
      const hToPx = (h: number) => bandBottom - (h / maxH) * bandH;
      for (let k = 0; k < d.merges.length; k += 1) {
        const m = d.merges[k]!;
        const id = d.n + k;
        const xl = leafToPx(pos[m.left] as number);
        const xr = leafToPx(pos[m.right] as number);
        const yTop = hToPx(hgt[id] as number);
        const yLeft = hToPx(hgt[m.left] as number);
        const yRight = hToPx(hgt[m.right] as number);
        // ⊓ bracket: verticals up from each child, horizontal join at the top.
        svg.appendChild(line(xl, yLeft, xl, yTop, stroke, 1));
        svg.appendChild(line(xr, yRight, xr, yTop, stroke, 1));
        svg.appendChild(line(xl, yTop, xr, yTop, stroke, 1));
      }
    } else {
      const leafToPx = (slot: number) => heat.y + (slot + 0.5) * (heat.h / d.n);
      const bandLeft = PAD;
      const bandRight = heat.x - 2;
      const bandW = Math.max(1, bandRight - bandLeft);
      const hToPx = (h: number) => bandRight - (h / maxH) * bandW;
      for (let k = 0; k < d.merges.length; k += 1) {
        const m = d.merges[k]!;
        const id = d.n + k;
        const yl = leafToPx(pos[m.left] as number);
        const yr = leafToPx(pos[m.right] as number);
        const xTip = hToPx(hgt[id] as number);
        const xLeft = hToPx(hgt[m.left] as number);
        const xRight = hToPx(hgt[m.right] as number);
        svg.appendChild(line(xLeft, yl, xTip, yl, stroke, 1));
        svg.appendChild(line(xRight, yr, xTip, yr, stroke, 1));
        svg.appendChild(line(xTip, yl, xTip, yr, stroke, 1));
      }
    }
  }

  function renderLabels(cellW: number, cellH: number) {
    const { heat } = layout;
    const size = sizes.label;
    // Column labels below the heatmap (rotated), when the layout made room.
    if (colLabelsOn && colLabels.length === ncols) {
      for (let cx = 0; cx < ncols; cx += 1) {
        const label = fitLabel(
          colLabels[colOrder[cx] as number] ?? "",
          layout.labelH - 8,
        );
        const x = heat.x + (cx + 0.5) * cellW;
        const y = heat.y + heat.h + 6;
        const t = text(x, y, label, theme.foreground, "end", size);
        t.setAttribute("transform", `rotate(-90 ${x} ${y})`);
        svg.appendChild(t);
      }
    }
    // Row labels to the right of the heatmap.
    if (rowLabelsOn && rowLabels.length === nrows) {
      for (let ry = 0; ry < nrows; ry += 1) {
        const label = fitLabel(
          rowLabels[rowOrder[ry] as number] ?? "",
          layout.labelW - 8,
        );
        const x = heat.x + heat.w + 6;
        const y = heat.y + (ry + 0.5) * cellH + 0.35 * size;
        svg.appendChild(text(x, y, label, theme.foreground, "start", size));
      }
    }
  }

  /** A label cut with an ellipsis to fit `maxW` px at `size` px. */
  function fitLabel(label: string, maxW: number, size = sizes.label): string {
    if (labelWidth(label, size) <= maxW) return label;
    let lo = 0;
    let hi = label.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (labelWidth(`${label.slice(0, mid)}\u2026`, size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? `${label.slice(0, lo)}\u2026` : "";
  }

  function renderColorbar() {
    // A vertical bar in the right-hand gutter, high values at the top, with
    // the legend title running up beside it.
    const { heat } = layout;
    const { label: size, axisTitle } = sizes;
    const barW = 12;
    const x0 = layout.colorbarX;
    const y0 = heat.y + 4;
    // Tall enough that the three tick labels do not touch.
    const barH = Math.max(
      40,
      3 * size,
      Math.min(160, heat.h - (anyMissing ? 30 : 8)),
    );
    const toHex = ramp(rampName());

    // Build a gradient from evenly-sampled stops (viridis/rdbu ramp).
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", gradId);
    // Bottom is low, top is high.
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "1");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "0");
    const STOPS = 24;
    for (let i = 0; i <= STOPS; i += 1) {
      const t = i / STOPS;
      const s = document.createElementNS(SVG_NS, "stop");
      s.setAttribute("offset", `${(t * 100).toFixed(1)}%`);
      s.setAttribute("stop-color", toHex(t));
      grad.appendChild(s);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    svg.appendChild(
      rect(x0, y0, barW, barH, `url(#${gradId})`, theme.axis, 0.75),
    );
    // Max / mid / min beside the bar.
    const lx = x0 + barW + 4;
    const ticks = colorbarTicks();
    svg.appendChild(
      text(lx, y0 + 0.75 * size, ticks[0], theme.muted, "start", size),
    );
    svg.appendChild(
      text(
        lx,
        y0 + barH / 2 + 0.3 * size,
        ticks[1],
        theme.muted,
        "start",
        size,
      ),
    );
    svg.appendChild(text(lx, y0 + barH, ticks[2], theme.muted, "start", size));
    // The title runs up beside the bar, 4 px right of the widest tick label
    // (once turned, its letters stand 1.1 times its size left of its
    // baseline), cut to the widget height and kept inside the widget.
    const tickW = colorbarTickWidth();
    const label = fitLabel(
      opts.legendTitle + (opts.zScore ? " (row z-score)" : ""),
      height - 8,
      axisTitle,
    );
    const titleW = labelWidth(label, axisTitle);
    const tx = Math.min(
      width - 0.3 * axisTitle - 1,
      lx + tickW + 4 + 1.1 * axisTitle,
    );
    const ty = Math.min(
      Math.max(y0 + barH / 2, 4 + titleW / 2),
      height - 4 - titleW / 2,
    );
    const title = text(tx, ty, label, theme.foreground, "middle", axisTitle);
    title.setAttribute("transform", `rotate(-90 ${tx} ${ty})`);
    svg.appendChild(title);
    // A grey swatch for missing cells, when the matrix has any.
    if (anyMissing) {
      const sy = y0 + barH + 10;
      svg.appendChild(rect(x0, sy, barW, 10, MISSING_COLOR, theme.axis, 0.75));
      svg.appendChild(
        text(lx, sy + 5 + 0.36 * size, "NA", theme.foreground, "start", size),
      );
    }
  }

  // ---- pointer / tooltip ----
  const lastPointer = { x: 0, y: 0 };
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (nrows === 0 || ncols === 0) return;
    const rectEl = el.getBoundingClientRect();
    const px = e.clientX - rectEl.left;
    const py = e.clientY - rectEl.top;
    const { heat } = layout;
    if (
      px < heat.x ||
      px > heat.x + heat.w ||
      py < heat.y ||
      py > heat.y + heat.h
    ) {
      tooltip.hide();
      return;
    }
    const cx = Math.min(
      ncols - 1,
      Math.max(0, Math.floor(((px - heat.x) / heat.w) * ncols)),
    );
    const ry = Math.min(
      nrows - 1,
      Math.max(0, Math.floor(((py - heat.y) / heat.h) * nrows)),
    );
    const srcRow = rowOrder[ry] as number;
    const srcCol = colOrder[cx] as number;
    const v = cellAt(display, ncols, srcRow, srcCol);
    const rl = rowLabels[srcRow] ?? `row ${srcRow}`;
    const cl = colLabels[srcCol] ?? `col ${srcCol}`;
    tooltip.show(
      `<b>${escapeHtml(rl)}</b> × <b>${escapeHtml(cl)}</b><br/>${fmt(v)}`,
      e.clientX,
      e.clientY,
    );
  };
  const onLeave = () => tooltip.hide();
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);

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
    l.setAttribute("shape-rendering", "crispEdges");
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

  function doResize(w: number, h: number) {
    width = w;
    height = h;
    relayout();
  }

  // Initial sizing.
  {
    const m = measure(el);
    width = m.width;
    height = m.height;
    if (data.columns.values) applyData();
    else relayout();
  }

  const instance: PlotomicsInstance<ClustermapOptions> = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      const prev = opts;
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      sizes = textSizes(theme);
      // R and Python send every option on each update, so compare values:
      // clustering again costs seconds on a large matrix.
      const recluster =
        opts.metric !== prev.metric ||
        opts.linkage !== prev.linkage ||
        opts.zScore !== prev.zScore ||
        opts.clusterRows !== prev.clusterRows ||
        opts.clusterCols !== prev.clusterCols;
      if (recluster) applyData();
      else if (opts.colormap !== prev.colormap) {
        // A new ramp changes the colours and the domain, not the order.
        computeColorDomain();
        paintCells();
        relayout();
      } else relayout();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Composite: rasterized heatmap as an <image>, vector overlay on top.
      const out = svg.cloneNode(true) as SVGSVGElement;
      if (nrows > 0 && ncols > 0) {
        const img = document.createElementNS(SVG_NS, "image");
        const { x, y, w, h } = layout.heat;
        img.setAttribute("x", String(x));
        img.setAttribute("y", String(y));
        img.setAttribute("width", String(w));
        img.setAttribute("height", String(h));
        img.setAttribute("preserveAspectRatio", "none");
        img.setAttribute("href", canvas.toDataURL("image/png"));
        img.setAttribute("image-rendering", "pixelated");
        out.insertBefore(img, out.firstChild);
      }
      out.setAttribute("width", String(width));
      out.setAttribute("height", String(height));
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      // The cells come from one pixel per cell, or per pooled block when
      // the image has fewer pixels than cells, so they stay sharp at any
      // scale; the dendrograms, labels and colour bar go over.
      const { x, y, w, h } = layout.heat;
      const k = dpr() * scale;
      return compositePNG({
        width,
        height,
        scale,
        background: theme.background,
        layers:
          nrows > 0 && ncols > 0
            ? [
                {
                  canvas: cellImage(Math.round(w * k), Math.round(h * k)),
                  x,
                  y,
                  width: w,
                  height: h,
                },
              ]
            : [],
        overlay: svg,
      });
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
/** One axis's leaf order and dendrogram, with the inputs that made them. */
interface AxisCache {
  key: string;
  order: number[];
  dendro: Dendrogram | null;
}
/** Whether two value arrays hold the same numbers (NaN equal to NaN). */
function sameValues(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) return false;
  }
  return true;
}
/** Copy to a Float32Array, reading null (R's NA) as NaN, not 0. */
function toFloat32(src: ArrayLike<number | null>, n: number): Float32Array {
  if (src instanceof Float32Array && src.length === n) return src;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = src[i];
    out[i] = v == null ? Number.NaN : v;
  }
  return out;
}
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "NA";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mergeOptions(
  base: ClustermapOptions,
  next?: Partial<ClustermapOptions>,
): ClustermapOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
