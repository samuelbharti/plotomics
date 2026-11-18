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
  type TextSizes,
  ramp,
  resolveTheme,
  defaultTheme,
  textSizes,
  textWidth,
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
/** Gap between the grid and the legends. */
const LEGEND_GAP = 18;
/**
 * Right gutter for the legends: it may always grow to this width, and has it
 * when the legends were not measured.
 */
const LEGEND_RIGHT = 104;
/** Bounds of the left gutter; the upper one is for the default text size. */
const MIN_LEFT = 52;
const MAX_LEFT = 150;
/** The largest share of the widget's width or height that a gutter takes. */
const MAX_GUTTER_SHARE = 0.35;
const DEFAULT_SIZES = textSizes(defaultTheme);

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

/** Widths in px of the text that sets the gutters of {@link layoutDotplot}. */
export interface DotplotText {
  /** Text sizes of the plot; the default theme's when absent. */
  sizes?: TextSizes;
  /** The longest row label. */
  rowLabel?: number;
  /** The longest column label. */
  colLabel?: number;
  /** The widest line of the two legends. */
  legend?: number;
}

/**
 * Frame the grid. The left gutter takes the longest row label, the bottom
 * gutter the longest column label turned 45 degrees, and the right gutter
 * the legends, all measured at the theme's text size, so the labels are not
 * clipped. A gutter takes at most a share of the widget; the plot cuts a
 * longer label to fit.
 */
export function layoutDotplot(
  width: number,
  height: number,
  nGenes: number,
  nClusters: number,
  opts: Pick<DotplotOptions, "showLegend">,
  text: DotplotText = {},
): DotplotLayout {
  const size = (text.sizes ?? DEFAULT_SIZES).label;
  // Eight characters of a label, for a width that was not measured.
  const guess = 8 * 0.58 * size;
  const right = opts.showLegend
    ? Math.min(
        LEGEND_GAP + (text.legend ?? LEGEND_RIGHT - LEGEND_GAP - 8) + 8,
        Math.max(LEGEND_RIGHT, Math.floor(width * MAX_GUTTER_SHARE)),
      )
    : 20;
  const top = 12;
  const colLabel = text.colLabel ?? guess;
  const bottom = Math.min(
    Math.ceil((colLabel + 0.3 * size) * Math.SQRT1_2) + 12,
    Math.floor(height * MAX_GUTTER_SHARE),
  );
  const maxLeft = Math.min(
    (MAX_LEFT * size) / DEFAULT_SIZES.label,
    Math.floor(width * MAX_GUTTER_SHARE),
  );
  let left = Math.min(
    Math.max(MIN_LEFT, (text.rowLabel ?? guess) + 12),
    Math.max(MIN_LEFT, maxLeft),
  );
  // The first column label runs down and to the left of its column; widen
  // the gutter until that label stays inside the widget.
  if (nClusters > 0) {
    const reach =
      (Math.min(colLabel, colLabelRoom(bottom, size)) + 1.1 * size) *
        Math.SQRT1_2 +
      2;
    const half = 1 / (2 * nClusters);
    left = Math.max(left, (reach - (width - right) * half) / (1 - half));
  }
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
 * Length in px a column label may take, turned 45 degrees under the grid in
 * a gutter `bottom` px tall, at `size` px.
 */
function colLabelRoom(bottom: number, size: number): number {
  return Math.max(0, (bottom - 12) * Math.SQRT2 - 0.3 * size);
}

/**
 * Radius for a percentage, area-proportional.
 *
 * `sqrt` is not cosmetic: readers compare dots by the ink they see, which is
 * area. A linear radius would make a 50 percent dot look a quarter of a 100
 * percent one rather than half.
 */
export function dotRadius(pct: number, maxRadius: number): number {
  // Number.isFinite, since R sends NA as null and isFinite(null) is true.
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return maxRadius * Math.sqrt(Math.min(100, pct) / 100);
}

/**
 * Min/max of the finite values of a column, falling back to `[0, 1]` for
 * empty or flat input. A missing value (null from R, NaN from Python) is
 * skipped.
 */
export function valueExtent(col: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col[i] as number;
    if (!Number.isFinite(v)) continue;
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

export const createDotplot: PlotomicsFactory<DotplotOptions> = (
  el,
  initial,
) => {
  let opts: DotplotOptions = mergeOptions(
    defaultDotplotOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutDotplot(0, 0, 0, 0, opts, { sizes });

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
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
    // A non-finite end of a given domain (null from R's NA or Inf) falls
    // back to the data's own end, so the colour bar always has numbers.
    const auto = valueExtent(valueCol());
    const given = opts.valueDomain;
    if (!given) return auto;
    const lo = Number.isFinite(given[0]) ? given[0] : auto[0];
    const hi = Number.isFinite(given[1]) ? given[1] : auto[1];
    return [lo, hi];
  }
  const valueTitle = () => (data.meta?.valueLabel as string) ?? "value";
  const sizeTitle = () => (data.meta?.sizeLabel as string) ?? "% expressing";
  /** Whether a drawn dot has no value, so the legend keys the open ring. */
  function anyMissing(): boolean {
    const val = valueCol();
    const pct = pctCol();
    for (let i = 0; i < val.length; i += 1) {
      if (
        !Number.isFinite(val[i] as number) &&
        dotRadius(pct[i] as number, 1) > 0
      ) {
        return true;
      }
    }
    return false;
  }

  // ---- text ----
  const tw = (s: string, size: number) => textWidth(s, size, theme.fontFamily);
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
  /** Width of the widest line of the two legends. */
  function legendWidth(): number {
    const { label, axisTitle } = sizes;
    const [lo, hi] = domain();
    const entry = opts.maxRadius * 2 + 8;
    return Math.max(
      tw(valueTitle(), axisTitle),
      tw(sizeTitle(), axisTitle),
      14 + Math.max(tw(fmt(hi), label), tw(fmt(lo), label)),
      entry + tw("100%", label),
      anyMissing() ? entry + tw("no value", label) : 0,
    );
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
    const pct = pctCol()[i] as number;
    const value = valueCol()[i] as number;
    tooltip.show(
      `<b>${esc(geneCol()[i] ?? "")}</b> in ${esc(clusterCol()[i] ?? "")}<br/>` +
        `${Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "NA"} expressing<br/>` +
        `${esc(valueLabel)} ${Number.isFinite(value) ? value.toFixed(2) : "NA"}`,
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
    const longest = (labels: string[]) =>
      labels.reduce((m, s) => Math.max(m, tw(s, sizes.label)), 0);
    layout = layoutDotplot(width, height, g.length, c.length, opts, {
      sizes,
      rowLabel: longest(g),
      colLabel: longest(c),
      legend: opts.showLegend ? legendWidth() : 0,
    });

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
    const maxR = Math.min(
      opts.maxRadius,
      layout.cellW / 2 - 1,
      layout.cellH / 2 - 1,
    );

    for (let i = 0; i < gc.length; i += 1) {
      const row = gIndex.get(gc[i] as string);
      const col = cIndex.get(cc[i] as string);
      if (row === undefined || col === undefined) continue;
      const r = dotRadius(pct[i] as number, maxR);
      if (r <= 0) continue;
      const v = val[i] as number;
      ctx.beginPath();
      ctx.arc(
        layout.left + (col + 0.5) * layout.cellW,
        layout.top + (row + 0.5) * layout.cellH,
        r,
        0,
        Math.PI * 2,
      );
      if (!Number.isFinite(v)) {
        // No value to colour by: an open ring keeps the size readable
        // without claiming the lowest colour.
        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = 1;
        ctx.stroke();
        continue;
      }
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
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
        svg.appendChild(
          line(layout.left, y, layout.left + layout.plotW, y, theme.grid),
        );
      }
    }

    // Row labels, thinned when the rows are tighter than the type, and cut
    // to the gutter.
    const { label, axisTitle } = sizes;
    const rowStep = Math.max(1, Math.ceil(label / layout.cellH));
    for (let r = 0; r < g.length; r += rowStep) {
      svg.appendChild(
        text(
          layout.left - 7,
          layout.top + (r + 0.5) * layout.cellH + 0.35 * label,
          fit(g[r] ?? "", layout.left - 9, label),
          theme.foreground,
          "end",
          label,
        ),
      );
    }

    // Column labels, rotated: group names are long and would collide flat.
    const colRoom = colLabelRoom(layout.bottom, label);
    for (let k = 0; k < c.length; k += 1) {
      const x = layout.left + (k + 0.5) * layout.cellW;
      const y = layout.top + layout.plotH + 8;
      const t = text(
        x,
        y,
        fit(c[k] ?? "", colRoom, label),
        theme.foreground,
        "end",
        label,
      );
      t.setAttribute("transform", `rotate(-45 ${x} ${y})`);
      svg.appendChild(t);
    }

    if (!opts.showLegend) return;
    const lx = layout.left + layout.plotW + LEGEND_GAP;
    // Room for a legend line before the right edge of the widget.
    const room = width - lx - 8;

    // Colourbar, built from the same ramp the dots use, under its title.
    const paint = ramp(opts.colormap);
    const [lo, hi] = domain();
    const titleY = layout.top + Math.round(0.8 * axisTitle);
    const barTop = titleY + Math.round(0.3 * axisTitle) + 6;
    const barH = Math.min(120, layout.plotH * 0.4);
    const steps = 40;
    for (let i = 0; i < steps; i += 1) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(lx));
      rect.setAttribute("y", String(barTop + (i / steps) * barH));
      rect.setAttribute("width", "10");
      rect.setAttribute("height", String(barH / steps + 0.6));
      // Top of the bar is the high end, which is how a colourbar reads.
      rect.setAttribute("fill", paint(1 - i / steps));
      svg.appendChild(rect);
    }
    svg.appendChild(
      text(
        lx,
        titleY,
        fit(valueTitle(), room, axisTitle),
        theme.muted,
        "start",
        axisTitle,
      ),
    );
    svg.appendChild(
      text(
        lx + 14,
        barTop + 0.75 * label,
        fmt(hi),
        theme.muted,
        "start",
        label,
      ),
    );
    svg.appendChild(
      text(lx + 14, barTop + barH + 2, fmt(lo), theme.muted, "start", label),
    );

    // Size legend. Radii come from dotRadius, so the swatches are literally the
    // same scale the dots use rather than a redrawn approximation.
    const maxR = Math.min(
      opts.maxRadius,
      layout.cellW / 2 - 1,
      layout.cellH / 2 - 1,
    );
    const sizeTitleY =
      barTop + barH + 2 + Math.round(0.3 * label + 10 + 0.8 * axisTitle);
    svg.appendChild(
      text(
        lx,
        sizeTitleY,
        fit(sizeTitle(), room, axisTitle),
        theme.muted,
        "start",
        axisTitle,
      ),
    );
    let sy = sizeTitleY + Math.round(0.3 * axisTitle) + 2 + opts.maxRadius;
    const entryStep = Math.max(opts.maxRadius * 2 + 6, 1.5 * label);
    for (const p of [100, 50, 25]) {
      const r = dotRadius(p, maxR);
      const circ = document.createElementNS(SVG_NS, "circle");
      circ.setAttribute("cx", String(lx + opts.maxRadius));
      circ.setAttribute("cy", String(sy));
      circ.setAttribute("r", String(r));
      circ.setAttribute("fill", theme.muted);
      svg.appendChild(circ);
      svg.appendChild(
        text(
          lx + opts.maxRadius * 2 + 8,
          sy + 0.35 * label,
          `${p}%`,
          theme.muted,
          "start",
          label,
        ),
      );
      sy += entryStep;
    }

    // An open ring marks a dot with no value, when there is one.
    if (anyMissing()) {
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", String(lx + opts.maxRadius));
      ring.setAttribute("cy", String(sy));
      ring.setAttribute("r", "4");
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", theme.muted);
      svg.appendChild(ring);
      svg.appendChild(
        text(
          lx + opts.maxRadius * 2 + 8,
          sy + 0.35 * label,
          "no value",
          theme.muted,
          "start",
          label,
        ),
      );
    }
  }

  // ---- SVG helpers ----
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
  function line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
  ) {
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
      sizes = textSizes(theme);
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
  base: DotplotOptions,
  next?: Partial<DotplotOptions>,
): DotplotOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
