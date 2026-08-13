/**
 * Violin — stacked violins: one row per feature, one violin per group.
 *
 * A box plot hides bimodality, which in single-cell data is usually the whole
 * story: a gene expressed in half a cluster and silent in the other half has
 * the same median as one expressed weakly everywhere. The violin shows the
 * shape, and stacking rows on a shared x lets you read a marker panel down the
 * page the way a dot plot is read across it.
 *
 * The component draws densities, it does not estimate them. Each violin arrives
 * as a vector of density values on a shared grid, because kernel bandwidth
 * choice changes what the figure claims and belongs with the data, not in the
 * renderer. It also keeps the payload proportional to the grid rather than to
 * the number of cells.
 *
 * Violins are canvas-drawn; labels and axes are an SVG overlay.
 *
 * ## Data contract
 * - `columns.feature`  `string[]`  row key per violin (required)
 * - `columns.group`    `string[]`  column key per violin (required)
 * - `meta.grid`      `number[]`  shared evaluation grid, ascending (required)
 * - `meta.grids`     `number[]`  optional per-feature grids, features x grid,
 *                                row-major. Present means each row gets its own
 *                                y range, which is what a marker panel usually
 *                                wants: one highly expressed gene otherwise
 *                                compresses every other row into a line.
 * - `meta.density`   `number[]`  violins x grid, row-major (required)
 * - `meta.features`  `string[]`  row order; defaults to order of appearance
 * - `meta.groups`    `string[]`  column order; defaults to order of appearance
 * - `meta.groupColors` `string[]`  one colour per group
 * - `meta.median`    `number[]`  per-violin median, drawn as a tick
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
  OKABE_ITO,
} from "@plotomics/core";

export interface ViolinOptions {
  /** Fraction of a cell's width the widest violin fills, in (0, 1]. */
  violinWidth: number;
  /** Scale each violin to its own maximum rather than the row's. Per-row is
   * the honest default: within a gene, groups stay comparable. */
  scalePerViolin: boolean;
  /** Draw the median tick. */
  showMedian: boolean;
  /** Draw the per-row feature labels. */
  showFeatureLabels: boolean;
  theme: Partial<PlotomicsTheme>;
}

export const defaultViolinOptions: ViolinOptions = {
  violinWidth: 0.85,
  scalePerViolin: false,
  showMedian: true,
  showFeatureLabels: true,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/violin.test.ts)
// ---------------------------------------------------------------------------

export interface ViolinLayout {
  left: number;
  top: number;
  cellW: number;
  rowH: number;
  plotW: number;
  plotH: number;
  bottom: number;
}

/** Frame the grid of violins, widening the left gutter for feature names. */
export function layoutViolin(
  width: number,
  height: number,
  nFeatures: number,
  nGroups: number,
  opts: Pick<ViolinOptions, "showFeatureLabels">,
  longestLabel = 8,
): ViolinLayout {
  const left = opts.showFeatureLabels
    ? Math.min(150, Math.max(50, longestLabel * 6.4 + 12))
    : 16;
  const right = 14;
  const top = 10;
  const bottom = 70;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  return {
    left,
    top,
    cellW: nGroups > 0 ? plotW / nGroups : plotW,
    rowH: nFeatures > 0 ? plotH / nFeatures : plotH,
    plotW,
    plotH,
    bottom,
  };
}

/**
 * Read one violin's density row out of the flattened matrix.
 * Returns zeros for a missing or out-of-range row, so a malformed feed draws
 * a flat line rather than throwing.
 */
export function densityRow(
  density: ArrayLike<number> | undefined,
  index: number,
  gridLen: number,
): number[] {
  const out = new Array<number>(gridLen).fill(0);
  if (!density || gridLen <= 0 || index < 0) return out;
  const base = index * gridLen;
  if (base + gridLen > density.length) return out;
  for (let i = 0; i < gridLen; i += 1) out[i] = density[base + i] as number;
  return out;
}

/**
 * The grid for one feature row. With `grids` supplied, each row gets its own
 * slice; otherwise every row shares `grid`. Falls back to the shared grid when
 * the slice would run past the end, so a short `grids` cannot blank a row.
 */
export function gridForRow(
  grid: ArrayLike<number>,
  grids: ArrayLike<number> | undefined,
  row: number,
): number[] {
  const n = grid.length;
  const shared = Array.from({ length: n }, (_, i) => grid[i] as number);
  if (!grids || n === 0 || row < 0) return shared;
  const base = row * n;
  if (base + n > grids.length) return shared;
  return Array.from({ length: n }, (_, i) => grids[base + i] as number);
}

/**
 * Largest density in a set of rows, used to put every violin in a row on one
 * scale. Returns 1 for empty or degenerate input so nothing divides by zero.
 */
export function maxDensity(rows: readonly number[][]): number {
  let max = 0;
  for (const row of rows) {
    for (const v of row) if (isFinite(v) && v > max) max = v;
  }
  return max > 0 ? max : 1;
}

/**
 * Build one violin outline as a closed polygon in unit space: x in
 * `[-1, 1]` (density, mirrored) and y the grid value. The caller scales it.
 */
export function violinPolygon(
  grid: ArrayLike<number>,
  density: readonly number[],
  max: number,
): { x: number; y: number }[] {
  const n = Math.min(grid.length, density.length);
  if (n === 0 || max <= 0) return [];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    pts.push({ x: (density[i] as number) / max, y: grid[i] as number });
  }
  // Mirror back down the other side to close the shape.
  for (let i = n - 1; i >= 0; i -= 1) {
    pts.push({ x: -((density[i] as number) / max), y: grid[i] as number });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createViolin: PlotomicsFactory<ViolinOptions> = (el, initial) => {
  let opts: ViolinOptions = mergeOptions(defaultViolinOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutViolin(0, 0, 0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const featureCol = () => (data.columns.feature as string[]) ?? [];
  const groupCol = () => (data.columns.group as string[]) ?? [];
  const grid = () => (data.meta?.grid as ArrayLike<number>) ?? [];
  const grids = () => data.meta?.grids as ArrayLike<number> | undefined;
  const density = () => data.meta?.density as ArrayLike<number> | undefined;
  const medians = () => data.meta?.median as ArrayLike<number> | undefined;
  function features(): string[] {
    const given = data.meta?.features as string[] | undefined;
    return given && given.length ? given : uniq(featureCol());
  }
  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    return given && given.length ? given : uniq(groupCol());
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return groups().map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }
  /** Index of the violin for (feature, group), or -1. */
  function violinIndex(feature: string, group: string): number {
    const fc = featureCol();
    const gc = groupCol();
    for (let i = 0; i < fc.length; i += 1) {
      if (fc[i] === feature && gc[i] === group) return i;
    }
    return -1;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const f = features();
    const g = groups();
    const col = Math.floor((mx - layout.left) / layout.cellW);
    const row = Math.floor((my - layout.top) / layout.rowH);
    if (col < 0 || col >= g.length || row < 0 || row >= f.length) {
      tooltip.hide();
      return;
    }
    const i = violinIndex(f[row] as string, g[col] as string);
    if (i < 0) {
      tooltip.hide();
      return;
    }
    const med = medians();
    const medTxt = med && i < med.length
      ? `<br/>median ${(med[i] as number).toFixed(2)}`
      : "";
    tooltip.show(
      `<b>${esc(f[row] as string)}</b> in ${esc(g[col] as string)}${medTxt}`,
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
    const f = features();
    const g = groups();
    const gr = grid();
    const longest = f.reduce((m, s) => Math.max(m, s.length), 4);
    layout = layoutViolin(width, height, f.length, g.length, opts, longest);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    if (!f.length || !g.length || !gr.length) {
      renderOverlay();
      return;
    }

    const dens = density();
    const cols = groupColors();
    const med = medians();
    const grs = grids();
    const halfW = (layout.cellW * opts.violinWidth) / 2;

    for (let r = 0; r < f.length; r += 1) {
      // Collect the row first so every violin in it shares one density scale.
      const rows: number[][] = [];
      const idx: number[] = [];
      for (let c = 0; c < g.length; c += 1) {
        const i = violinIndex(f[r] as string, g[c] as string);
        idx.push(i);
        rows.push(i < 0 ? new Array(gr.length).fill(0) : densityRow(dens, i, gr.length));
      }
      const rowMax = maxDensity(rows);

      // Each row is framed on its own grid when one is supplied, so a highly
      // expressed feature cannot compress the rest into flat lines.
      const rowGrid = gridForRow(gr, grs, r);
      const gmin = rowGrid[0] as number;
      const gmax = rowGrid[rowGrid.length - 1] as number;
      const span = gmax - gmin || 1;
      const yTop = layout.top + r * layout.rowH + 2;
      const yBot = layout.top + (r + 1) * layout.rowH - 2;
      const toY = (v: number) => yBot - ((v - gmin) / span) * (yBot - yTop);

      for (let c = 0; c < g.length; c += 1) {
        const row = rows[c] as number[];
        const scale = opts.scalePerViolin ? maxDensity([row]) : rowMax;
        const poly = violinPolygon(rowGrid, row, scale);
        if (!poly.length) continue;
        const cx = layout.left + (c + 0.5) * layout.cellW;
        ctx.beginPath();
        for (let k = 0; k < poly.length; k += 1) {
          const p = poly[k] as { x: number; y: number };
          const px = cx + p.x * halfW;
          const py = toY(p.y);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = cols[c] ?? theme.foreground;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        const i = idx[c] as number;
        if (opts.showMedian && med && i >= 0 && i < med.length) {
          const my = toY(med[i] as number);
          ctx.strokeStyle = theme.background;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx - halfW * 0.35, my);
          ctx.lineTo(cx + halfW * 0.35, my);
          ctx.stroke();
        }
      }
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const f = features();
    const g = groups();

    // Row separators, so a tall stack does not read as one continuous field.
    for (let r = 1; r < f.length; r += 1) {
      const y = layout.top + r * layout.rowH;
      svg.appendChild(line(layout.left, y, layout.left + layout.plotW, y, theme.grid));
    }

    if (opts.showFeatureLabels) {
      const step = Math.max(1, Math.ceil(9 / layout.rowH));
      for (let r = 0; r < f.length; r += step) {
        svg.appendChild(
          text(layout.left - 7, layout.top + (r + 0.5) * layout.rowH + 3,
            f[r] ?? "", theme.foreground, "end", 9),
        );
      }
    }

    // Group labels, rotated: cluster names are long and would collide flat.
    for (let c = 0; c < g.length; c += 1) {
      const x = layout.left + (c + 0.5) * layout.cellW;
      const y = layout.top + layout.plotH + 8;
      const t = text(x, y, g[c] ?? "", theme.foreground, "end", 9);
      t.setAttribute("transform", `rotate(-45 ${x} ${y})`);
      svg.appendChild(t);
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

  const instance: PlotomicsInstance<ViolinOptions> = {
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
function uniq(col: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of col) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: ViolinOptions, next?: Partial<ViolinOptions>): ViolinOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
