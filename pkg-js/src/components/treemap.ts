/**
 * Gene / pathway treemap — hierarchical composition of gene sets and pathways.
 *
 * A flat edge list ({ id, parent, value }) is turned into a hierarchy with
 * d3.stratify and laid out with d3.treemap. Tiles are rasterized onto a canvas
 * so thousands of leaves stay smooth (never one DOM node per tile); an SVG
 * overlay carries only the low-cardinality vector layer — labels for tiles
 * above a minimum side, plus a breadcrumb — and a tooltip tracks the pointer.
 * Click a tile to drill into that node; click the breadcrumb to zoom back out.
 *
 * Mirrors the Volcano reference: exported pure helpers (unit-tested without a
 * GPU/DOM) plus a factory returning a PlotomicsInstance.
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
  categoricalScale,
  ramp,
  type RampName,
} from "../core/index.js";
import {
  stratify,
  treemap,
  treemapSquarify,
  treemapBinary,
  type HierarchyNode,
  type HierarchyRectangularNode,
} from "d3-hierarchy";

export interface TreemapOptions {
  /** Tiling algorithm: squarified (golden-ratio rects) or balanced binary. */
  tile: "squarify" | "binary";
  /** Padding between sibling tiles, in CSS pixels. */
  paddingInner: number;
  /** Color leaves by their top-level ancestor (categorical) or by value (ramp). */
  colorBy: "parent" | "value";
  /** Sequential/diverging ramp used when `colorBy` is "value". */
  colormap: RampName;
  /** Minimum tile side (px) required before a label is drawn. */
  labelMinSize: number;
  theme: Partial<PlotomicsTheme>;
}

export const defaultTreemapOptions: TreemapOptions = {
  tile: "squarify",
  paddingInner: 1,
  colorBy: "parent",
  colormap: "viridis",
  labelMinSize: 32,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Breadcrumb strip reserved at the top of the container. */
const BREADCRUMB_H = 24;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/treemap.test.ts)
// ---------------------------------------------------------------------------

/** One row of the flat edge list backing the hierarchy. */
export interface TreeRow {
  id: string;
  parent: string;
  value: number;
  label: string;
}

/**
 * Zip the id/parent/value columns (+ optional meta.labels) into rows. Blank,
 * `"NA"` or missing parents mark the root. Values are coerced to non-negative
 * numbers so a stray NaN can never poison the layout's `sum`.
 */
export function buildRows(data: PlotomicsData): TreeRow[] {
  const cols = data.columns;
  const id = cols.id as string[] | undefined;
  const parent = cols.parent as string[] | undefined;
  const value = cols.value as ArrayLike<number> | undefined;
  if (!id || !parent) return [];
  const labels = (data.meta?.labels as string[] | undefined) ?? undefined;
  const n = id.length;
  const rows: TreeRow[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const rawParent = parent[i];
    const p =
      rawParent == null || rawParent === "NA" ? "" : String(rawParent);
    const v = value ? Number(value[i]) : 0;
    rows[i] = {
      id: String(id[i]),
      parent: p,
      value: Number.isFinite(v) && v > 0 ? v : 0,
      label: labels?.[i] != null ? String(labels[i]) : String(id[i]),
    };
  }
  return rows;
}

/**
 * Stratify rows into a hierarchy and compute node values. Internal-node values
 * are the sum of their leaves (d3.sum), so a treemap over `value` respects the
 * supplied leaf weights. Throws on the usual stratify errors (no/multiple
 * roots, missing parent, cycle) which is preferable to silently mislaying data.
 */
export function buildHierarchy(rows: TreeRow[]): HierarchyNode<TreeRow> {
  const root = stratify<TreeRow>()
    .id((d) => d.id)
    .parentId((d) => (d.parent === "" ? undefined : d.parent))(rows);
  root
    .sum((d) => d.value)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return root;
}

/**
 * The key used to color a leaf: the id of its top-level ancestor (the child of
 * the root), so every gene under the same pathway shares a hue. Falls back to
 * the node's own id when it *is* a top-level node.
 */
export function topAncestorId(node: HierarchyNode<TreeRow>): string {
  const chain = node.ancestors(); // [node, ..., root]
  if (chain.length <= 1) return node.data.id; // node is the root
  // ancestors()[len-1] is root; the entry before it is the top-level ancestor.
  return chain[chain.length - 2]!.data.id;
}

/** Whether a rectangle is at least `min` px on both sides (label eligibility). */
export function tileFitsLabel(
  node: HierarchyRectangularNode<TreeRow>,
  min: number,
): boolean {
  return node.x1 - node.x0 >= min && node.y1 - node.y0 >= min;
}

/** min/max of the summed values across the leaves of a node (for the ramp). */
export function valueExtent(
  leaves: HierarchyRectangularNode<TreeRow>[],
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const l of leaves) {
    const v = l.value ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createTreemap: PlotomicsFactory<TreemapOptions> = (el, initial) => {
  let opts: TreemapOptions = mergeOptions(defaultTreemapOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;

  // Full hierarchy (root) + the node we are currently zoomed into.
  let root: HierarchyNode<TreeRow> | null = null;
  let focus: HierarchyNode<TreeRow> | null = null;
  // Laid-out leaves of the current focus, in draw order.
  let layoutLeaves: HierarchyRectangularNode<TreeRow>[] = [];
  // Stable categorical color assignment across re-layouts/zoom.
  let paletteFor = categoricalScale(theme.categorical);

  // DOM: canvas for the tiles, SVG overlay for labels + breadcrumb.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;cursor:pointer;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  const plotTop = () => BREADCRUMB_H;
  const plotW = () => Math.max(1, width);
  const plotH = () => Math.max(1, height - BREADCRUMB_H);

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = "0px";
    canvas.style.top = `${plotTop()}px`;
    canvas.style.width = `${plotW()}px`;
    canvas.style.height = `${plotH()}px`;
    canvas.width = Math.round(plotW() * ratio);
    canvas.height = Math.round(plotH() * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  function rebuild() {
    const rows = buildRows(data);
    if (rows.length === 0) {
      root = null;
      focus = null;
      layoutLeaves = [];
      render();
      return;
    }
    try {
      root = buildHierarchy(rows);
    } catch {
      // Malformed hierarchy (no root, cycle, ...): render nothing rather than
      // throwing across the host boundary.
      root = null;
      focus = null;
      layoutLeaves = [];
      render();
      return;
    }
    // Preserve the current focus id across data/option updates when possible.
    const prevId = focus?.data.id;
    focus = (prevId && findNode(root, prevId)) || root;
    computeLayout();
    render();
  }

  function computeLayout() {
    if (!focus) {
      layoutLeaves = [];
      return;
    }
    paletteFor = categoricalScale(theme.categorical);
    const tileFn = opts.tile === "binary" ? treemapBinary : treemapSquarify;
    // Lay out a *copy* of the focus subtree so drilling in re-fits the tiles to
    // the full plot area without mutating the shared root layout.
    const sub = focus.copy();
    treemap<TreeRow>()
      .tile(tileFn)
      .size([plotW(), plotH()])
      .paddingInner(Math.max(0, opts.paddingInner))
      .round(true)(sub);
    layoutLeaves = sub.leaves() as HierarchyRectangularNode<TreeRow>[];
  }

  function fillFor(
    leaf: HierarchyRectangularNode<TreeRow>,
    ext: [number, number],
  ): string {
    if (opts.colorBy === "value") {
      const v = leaf.value ?? 0;
      const t = ext[1] > ext[0] ? (v - ext[0]) / (ext[1] - ext[0]) : 0.5;
      return ramp(opts.colormap)(t);
    }
    return paletteFor(topAncestorId(leaf));
  }

  // ---- canvas rendering (the data layer) ----
  function drawTiles() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = dpr();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, plotW(), plotH());
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, plotW(), plotH());
    if (layoutLeaves.length === 0) return;

    const ext = valueExtent(layoutLeaves);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = theme.background;
    for (const leaf of layoutLeaves) {
      const x = leaf.x0;
      const y = leaf.y0;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      if (w <= 0 || h <= 0) continue;
      ctx.fillStyle = fillFor(leaf, ext);
      ctx.fillRect(x, y, w, h);
      if (w > 2 && h > 2) ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
    }
  }

  // ---- SVG overlay (labels + breadcrumb) ----
  function render() {
    layoutCanvas();
    drawTiles();
    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    renderBreadcrumb();
    renderLabels();
  }

  function renderBreadcrumb() {
    // Background strip so tile labels never bleed into the breadcrumb.
    svg.appendChild(rect(0, 0, width, BREADCRUMB_H, theme.background));
    if (!focus) return;
    const chain = focus.ancestors().reverse(); // root -> focus
    let x = 8;
    chain.forEach((node, i) => {
      if (i > 0) {
        svg.appendChild(text(x, BREADCRUMB_H - 8, "›", theme.muted, "start", 12));
        x += 12;
      }
      const label = node.data.label || node.data.id;
      const isLast = i === chain.length - 1;
      const t = text(
        x,
        BREADCRUMB_H - 8,
        label,
        isLast ? theme.foreground : theme.axis,
        "start",
        12,
      );
      // Crumbs are interactive; the overlay is otherwise pointer-transparent.
      t.style.pointerEvents = "auto";
      t.style.cursor = "pointer";
      if (isLast) t.setAttribute("font-weight", "600");
      t.addEventListener("click", () => zoomTo(node));
      svg.appendChild(t);
      x += approxTextWidth(label, 12) + 6;
    });
  }

  function renderLabels() {
    const yOff = plotTop();
    for (const leaf of layoutLeaves) {
      if (!tileFitsLabel(leaf, opts.labelMinSize)) continue;
      const label = leaf.data.label || leaf.data.id;
      const tx = leaf.x0 + 4;
      const ty = yOff + leaf.y0 + 14;
      const t = text(tx, ty, "", "#ffffff", "start", 11);
      // Halo for legibility over any tile color.
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", "rgba(0,0,0,0.55)");
      t.setAttribute("stroke-width", "2");
      // Truncate to the tile width with an ellipsis.
      const maxChars = Math.max(1, Math.floor((leaf.x1 - leaf.x0 - 8) / 6.2));
      t.textContent =
        label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
      svg.appendChild(t);
    }
  }

  // ---- interaction ----
  function leafAt(
    px: number,
    py: number,
  ): HierarchyRectangularNode<TreeRow> | null {
    // px/py are relative to the plot area (canvas), not the container.
    for (const leaf of layoutLeaves) {
      if (px >= leaf.x0 && px <= leaf.x1 && py >= leaf.y0 && py <= leaf.y1) {
        return leaf;
      }
    }
    return null;
  }

  function localPoint(e: MouseEvent): { px: number; py: number } {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  const onMove = (e: MouseEvent) => {
    const { px, py } = localPoint(e);
    const leaf = leafAt(px, py);
    if (leaf) {
      const label = leaf.data.label || leaf.data.id;
      tooltip.show(
        `<b>${escapeHTML(label)}</b><br/>value: ${fmt(leaf.value ?? 0)}`,
        e.clientX,
        e.clientY,
      );
    } else {
      tooltip.hide();
    }
  };
  const onLeave = () => tooltip.hide();
  const onClick = (e: MouseEvent) => {
    const { px, py } = localPoint(e);
    const leaf = leafAt(px, py);
    if (!leaf) return;
    // Map the clicked leaf back to a node in the live focus tree, then drill
    // into its first internal ancestor (a leaf has nothing to drill into).
    const target = focus && findNode(focus, leaf.data.id);
    if (!target) return;
    const drill =
      target.children && target.children.length ? target : target.parent;
    if (drill && drill !== focus) zoomTo(drill);
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  canvas.addEventListener("click", onClick);

  function zoomTo(node: HierarchyNode<TreeRow>) {
    focus = node;
    computeLayout();
    render();
  }

  function doResize(w: number, h: number) {
    width = w;
    height = h;
    computeLayout();
    render();
  }

  // Initial sizing from the container (or sensible defaults when detached).
  {
    const m = measure(el);
    width = m.width;
    height = m.height;
    rebuild();
  }

  const instance: PlotomicsInstance<TreemapOptions> = {
    setData(next) {
      data = next;
      focus = null; // reset zoom on a fresh dataset
      rebuild();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      // Keep the current focus; only re-layout + recolor.
      computeLayout();
      render();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Hybrid figure: rasterized tile layer + vector labels/breadcrumb.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", String(plotTop()));
      img.setAttribute("width", String(plotW()));
      img.setAttribute("height", String(plotH()));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      tooltip.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
function findNode(
  root: HierarchyNode<TreeRow>,
  id: string,
): HierarchyNode<TreeRow> | null {
  let found: HierarchyNode<TreeRow> | null = null;
  root.each((n) => {
    if (found === null && n.data.id === id) found = n;
  });
  return found;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): SVGRectElement {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  return r;
}

let _sharedFontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
function text(
  x: number,
  y: number,
  content: string,
  fill: string,
  anchor: string,
  size = 11,
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("fill", fill);
  t.setAttribute("text-anchor", anchor);
  t.setAttribute("font-family", _sharedFontFamily);
  t.setAttribute("font-size", String(size));
  t.textContent = content;
  return t;
}

function approxTextWidth(s: string, size: number): number {
  return s.length * size * 0.55;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function mergeOptions(
  base: TreemapOptions,
  next?: Partial<TreemapOptions>,
): TreemapOptions {
  if (!next) return { ...base };
  const merged: TreemapOptions = {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
  _sharedFontFamily = resolveTheme(merged.theme).fontFamily;
  return merged;
}
