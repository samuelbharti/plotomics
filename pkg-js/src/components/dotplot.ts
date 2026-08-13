/**
 * Dotplot — the marker gene grid: features down the rows, groups across the
 * columns, each cell a dot whose size is the fraction of the group expressing
 * the gene and whose colour is the expression level.
 *
 * Two channels carrying different questions is the whole point. Colour alone
 * cannot separate "high in a few cells" from "moderate in all of them", and
 * that distinction is usually what decides whether a gene is a marker. It is
 * the standard scanpy/Seurat figure and readers parse it without instruction.
 *
 * Dot area, not radius, is proportional to the percentage. Scaling radius
 * linearly would quadruple the ink for a doubled percentage, which is the
 * classic way a dot plot overstates its strongest cells.
 *
 * Dots are canvas-drawn; labels, gridlines and both legends are an SVG overlay.
 * The component does not order anything: row and column order is the caller's,
 * because sorting genes by the group they best mark is an analysis decision and
 * two renderers breaking ties differently would draw two different figures.
 *
 * ## Data contract
 * - `columns.gene`     `string[]`  row key per dot (required)
 * - `columns.cluster`  `string[]`  column key per dot (required)
 * - `columns.pct`      `number[]`  percent expressing, 0-100 (dot size)
 * - `columns.value`    `number[]`  expression level (dot colour)
 * - `meta.genes`      `string[]`  row order; defaults to order of appearance
 * - `meta.clusters`   `string[]`  column order; defaults to order of appearance
 * - `meta.valueLabel` `string`    colourbar title
 * - `meta.sizeLabel`  `string`    size-legend title
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
  ramp,
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
} from "../core/index.js";

export interface DotplotOptions {
  /** Sequential ramp for the expression channel. */
  colormap: RampName;
  /** Radius in pixels of a dot at 100 percent. */
  maxRadius: number;
  /** Draw faint gridlines through the dot centres. */
  showGrid: boolean;
  /** Draw the colourbar and the size legend. */
  showLegend: boolean;
  /** Explicit `[min, max]` for the colour channel; `null` uses the data range. */
  valueDomain: [number, number] | null;
  theme: Partial<PlotomicsTheme>;
}

export const defaultDotplotOptions: DotplotOptions = {
  colormap: "viridis",
  maxRadius: 9,
  showGrid: true,
  showLegend: true,
  valueDomain: null,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Width reserved on the right for the two legends. */
const LEGEND_W = 96;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/dotplot.test.ts)
// ---------------------------------------------------------------------------

export interface DotplotLayout {
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  plotW: number;
  plotH: number;
  /** Room reserved for the rotated column labels under the grid. */
  bottom: number;
}

/**
 * Frame the grid. The left gutter scales with the longest row label so gene
 * names are never clipped, and the right gutter holds the legends.
 */
export function layoutDotplot(
  width: number,
  height: number,
  nGenes: number,
  nClusters: number,
  opts: Pick<DotplotOptions, "showLegend">,
  longestLabel = 8,
): DotplotLayout {
  const left = Math.min(150, Math.max(52, longestLabel * 6.4 + 12));
  const right = (opts.showLegend ? LEGEND_W : 12) + 8;
  const top = 12;
  const bottom = 76;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  return {
    left,
    top,
    cellW: nClusters > 0 ? plotW / nClusters : plotW,
    cellH: nGenes > 0 ? plotH / nGenes : plotH,
    plotW,
    plotH,
    bottom,
  };
}

/**
 * Radius for a percentage, area-proportional.
 *
 * `sqrt` is not cosmetic: readers compare dots by the ink they see, which is
 * area. A linear radius would make a 50 percent dot look a quarter of a 100
 * percent one rather than half.
 */
export function dotRadius(pct: number, maxRadius: number): number {
  if (!isFinite(pct) || pct <= 0) return 0;
  return maxRadius * Math.sqrt(Math.min(100, pct) / 100);
}

/** Min/max of a column, falling back to `[0, 1]` for empty or flat input. */
export function valueExtent(col: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col[i] as number;
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

/** Distinct values in first-appearance order; used when meta omits an order. */
export function uniqueInOrder(col: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of col) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createDotplot: PlotomicsFactory<DotplotOptions> = (el, initial) => {
  let opts: DotplotOptions = mergeOptions(defaultDotplotOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutDotplot(0, 0, 0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const geneCol = () => (data.columns.gene as string[]) ?? [];
  const clusterCol = () => (data.columns.cluster as string[]) ?? [];
  const pctCol = () => (data.columns.pct as ArrayLike<number>) ?? [];
  const valueCol = () => (data.columns.value as ArrayLike<number>) ?? [];
  function genes(): string[] {
    const given = data.meta?.genes as string[] | undefined;
    return given && given.length ? given : uniqueInOrder(geneCol());
  }
  function clusters(): string[] {
    const given = data.meta?.clusters as string[] | undefined;
    return given && given.length ? given : uniqueInOrder(clusterCol());
  }
  function domain(): [number, number] {
    return opts.valueDomain ?? valueExtent(valueCol());
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function cellAt(mx: number, my: number): number {
    const g = genes();
    const c = clusters();
    const col = Math.floor((mx - layout.left) / layout.cellW);
    const row = Math.floor((my - layout.top) / layout.cellH);
    if (col < 0 || col >= c.length || row < 0 || row >= g.length) return -1;
    // The data is long-form, so find the dot rather than assuming a dense grid
    // in a particular order.
    const gc = geneCol();
    const cc = clusterCol();
    const wantG = g[row];
    const wantC = c[col];
    for (let i = 0; i < gc.length; i += 1) {
      if (gc[i] === wantG && cc[i] === wantC) return i;
    }
    return -1;
  }
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const i = cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (i < 0) {
      tooltip.hide();
      return;
    }
    const valueLabel = (data.meta?.valueLabel as string) ?? "value";
    tooltip.show(
      `<b>${esc(geneCol()[i] ?? "")}</b> in ${esc(clusterCol()[i] ?? "")}<br/>` +
        `${(pctCol()[i] as number).toFixed(1)}% expressing<br/>` +
        `${esc(valueLabel)} ${(valueCol()[i] as number).toFixed(2)}`,
      lastPointer.x,
      lastPointer.y,
    );
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
    const g = genes();
    const c = clusters();
    const longest = g.reduce((m, s) => Math.max(m, s.length), 4);
    layout = layoutDotplot(width, height, g.length, c.length, opts, longest);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    if (!g.length || !c.length) {
      renderOverlay();
      return;
    }

    const [lo, hi] = domain();
    const paint = ramp(opts.colormap);
    const gc = geneCol();
    const cc = clusterCol();
    const pct = pctCol();
    const val = valueCol();
    const gIndex = new Map(g.map((v, i) => [v, i]));
    const cIndex = new Map(c.map((v, i) => [v, i]));
    // Cap the radius so dots never overlap regardless of the option.
    const maxR = Math.min(opts.maxRadius, layout.cellW / 2 - 1, layout.cellH / 2 - 1);

    for (let i = 0; i < gc.length; i += 1) {
      const row = gIndex.get(gc[i] as string);
      const col = cIndex.get(cc[i] as string);
      if (row === undefined || col === undefined) continue;
      const r = dotRadius(pct[i] as number, maxR);
      if (r <= 0) continue;
      const t = hi > lo ? ((val[i] as number) - lo) / (hi - lo) : 0.5;
      ctx.beginPath();
      ctx.arc(
        layout.left + (col + 0.5) * layout.cellW,
        layout.top + (row + 0.5) * layout.cellH,
        r, 0, Math.PI * 2,
      );
      ctx.fillStyle = paint(Math.max(0, Math.min(1, t)));
      ctx.fill();
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const g = genes();
    const c = clusters();

    if (opts.showGrid) {
      for (let r = 0; r < g.length; r += 1) {
        const y = layout.top + (r + 0.5) * layout.cellH;
        svg.appendChild(line(layout.left, y, layout.left + layout.plotW, y, theme.grid));
      }
    }

    // Row labels, thinned when the rows are tighter than the type.
    const rowStep = Math.max(1, Math.ceil(9 / layout.cellH));
    for (let r = 0; r < g.length; r += rowStep) {
      svg.appendChild(
        text(layout.left - 7, layout.top + (r + 0.5) * layout.cellH + 3,
          g[r] ?? "", theme.foreground, "end", 9),
      );
    }

    // Column labels, rotated: group names are long and would collide flat.
    for (let k = 0; k < c.length; k += 1) {
      const x = layout.left + (k + 0.5) * layout.cellW;
      const y = layout.top + layout.plotH + 8;
      const t = text(x, y, c[k] ?? "", theme.foreground, "end", 9);
      t.setAttribute("transform", `rotate(-45 ${x} ${y})`);
      svg.appendChild(t);
    }

    if (!opts.showLegend) return;
    const lx = layout.left + layout.plotW + 18;

    // Colourbar, built from the same ramp the dots use.
    const paint = ramp(opts.colormap);
    const [lo, hi] = domain();
    const barH = Math.min(120, layout.plotH * 0.4);
    const steps = 40;
    for (let i = 0; i < steps; i += 1) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(lx));
      rect.setAttribute("y", String(layout.top + 16 + (i / steps) * barH));
      rect.setAttribute("width", "10");
      rect.setAttribute("height", String(barH / steps + 0.6));
      // Top of the bar is the high end, which is how a colourbar reads.
      rect.setAttribute("fill", paint(1 - i / steps));
      svg.appendChild(rect);
    }
    svg.appendChild(text(lx, layout.top + 8,
      (data.meta?.valueLabel as string) ?? "value", theme.muted, "start", 9));
    svg.appendChild(text(lx + 14, layout.top + 22, fmt(hi), theme.muted, "start", 8));
    svg.appendChild(text(lx + 14, layout.top + 18 + barH, fmt(lo), theme.muted, "start", 8));

    // Size legend. Radii come from dotRadius, so the swatches are literally the
    // same scale the dots use rather than a redrawn approximation.
    const maxR = Math.min(opts.maxRadius, layout.cellW / 2 - 1, layout.cellH / 2 - 1);
    let sy = layout.top + barH + 52;
    svg.appendChild(text(lx, sy - 12,
      (data.meta?.sizeLabel as string) ?? "% expressing", theme.muted, "start", 9));
    for (const p of [100, 50, 25]) {
      const r = dotRadius(p, maxR);
      const circ = document.createElementNS(SVG_NS, "circle");
      circ.setAttribute("cx", String(lx + opts.maxRadius));
      circ.setAttribute("cy", String(sy));
      circ.setAttribute("r", String(r));
      circ.setAttribute("fill", theme.muted);
      svg.appendChild(circ);
      svg.appendChild(text(lx + opts.maxRadius * 2 + 8, sy + 3, `${p}%`,
        theme.muted, "start", 8));
      sy += Math.max(16, opts.maxRadius * 2 + 6);
    }
  }

  // ---- SVG helpers ----
  function text(x: number, y: number, content: string, fill: string, anchor: string, size = 10) {
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
  function line(x1: number, y1: number, x2: number, y2: number, stroke: string) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", "1");
    return l;
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

  const instance: PlotomicsInstance<DotplotOptions> = {
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
function fmt(v: number): string {
  if (Math.abs(v) >= 100) return String(Math.round(v));
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: DotplotOptions, next?: Partial<DotplotOptions>): DotplotOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
