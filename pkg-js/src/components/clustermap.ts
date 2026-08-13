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
 * display canvas, which stays smooth for very large matrices. The
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
  resolveTheme,
  ramp,
  viridis,
  rdbu,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
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
  symmetricExtent,
  toColVectors,
  toRowVectors,
  zScoreByRow,
} from "./clustermap-cluster.js";

export interface ClustermapOptions {
  /** Distance metric for clustering. */
  metric: Metric;
  /** Agglomeration (linkage) method. */
  linkage: Linkage;
  /** Sequential 'viridis' or diverging 'rdbu' color ramp. */
  colormap: RampName;
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
  colormap: "viridis",
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

// Fixed gutters around the heatmap. Dendrogram bands collapse to 0 when hidden
// or when the axis is not clustered.
const DENDRO = 90; // px band for a dendrogram
const LABEL = 90; // px reserved for tick labels
const COLORBAR = 54; // px reserved at the bottom for the colorbar
const PAD = 12;
const MIN_LABEL_CELL = 9; // hide labels once a cell is smaller than this (px)

// ---------------------------------------------------------------------------
// Pure layout helper (kept here, exercised via the factory + tests)
// ---------------------------------------------------------------------------

export interface Layout {
  rowDendroW: number;
  colDendroH: number;
  labelW: number; // right-side row labels reserve
  labelH: number; // bottom col labels reserve
  heat: { x: number; y: number; w: number; h: number };
}

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
): Layout {
  const rowDendroW = opts.showRowDendrogram && opts.hasRowDendro ? DENDRO : 0;
  const colDendroH = opts.showColDendrogram && opts.hasColDendro ? DENDRO : 0;
  const labelW = opts.showLabels ? LABEL : PAD;
  const labelH = opts.showLabels ? LABEL : PAD;
  const x = PAD + rowDendroW;
  const y = PAD + colDendroH;
  const w = Math.max(1, width - x - labelW);
  const h = Math.max(1, height - y - labelH - COLORBAR);
  return {
    rowDendroW,
    colDendroH,
    labelW,
    labelH,
    heat: { x, y, w, h },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createClustermap: PlotomicsFactory<ClustermapOptions> = (el, initial) => {
  let opts: ClustermapOptions = mergeOptions(defaultClustermapOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

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

  // DOM: display canvas for the heatmap + full-size SVG overlay. A small
  // offscreen canvas holds one pixel per cell and is upscaled onto the display.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;image-rendering:pixelated;";
  const cellCanvas = document.createElement("canvas"); // offscreen (nrows×ncols)
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

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
    const rl = Array.isArray(meta.rowLabels) ? (meta.rowLabels as unknown[]) : [];
    const cl = Array.isArray(meta.colLabels) ? (meta.colLabels as unknown[]) : [];
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

    if (!rawValues || nrows <= 0 || ncols <= 0 || rawValues.length < nrows * ncols) {
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

    display = opts.zScore
      ? zScoreByRow(rawValues, nrows, ncols)
      : toFloat32(rawValues, nrows * ncols);

    // Color domain: symmetric for diverging maps (rdbu / z-score), else data extent.
    diverging = opts.colormap === "rdbu" || opts.zScore;
    [colorLo, colorHi] = diverging ? symmetricExtent(display) : dataExtent(display);

    rowLabels = meta.rowLabels;
    colLabels = meta.colLabels;

    // Row ordering: precomputed > cluster > identity.
    const rowPre = normalizePrecomputed(meta.rowLinkage, nrows);
    if (rowPre) {
      rowOrder = rowPre.order;
      rowDendro = rowPre.dendrogram;
    } else if (opts.clusterRows && nrows <= MAX_CLUSTER_N && nrows >= 2) {
      const res = clusterVectors(
        toRowVectors(display, nrows, ncols),
        opts.metric,
        opts.linkage,
      );
      rowOrder = res.order;
      rowDendro = res.dendrogram;
    } else {
      rowOrder = identityOrder(nrows);
      rowDendro = null;
    }

    const colPre = normalizePrecomputed(meta.colLinkage, ncols);
    if (colPre) {
      colOrder = colPre.order;
      colDendro = colPre.dendrogram;
    } else if (opts.clusterCols && ncols <= MAX_CLUSTER_N && ncols >= 2) {
      const res = clusterVectors(
        toColVectors(display, nrows, ncols),
        opts.metric,
        opts.linkage,
      );
      colOrder = res.order;
      colDendro = res.dendrogram;
    } else {
      colOrder = identityOrder(ncols);
      colDendro = null;
    }

    paintCells();
    relayout();
  }

  // ---- heatmap painting (canvas data layer) ----
  function paintCells() {
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
        const t = (v - colorLo) / span;
        const [r, g, b] = toColor(t);
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
    const fn = opts.colormap === "rdbu" ? rdbu : viridis;
    return (t: number) => fn(t < 0 ? 0 : t > 1 ? 1 : t);
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
    // Nearest-neighbour upscale from the 1px-per-cell offscreen buffer.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cellCanvas, 0, 0, ncols, nrows, 0, 0, canvas.width, canvas.height);
  }

  // ---- layout + overlay ----
  function relayout() {
    layout = computeLayout(width, height, {
      showRowDendrogram: opts.showRowDendrogram,
      showColDendrogram: opts.showColDendrogram,
      hasRowDendro: !!rowDendro,
      hasColDendro: !!colDendro,
      showLabels: opts.showLabels,
    });
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
        text(width / 2, height / 2, "No data", theme.muted, "middle", theme.fontSize),
      );
      return;
    }
    const { heat } = layout;
    const cellW = heat.w / ncols;
    const cellH = heat.h / nrows;

    // Frame around the heatmap.
    svg.appendChild(rect(heat.x, heat.y, heat.w, heat.h, "none", theme.axis, 1));

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
    // Column labels below the heatmap (rotated), if they fit.
    if (colLabels.length === ncols && cellW >= MIN_LABEL_CELL) {
      for (let cx = 0; cx < ncols; cx += 1) {
        const label = colLabels[colOrder[cx] as number] ?? "";
        const x = heat.x + (cx + 0.5) * cellW;
        const y = heat.y + heat.h + 6;
        const t = text(x, y, label, theme.foreground, "end", 10);
        t.setAttribute("transform", `rotate(-90 ${x} ${y})`);
        svg.appendChild(t);
      }
    }
    // Row labels to the right of the heatmap.
    if (rowLabels.length === nrows && cellH >= MIN_LABEL_CELL) {
      for (let ry = 0; ry < nrows; ry += 1) {
        const label = rowLabels[rowOrder[ry] as number] ?? "";
        const x = heat.x + heat.w + 6;
        const y = heat.y + (ry + 0.5) * cellH + 3;
        svg.appendChild(text(x, y, label, theme.foreground, "start", 10));
      }
    }
  }

  function renderColorbar() {
    const barW = 180;
    const barH = 10;
    const { heat } = layout;
    const x0 = heat.x;
    const y0 = height - COLORBAR + 18;
    const toHex = ramp(opts.colormap);

    // Build a gradient from evenly-sampled stops (viridis/rdbu ramp).
    const gradId = "cm-grad";
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("x2", "100%");
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

    svg.appendChild(rect(x0, y0, barW, barH, `url(#${gradId})`, theme.axis, 0.75));
    // Min / mid / max ticks.
    const label = opts.legendTitle + (opts.zScore ? " (row z-score)" : "");
    svg.appendChild(text(x0, y0 - 6, label, theme.foreground, "start", 11));
    svg.appendChild(text(x0, y0 + barH + 12, fmt(colorLo), theme.muted, "start", 10));
    svg.appendChild(
      text(x0 + barW / 2, y0 + barH + 12, fmt((colorLo + colorHi) / 2), theme.muted, "middle", 10),
    );
    svg.appendChild(text(x0 + barW, y0 + barH + 12, fmt(colorHi), theme.muted, "end", 10));
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
    if (px < heat.x || px > heat.x + heat.w || py < heat.y || py > heat.y + heat.h) {
      tooltip.hide();
      return;
    }
    const cx = Math.min(ncols - 1, Math.max(0, Math.floor(((px - heat.x) / heat.w) * ncols)));
    const ry = Math.min(nrows - 1, Math.max(0, Math.floor(((py - heat.y) / heat.h) * nrows)));
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
  function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) {
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
  function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: number) {
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
      // Re-cluster only when an option that affects ordering/values changed.
      const needsRecompute =
        next.metric !== undefined ||
        next.linkage !== undefined ||
        next.zScore !== undefined ||
        next.clusterRows !== undefined ||
        next.clusterCols !== undefined ||
        next.colormap !== undefined;
      if (needsRecompute || opts.metric !== prev.metric) applyData();
      else relayout();
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
      // Compose the overlay onto the heatmap into one full-size canvas.
      const ratio = dpr();
      const out = document.createElement("canvas");
      out.width = Math.round(width * ratio * scale);
      out.height = Math.round(height * ratio * scale);
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.scale(ratio * scale, ratio * scale);
      if (nrows > 0 && ncols > 0) {
        const { x, y, w, h } = layout.heat;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cellCanvas, 0, 0, ncols, nrows, x, y, w, h);
      }
      // Rasterize the SVG overlay via an <img>, then draw it on top.
      const svgStr = serializeSVG(svg);
      const blob = await new Promise<Blob | null>((resolve) => {
        const image = new Image();
        image.onload = () => {
          ctx.drawImage(image, 0, 0, width, height);
          out.toBlob(resolve, "image/png");
        };
        image.onerror = () => {
          // Fall back to just the heatmap if the overlay fails to load.
          canvasToPNG(out, 1).then(resolve);
        };
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
      });
      return blob;
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
function toFloat32(src: ArrayLike<number>, n: number): Float32Array {
  if (src instanceof Float32Array && src.length === n) return src;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = src[i] as number;
  return out;
}
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
