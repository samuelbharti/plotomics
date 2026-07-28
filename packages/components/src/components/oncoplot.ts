/**
 * Oncoplot (OncoPrint) — the cohort alteration landscape.
 *
 * A gene x sample grid of categorical alteration classes, with a per-sample
 * mutation-burden barplot above, a per-gene frequency barplot to the right, and
 * any number of clinical annotation strips below. This is the most recognisable
 * figure in cancer genomics and the one shape the heatmap component cannot
 * cover, because heatmaps map a *continuous* value through a ramp whereas an
 * oncoplot paints discrete classes and needs the marginal panels to read.
 *
 * The whole data layer is one canvas: a 40 x 1000 grid is 40,000 cells, and at
 * cohort scale (hundreds of genes) it is hundreds of thousands, so per-cell
 * DOM nodes are not an option. SVG carries only gene labels, axis text and the
 * legend, per the library's rendering rules.
 *
 * The component is a renderer, not an analysis: it draws `meta.genes` and
 * `meta.samples` in exactly the order it is given, and uses the `tmb` and
 * `freq` columns as supplied rather than re-deriving them. Ordering an oncoplot
 * (memo sort, burden sort, clinical sort) is a decision the caller owns, and
 * re-deriving it here would let two renderings of the same data disagree.
 *
 * ## Data contract
 * - `columns.codes`  `number[]`  row-major gene x sample, 0 = unaltered,
 *                                1..K index into `meta.classes` (required)
 * - `columns.tmb`    `number[]`  per-sample burden for the top barplot
 * - `columns.freq`   `number[]`  per-gene percent altered for the right barplot
 * - `meta.nrows` / `meta.ncols`  grid dimensions (required)
 * - `meta.genes` / `meta.samples`  row / column labels, in display order
 * - `meta.classes`      `string[]`  legend levels; code k maps to classes[k-1]
 * - `meta.classColors`  `string[]`  one hex per class
 * - `meta.annotations`  `{ name, levels, codes, colors }[]`  clinical strips
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type Column,
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
  OKABE_ITO,
} from "@plotomics/core";

export interface OncoplotOptions {
  /** Fraction of a cell's width left blank between columns, in [0, 0.5). */
  cellGapX: number;
  /** Fraction of a cell's height left blank between rows, in [0, 0.5). */
  cellGapY: number;
  /** Draw the per-sample burden barplot above the grid. */
  showBurden: boolean;
  /** Draw the per-gene frequency barplot to the right of the grid. */
  showFrequency: boolean;
  /** Draw the clinical annotation strips below the grid. */
  showAnnotations: boolean;
  /** Draw the alteration-class legend. */
  showLegend: boolean;
  /** Fill for a gene x sample cell with no alteration. */
  emptyColor: string;
  burdenColor: string;
  frequencyColor: string;
  /** Axis label under the grid. */
  xLabel: string;
  /** Label for the burden axis. */
  burdenLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultOncoplotOptions: OncoplotOptions = {
  cellGapX: 0.12,
  cellGapY: 0.16,
  showBurden: true,
  showFrequency: true,
  showAnnotations: true,
  showLegend: true,
  emptyColor: "#EFE9DC",
  burdenColor: "#0E7175",
  frequencyColor: "#ED773C",
  xLabel: "samples",
  burdenLabel: "alterations",
  theme: {},
};

export interface OncoplotAnnotation {
  name: string;
  levels: string[];
  /** 0-based level code per sample; negative or out-of-range renders as blank. */
  codes: ArrayLike<number>;
  colors?: string[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Height of one clinical annotation strip, in CSS pixels. */
const ANN_ROW_H = 13;
/** Gap between the grid and the annotation strips. */
const ANN_GAP = 6;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/oncoplot.test.ts)
// ---------------------------------------------------------------------------

export interface OncoplotLayout {
  /** Left edge of the grid (gene labels live to the left of it). */
  left: number;
  /** Top edge of the grid (the burden barplot sits above it). */
  top: number;
  /** Grid width and height in CSS pixels. */
  gridW: number;
  gridH: number;
  /** Width reserved for the right-hand frequency barplot (0 when hidden). */
  freqW: number;
  /** Height reserved for the top burden barplot (0 when hidden). */
  burdenH: number;
  /** Vertical extent of the annotation strips (0 when hidden or absent). */
  annH: number;
  cellW: number;
  cellH: number;
}

/**
 * Split the container into the five oncoplot regions. Pure arithmetic so the
 * geometry can be asserted without a canvas.
 */
export function layoutOncoplot(
  width: number,
  height: number,
  nrows: number,
  ncols: number,
  nAnnotations: number,
  opts: Pick<OncoplotOptions, "showBurden" | "showFrequency" | "showAnnotations" | "showLegend">,
  geneLabelW = 96,
): OncoplotLayout {
  const burdenH = opts.showBurden ? Math.min(72, Math.max(36, height * 0.14)) : 0;
  const freqW = opts.showFrequency ? 96 : 0;
  const annCount = opts.showAnnotations ? nAnnotations : 0;
  const annH = annCount > 0 ? ANN_GAP + annCount * ANN_ROW_H : 0;
  const legendH = opts.showLegend ? 30 : 0;
  const bottomAxis = 16;

  const left = geneLabelW;
  const top = burdenH;
  const gridW = Math.max(1, width - left - freqW - 8);
  const gridH = Math.max(1, height - top - annH - legendH - bottomAxis);

  return {
    left,
    top,
    gridW,
    gridH,
    freqW,
    burdenH,
    annH,
    cellW: gridW / Math.max(1, ncols),
    cellH: gridH / Math.max(1, nrows),
  };
}

/**
 * Largest value in a numeric column, floored at 1 so bar scales never divide by
 * zero on an all-zero column.
 */
export function columnMax(col: Column | undefined): number {
  if (!col || col.length === 0) return 1;
  let m = 0;
  for (let i = 0; i < col.length; i += 1) {
    const v = (col as ArrayLike<number>)[i] as number;
    if (v > m) m = v;
  }
  return m > 0 ? m : 1;
}

/**
 * Pick which row labels to draw. Below `maxLabels` every gene is labelled;
 * above it, labels would collide, so none are drawn and the tooltip carries the
 * gene name instead. Returning an explicit set keeps the decision testable.
 */
export function visibleRowLabels(nrows: number, cellH: number, minSpacing = 9): Set<number> {
  const out = new Set<number>();
  if (cellH < minSpacing) return out;
  for (let r = 0; r < nrows; r += 1) out.add(r);
  return out;
}

/** Map a grid pixel back to a (row, col) cell, or null when outside the grid. */
export function hitTest(
  px: number,
  py: number,
  layout: OncoplotLayout,
  nrows: number,
  ncols: number,
): { row: number; col: number } | null {
  const cx = px - layout.left;
  const cy = py - layout.top;
  if (cx < 0 || cy < 0 || cx >= layout.gridW || cy >= layout.gridH) return null;
  const col = Math.floor(cx / layout.cellW);
  const row = Math.floor(cy / layout.cellH);
  if (row < 0 || row >= nrows || col < 0 || col >= ncols) return null;
  return { row, col };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createOncoplot: PlotomicsFactory<OncoplotOptions> = (el, initial) => {
  let opts: OncoplotOptions = mergeOptions(defaultOncoplotOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutOncoplot(0, 0, 1, 1, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- data accessors ----
  const nrows = () => (data.meta?.nrows as number) ?? 0;
  const ncols = () => (data.meta?.ncols as number) ?? 0;
  const genes = () => (data.meta?.genes as string[]) ?? [];
  const samples = () => (data.meta?.samples as string[]) ?? [];
  const classes = () => (data.meta?.classes as string[]) ?? [];
  const annotations = () => (data.meta?.annotations as OncoplotAnnotation[]) ?? [];
  function classColors(): string[] {
    const given = data.meta?.classColors as string[] | undefined;
    if (given && given.length) return given;
    return classes().map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }
  function annColors(a: OncoplotAnnotation): string[] {
    if (a.colors && a.colors.length) return a.colors;
    return a.levels.map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top, layout, nrows(), ncols());
    if (!hit) {
      tooltip.hide();
      return;
    }
    const codes = data.columns.codes as ArrayLike<number> | undefined;
    const code = codes ? (codes[hit.row * ncols() + hit.col] as number) : 0;
    const cls = code > 0 ? classes()[code - 1] ?? "altered" : "no alteration";
    const g = genes()[hit.row] ?? `row ${hit.row}`;
    const s = samples()[hit.col] ?? `col ${hit.col}`;
    tooltip.show(`<b>${esc(g)}</b><br/>${esc(s)}<br/>${esc(cls)}`, lastPointer.x, lastPointer.y);
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
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const R = nrows();
    const C = ncols();
    layout = layoutOncoplot(width, height, R, C, annotations().length, opts);
    if (R === 0 || C === 0) {
      renderOverlay();
      return;
    }

    const codes = data.columns.codes as ArrayLike<number> | undefined;
    const cols = classColors();
    const { left, top, cellW, cellH } = layout;
    const gapX = cellW * opts.cellGapX;
    const gapY = cellH * opts.cellGapY;
    // Sub-pixel cells still need to be visible, so never draw thinner than 1px.
    const w = Math.max(1, cellW - gapX);
    const h = Math.max(1, cellH - gapY);

    // Grid. Painting every cell's background first and overpainting the altered
    // ones keeps the common case (a mostly-empty matrix) to one fill style.
    ctx.fillStyle = opts.emptyColor;
    for (let r = 0; r < R; r += 1) {
      const y = top + r * cellH + gapY / 2;
      for (let c = 0; c < C; c += 1) {
        ctx.fillRect(left + c * cellW + gapX / 2, y, w, h);
      }
    }
    if (codes) {
      for (let r = 0; r < R; r += 1) {
        const y = top + r * cellH + gapY / 2;
        for (let c = 0; c < C; c += 1) {
          const code = codes[r * C + c] as number;
          if (!code) continue;
          ctx.fillStyle = cols[code - 1] ?? theme.foreground;
          ctx.fillRect(left + c * cellW + gapX / 2, y, w, h);
        }
      }
    }

    // Top burden barplot, one bar per sample column.
    if (opts.showBurden && layout.burdenH > 0) {
      const tmb = data.columns.tmb as ArrayLike<number> | undefined;
      if (tmb) {
        const max = columnMax(tmb);
        const usable = layout.burdenH - 10;
        ctx.fillStyle = opts.burdenColor;
        for (let c = 0; c < C; c += 1) {
          const v = (tmb[c] as number) ?? 0;
          const bh = (v / max) * usable;
          ctx.fillRect(left + c * cellW + gapX / 2, top - 6 - bh, w, bh);
        }
      }
    }

    // Right frequency barplot, one bar per gene row.
    if (opts.showFrequency && layout.freqW > 0) {
      const freq = data.columns.freq as ArrayLike<number> | undefined;
      if (freq) {
        const max = columnMax(freq);
        const x0 = left + layout.gridW + 6;
        const usable = layout.freqW - 44;
        ctx.fillStyle = opts.frequencyColor;
        for (let r = 0; r < R; r += 1) {
          const v = (freq[r] as number) ?? 0;
          ctx.fillRect(x0, top + r * cellH + gapY / 2, (v / max) * usable, h);
        }
      }
    }

    // Clinical annotation strips.
    if (opts.showAnnotations && layout.annH > 0) {
      const anns = annotations();
      let y = top + layout.gridH + ANN_GAP;
      for (const a of anns) {
        const palette = annColors(a);
        for (let c = 0; c < C; c += 1) {
          const code = (a.codes[c] as number) ?? -1;
          if (code < 0 || code >= a.levels.length) {
            ctx.fillStyle = opts.emptyColor;
          } else {
            ctx.fillStyle = palette[code % palette.length] as string;
          }
          ctx.fillRect(left + c * cellW + gapX / 2, y, w, ANN_ROW_H - 2);
        }
        y += ANN_ROW_H;
      }
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const R = nrows();
    const C = ncols();
    const { left, top, cellH } = layout;

    // Gene labels, right-aligned against the grid.
    const showRow = visibleRowLabels(R, cellH);
    const g = genes();
    for (let r = 0; r < R; r += 1) {
      if (!showRow.has(r)) continue;
      const y = top + r * cellH + cellH / 2 + 3;
      svg.appendChild(text(left - 8, y, g[r] ?? "", theme.foreground, "end", 10, "italic"));
    }

    // Frequency values, printed past the end of each bar.
    if (opts.showFrequency && layout.freqW > 0) {
      const freq = data.columns.freq as ArrayLike<number> | undefined;
      if (freq) {
        const max = columnMax(freq);
        const x0 = left + layout.gridW + 6;
        const usable = layout.freqW - 44;
        for (let r = 0; r < R; r += 1) {
          if (!showRow.has(r)) continue;
          const v = (freq[r] as number) ?? 0;
          const y = top + r * cellH + cellH / 2 + 3;
          svg.appendChild(
            text(x0 + (v / max) * usable + 4, y, `${fmtPct(v)}%`, theme.muted, "start", 9),
          );
        }
      }
    }

    // Burden axis: just the maximum, which is all the scale a reader needs.
    if (opts.showBurden && layout.burdenH > 0) {
      const tmb = data.columns.tmb as ArrayLike<number> | undefined;
      if (tmb) {
        svg.appendChild(text(left - 8, 12, String(columnMax(tmb)), theme.muted, "end", 9));
        svg.appendChild(text(left - 8, layout.burdenH - 8, opts.burdenLabel, theme.muted, "end", 9));
      }
    }

    // Annotation strip names.
    if (opts.showAnnotations && layout.annH > 0) {
      let y = top + layout.gridH + ANN_GAP;
      for (const a of annotations()) {
        svg.appendChild(text(left - 8, y + ANN_ROW_H - 4, a.name, theme.muted, "end", 9));
        y += ANN_ROW_H;
      }
    }

    // Sample count under the grid.
    svg.appendChild(
      text(
        left + layout.gridW / 2,
        top + layout.gridH + layout.annH + 13,
        `${C.toLocaleString()} ${opts.xLabel}`,
        theme.muted,
        "middle",
        10,
      ),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const cls = classes();
    if (!cls.length) return;
    const cols = classColors();
    const y = height - 10;
    let x = layout.left;
    for (let i = 0; i < cls.length; i += 1) {
      const sw = document.createElementNS(SVG_NS, "rect");
      sw.setAttribute("x", String(x));
      sw.setAttribute("y", String(y - 9));
      sw.setAttribute("width", "9");
      sw.setAttribute("height", "9");
      sw.setAttribute("fill", cols[i] ?? theme.foreground);
      svg.appendChild(sw);
      svg.appendChild(text(x + 13, y, cls[i] ?? "", theme.foreground, "start", 10));
      x += 13 + estimateTextWidth(cls[i] ?? "", 10) + 14;
    }
  }

  // ---- SVG helpers ----
  function text(
    x: number,
    y: number,
    content: string,
    fill: string,
    anchor: string,
    size = 10,
    style?: string,
  ) {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", fill);
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("font-family", theme.fontFamily);
    t.setAttribute("font-size", String(size));
    if (style) t.setAttribute("font-style", style);
    t.textContent = content;
    return t;
  }

  function doResize(w: number, h: number) {
    width = w;
    height = h;
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    doResize(m.width, m.height);
  }

  const instance: PlotomicsInstance<OncoplotOptions> = {
    setData(next) {
      data = next;
      render();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      render();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Hybrid figure: the rasterized grid plus vector labels and legend.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      return canvasToPNG(canvas, scale);
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
function fmtPct(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
}
/** Rough advance width for legend layout; avoids a DOM measure per label. */
function estimateTextWidth(s: string, size: number): number {
  return s.length * size * 0.56;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: OncoplotOptions, next?: Partial<OncoplotOptions>): OncoplotOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
