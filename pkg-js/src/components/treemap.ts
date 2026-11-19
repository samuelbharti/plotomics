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
  textSizes,
  createTooltip,
  createPlotBox,
  type Tooltip,
  measure,
  releaseContainer,
  textWidth,
  dpr,
  serializeSVG,
  padSVG,
  compositePNG,
  categoricalScale,
  ramp,
  type RampName,
  categoricalColors,
} from "../core/index.js";
import { uniqueId } from "../core/dom.js";
import { plainColour } from "../core/paint.js";
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
  /** Minimum tile side (px) required before a label is drawn, at the
   * default text size. It grows in step with `theme.fontSize`. */
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
/** The border around a group. */
const GROUP_PAD = 2;

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
 * numbers so a stray NaN can never poison the layout's `sum`. With no `value`
 * column, every leaf weighs 1, so the tiles show leaf counts.
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
    const p = rawParent == null || rawParent === "NA" ? "" : String(rawParent);
    const raw = value ? value[i] : 1;
    const v = raw == null ? 0 : Number(raw);
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
 * Stratify rows into a hierarchy and compute node values. A node's value is
 * the sum of its leaves; the value given on an internal node is ignored, so
 * the leaves always fill their parent. Throws on the usual stratify errors
 * (no/multiple roots, missing parent, cycle) which is preferable to silently
 * mislaying data.
 */
export function buildHierarchy(rows: TreeRow[]): HierarchyNode<TreeRow> {
  const internal = new Set<string>();
  for (const r of rows) if (r.parent !== "") internal.add(r.parent);
  const root = stratify<TreeRow>()
    .id((d) => d.id)
    .parentId((d) => (d.parent === "" ? undefined : d.parent))(rows);
  // d3's sum() adds each node's own value to its children's, so internal
  // nodes contribute 0.
  root
    .sum((d) => (internal.has(d.id) ? 0 : d.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return root;
}

/**
 * The top-level group of every node: the id of its ancestor just below the
 * root (a top-level node maps to itself). Computed once on the full tree, so
 * colors and group names stay the same after drilling in.
 */
export function topLevelIds(root: HierarchyNode<TreeRow>): Map<string, string> {
  const out = new Map<string, string>();
  for (const top of root.children ?? []) {
    top.each((n) => out.set(n.data.id, top.data.id));
  }
  out.set(root.data.id, root.data.id);
  return out;
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

export const createTreemap: PlotomicsFactory<TreemapOptions> = (
  el,
  initial,
) => {
  let opts: TreemapOptions = mergeOptions(
    defaultTreemapOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;

  // Full hierarchy (root) + the node we are currently zoomed into.
  let root: HierarchyNode<TreeRow> | null = null;
  let focus: HierarchyNode<TreeRow> | null = null;
  // Laid-out leaves of the current focus, in draw order.
  let layoutLeaves: HierarchyRectangularNode<TreeRow>[] = [];
  // Laid-out groups of the current focus: its children that have children.
  let layoutGroups: HierarchyRectangularNode<TreeRow>[] = [];
  // Top-level group of every node, from the full tree, so colors keep their
  // meaning after drilling in.
  let topOf = new Map<string, string>();
  let paletteFor = categoricalScale(theme.categorical);
  const uid = uniqueId("plotomics-treemap");
  // Groups given a header strip in the last layout. The decision is made on
  // the unrounded rect, so it is recorded then and read when labelling.
  let headerIds = new Set<string>();

  /** Assign palette colors to the top-level groups in tree order. */
  function assignPalette() {
    const tops = root?.children ?? [];
    // A tree that is a lone root still colours that root.
    paletteFor = categoricalScale(
      categoricalColors(theme.categorical, Math.max(1, tops.length)),
    );
    for (const top of tops) paletteFor(top.data.id);
  }

  /** Breadcrumb strip reserved at the top of the container: 24 px at the
   * default text size. */
  const breadcrumbH = () => Math.round(sizes.axisTitle + 11);
  /** Header strip for a group's name: 16 px at the default text size. */
  const headerH = () => Math.round(sizes.label + 5);

  /** Whether a group tile has room for its name in a header strip. */
  const hasHeader = (d: HierarchyRectangularNode<TreeRow>) =>
    d.depth === 1 &&
    !!d.children &&
    d.y1 - d.y0 >= 3 * headerH() &&
    d.x1 - d.x0 >= 4 * sizes.label + 4;

  // DOM: canvas for the tiles, SVG overlay for labels + breadcrumb.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;cursor:pointer;";
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

  // SVG text in the current theme font.
  const text = (
    x: number,
    y: number,
    content: string,
    fill: string,
    anchor: string,
    size = sizes.label,
  ) => svgText(x, y, content, fill, anchor, size, theme.fontFamily);

  const plotTop = () => breadcrumbH();
  const plotW = () => Math.max(1, width);
  const plotH = () => Math.max(1, height - breadcrumbH());

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
      layoutGroups = [];
      render();
      return;
    }
    try {
      root = buildHierarchy(rows);
    } catch {
      // Malformed hierarchy (no root, cycle, ...): render nothing, so no
      // error crosses the host boundary.
      root = null;
      focus = null;
      layoutLeaves = [];
      layoutGroups = [];
      render();
      return;
    }
    topOf = topLevelIds(root);
    assignPalette();
    // Preserve the current focus id across data/option updates when possible.
    const prevId = focus?.data.id;
    focus = (prevId && findNode(root, prevId)) || root;
    computeLayout();
    render();
  }

  function computeLayout() {
    if (!focus) {
      layoutLeaves = [];
      layoutGroups = [];
      return;
    }
    const tileFn = opts.tile === "binary" ? treemapBinary : treemapSquarify;
    const inner = Math.max(0, opts.paddingInner);
    // Lay out a *copy* of the focus subtree so drilling in re-fits the tiles to
    // the full plot area without mutating the shared root layout. Groups (the
    // focus's children that have children) get a wider border than the tiles
    // inside them, and a header strip for their name when there is room.
    const sub = focus.copy();
    const headers = new Set<string>();
    treemap<TreeRow>()
      .tile(tileFn)
      .size([plotW(), plotH()])
      .paddingInner(inner)
      .paddingOuter((d) => (d.depth === 1 && d.children ? GROUP_PAD : 0))
      .paddingTop((d) => {
        if (!(d.depth === 1 && d.children)) return 0;
        if (!hasHeader(d as HierarchyRectangularNode<TreeRow>))
          return GROUP_PAD;
        headers.add(d.data.id);
        return headerH();
      })
      .round(true)(sub);
    headerIds = headers;
    const laid = sub as HierarchyRectangularNode<TreeRow>;
    layoutLeaves = laid.leaves();
    layoutGroups = (laid.children ?? []).filter((c) => !!c.children);
  }

  function groupColor(id: string): string {
    return paletteFor(topOf.get(id) ?? id);
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
    return groupColor(leaf.data.id);
  }

  /** The group in view that holds a leaf: the focus child above it. */
  function viewGroupOf(
    leaf: HierarchyRectangularNode<TreeRow>,
  ): HierarchyRectangularNode<TreeRow> | null {
    const chain = leaf.ancestors(); // [leaf, ..., sub root]
    return chain.length > 2
      ? (chain[chain.length - 2] as HierarchyRectangularNode<TreeRow>)
      : null;
  }

  // ---- canvas rendering (the data layer) ----
  function drawTiles() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = dpr();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, plotW(), plotH());
    // var() and currentColor read inside the element, as a canvas cannot.
    const background = plainColour(theme.background, el);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, plotW(), plotH());
    }
    if (layoutLeaves.length === 0) return;

    // Group tiles first: their header strip and border show the group color.
    if (opts.colorBy === "parent") {
      for (const g of layoutGroups) {
        ctx.fillStyle = groupColor(g.data.id);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
        ctx.globalAlpha = 1;
      }
    } else {
      for (const g of layoutGroups) {
        ctx.fillStyle = theme.axis;
        ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
      }
    }

    const ext = valueExtent(layoutLeaves);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = background ?? "rgba(0, 0, 0, 0)";
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
    svg.appendChild(rect(0, 0, width, breadcrumbH(), theme.background));
    const crumbsEnd = renderCrumbs();
    if (opts.colorBy === "value" && layoutLeaves.length) {
      renderValueKey(crumbsEnd);
    }
  }

  /** Draw the breadcrumb; returns the x where it ends. */
  function renderCrumbs(): number {
    if (!focus) return 0;
    const chain = focus.ancestors().reverse(); // root -> focus
    const size = sizes.axisTitle;
    // Baseline that centres the crumbs in the strip.
    const y = Math.round(breadcrumbH() / 2 + size * 0.35);
    const crumbs = fitCrumbs(chain, size);
    let x = 8;
    crumbs.forEach((crumb, i) => {
      if (i > 0) {
        svg.appendChild(text(x, y, "›", theme.muted, "start", size));
        x += size;
      }
      const isLast = i === crumbs.length - 1;
      const t = text(
        x,
        y,
        crumb.label,
        isLast ? theme.foreground : theme.axis,
        "start",
        size,
      );
      // Crumbs are interactive; the overlay is otherwise pointer-transparent.
      t.style.pointerEvents = "auto";
      t.style.cursor = "pointer";
      if (isLast) t.setAttribute("font-weight", "600");
      t.addEventListener("click", () => zoomTo(crumb.node));
      svg.appendChild(t);
      x += crumbWidth(crumb.label, size, isLast) + 6;
    });
    return x;
  }

  /** Width of a crumb. The last crumb is bold, which sets about 10% wider
   * than the regular weight that is measured. */
  function crumbWidth(label: string, size: number, bold: boolean): number {
    return textWidth(label, size, theme.fontFamily) * (bold ? 1.1 : 1);
  }

  /**
   * The crumbs that fit the strip, from the root to the focus. When the
   * whole path is too wide, the ancestors after the root are hidden, oldest
   * first, behind one "…" crumb that opens the nearest hidden one. When
   * that is still too wide, the focus crumb is cut with an ellipsis, and so
   * is the root when it takes more than half the strip.
   */
  function fitCrumbs(
    chain: HierarchyNode<TreeRow>[],
    size: number,
  ): { label: string; node: HierarchyNode<TreeRow> }[] {
    const avail = width - 16;
    // Width from the first crumb's start to the last crumb's end.
    const span = (list: { label: string }[], boldLast: boolean) =>
      list.reduce(
        (sum, c, i) =>
          sum +
          (i > 0 ? size + 6 : 0) +
          crumbWidth(c.label, size, boldLast && i === list.length - 1),
        0,
      );
    const all = chain.map((node) => ({
      label: node.data.label || node.data.id,
      node,
    }));
    let crumbs = all;
    for (
      let hide = 1;
      span(crumbs, true) > avail && hide < all.length - 1;
      hide += 1
    ) {
      const nearest = all[hide] as (typeof all)[number];
      crumbs = [
        all[0] as (typeof all)[number],
        { label: "…", node: nearest.node },
        ...all.slice(hide + 1),
      ];
    }
    if (span(crumbs, true) <= avail) return crumbs;
    const head = crumbs.slice(0, -1).map((c) => ({ ...c }));
    const last = { ...(crumbs[crumbs.length - 1] as (typeof all)[number]) };
    const first = head[0];
    // The space before the focus crumb, with its separator.
    const before = () => (head.length ? span(head, false) + 6 + size : 0);
    if (first && before() > avail / 2) {
      const cut = before() - avail / 2;
      first.label = fitLabel(
        first.label,
        Math.max(0, crumbWidth(first.label, size, false) - cut),
        size,
        1,
      );
    }
    last.label = fitLabel(last.label, Math.max(0, avail - before()), size, 1.1);
    return [...head, last];
  }

  /**
   * Value color key at the right of the breadcrumb strip: min, ramp, max.
   * Left out when the breadcrumb reaches it.
   */
  function renderValueKey(crumbsEnd: number) {
    // The labels state values that tiles have: valueExtent widens an all-
    // equal range for the color scale, which the key must not print.
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of layoutLeaves) {
      const v = l.value ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const fs = sizes.label;
    const loText = fmt(lo);
    const hiText = hi > lo ? fmt(hi) : "";
    const hiW = textWidth(hiText, fs, theme.fontFamily);
    const loW = textWidth(loText, fs, theme.fontFamily);
    const barW = 90;
    const x = Math.floor(width - 8 - hiW - 4 - barW);
    // Left out when the min label would meet the breadcrumb.
    if (x - 4 - loW - 8 < crumbsEnd) return;
    // The bar and its labels sit on the middle of the strip.
    const midY = breadcrumbH() / 2;
    const baseline = Math.round(midY + fs * 0.35);
    const gid = `${uid}-key`;
    const defs = document.createElementNS(SVG_NS, "defs");
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", gid);
    const fn = ramp(opts.colormap);
    for (let i = 0; i <= 8; i += 1) {
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", `${(i / 8) * 100}%`);
      stop.setAttribute("stop-color", fn(i / 8));
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.appendChild(rect(x, Math.round(midY - 4), barW, 8, `url(#${gid})`));
    svg.appendChild(text(x - 4, baseline, loText, theme.axis, "end", fs));
    // One value only: every tile has it, and it takes the low end of the ramp.
    if (hiText) {
      svg.appendChild(
        text(x + barW + 4, baseline, hiText, theme.axis, "start", fs),
      );
    }
  }

  /** White text with a dark halo, cut to `maxWidth` px with an ellipsis. */
  function haloText(
    x: number,
    y: number,
    label: string,
    maxWidth: number,
    size: number,
    weight?: string,
  ) {
    const t = text(x, y, "", "#ffffff", "start", size);
    // Halo for legibility over any tile color.
    t.setAttribute("paint-order", "stroke");
    t.setAttribute("stroke", "rgba(0,0,0,0.55)");
    t.setAttribute("stroke-width", "2");
    if (weight) t.setAttribute("font-weight", weight);
    // Bold text sets about 10% wider than the regular weight that is measured.
    t.textContent = fitLabel(label, maxWidth, size, weight ? 1.1 : 1);
    svg.appendChild(t);
  }

  /**
   * `label` as it fits in `maxWidth` px at `size`: whole, or cut with an
   * ellipsis. `widen` scales the measured width.
   */
  function fitLabel(
    label: string,
    maxWidth: number,
    size: number,
    widen: number,
  ): string {
    const fits = (s: string) =>
      textWidth(s, size, theme.fontFamily) * widen <= maxWidth;
    if (fits(label)) return label;
    // The most characters that still fit with the ellipsis after them.
    let lo = 0;
    let hi = label.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(`${label.slice(0, mid)}…`)) lo = mid;
      else hi = mid - 1;
    }
    return `${label.slice(0, lo)}…`;
  }

  function renderLabels() {
    const yOff = plotTop();
    // Group names in their header strips.
    for (const g of layoutGroups) {
      if (!headerIds.has(g.data.id)) continue;
      const label = g.data.label || g.data.id;
      haloText(
        g.x0 + 4,
        yOff + g.y0 + headerH() - 4,
        label,
        g.x1 - g.x0 - 8,
        sizes.label,
        "600",
      );
    }
    // labelMinSize is set for the default 11 px labels and scales with them.
    const minSide = (opts.labelMinSize * sizes.label) / 11;
    for (const leaf of layoutLeaves) {
      if (!tileFitsLabel(leaf, minSide)) continue;
      const label = leaf.data.label || leaf.data.id;
      haloText(
        leaf.x0 + 4,
        yOff + leaf.y0 + Math.round(sizes.label + 3),
        label,
        leaf.x1 - leaf.x0 - 8,
        sizes.label,
      );
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
      const group = viewGroupOf(leaf);
      const groupLine = group
        ? `<br/>group: ${escapeHTML(group.data.label || group.data.id)}`
        : "";
      tooltip.show(
        `<b>${escapeHTML(label)}</b>${groupLine}<br/>value: ${fmt(leaf.value ?? 0)}`,
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
    fitBox(w, h);
    computeLayout();
    render();
  }

  // Initial sizing from the container (or sensible defaults when detached).
  {
    const m = measure(el);
    fitBox(m.width, m.height);
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
      sizes = textSizes(theme);
      assignPalette();
      fitBox();
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
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
    },
    async exportPNG(scale = 2) {
      // The tiles below the breadcrumb, with the labels over them.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        element: el,
        layers: [
          { canvas, x: 0, y: plotTop(), width: plotW(), height: plotH() },
        ],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      tooltip.destroy();
      plot.remove();
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

function svgText(
  x: number,
  y: number,
  content: string,
  fill: string,
  anchor: string,
  size: number,
  fontFamily: string,
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("fill", fill);
  t.setAttribute("text-anchor", anchor);
  t.setAttribute("font-family", fontFamily);
  t.setAttribute("font-size", String(size));
  t.textContent = content;
  return t;
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
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
