/**
 * Pure, GPU-free helpers for the network component: data-contract parsing,
 * graph construction, group→color mapping and the ForceAtlas2 layout call.
 *
 * These are split out from `network.ts` so they can be unit-tested in a plain
 * Node environment — importing `sigma` (WebGL) at module load fails outside a
 * browser, so the factory keeps that import to itself.
 */
import type { PlotomicsData } from "../core/index.js";
import { categoricalScale } from "../core/index.js";
import Graph from "graphology";
// The exported signatures name the graph type `graphology.default`. A
// project that resolves modules the node16 way loads the graphology types as
// CommonJS, and there a default import names the whole module, not the class
// (TS2709 "Cannot use namespace 'Graph' as a type").
import type * as graphology from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/** `"forceatlas2"` runs a layout when x/y are missing; `"precomputed"` requires
 * x/y in the data and never runs a layout. */
export type NetworkLayout = "forceatlas2" | "precomputed";

/** Normalized edge endpoints extracted from either the columnar form
 * (`source`/`target` string columns, optional numeric `weight`) or the
 * `meta.edges` pair form. Missing endpoints are dropped by {@link buildGraph}. */
export interface EdgeSpec {
  source: string;
  target: string;
  weight?: number;
  color?: string;
}

/** Counts of edges that {@link buildGraph} left out of the graph, so a caller
 * can report them rather than silently showing an incomplete picture. */
export interface EdgeDrops {
  /** An endpoint id that is not in the node table. */
  missingEndpoint: number;
  /** A self-loop (source === target); the WebGL renderer does not draw these. */
  selfLoop: number;
  /** A parallel edge in the simple graph (the pair was already connected). */
  duplicate: number;
  /** Nodes whose given x or y was missing (null or NaN). They are placed at
   * the centre of the other nodes, so the renderer does not reject them. */
  missingCoords?: number;
}

/**
 * Edge width range in px for weighted edges (|weight| is mapped onto it).
 * Sigma draws no edge thinner than its `minEdgeThickness` of 1.7 px, so the
 * range starts there; a lower start would draw the weakest edges alike.
 */
export const EDGE_WIDTH: readonly [number, number] = [1.7, 6];

/**
 * Map each |weight| linearly onto `range`, over the smallest and largest
 * |weight| of the graph. Missing weights (NaN) get the low end; when every
 * weight is the same, every edge gets the middle.
 */
export function edgeWidths(
  weights: readonly number[],
  range: readonly [number, number] = EDGE_WIDTH,
): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const w of weights) {
    const a = Math.abs(w);
    if (!Number.isFinite(a)) continue;
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  const [r0, r1] = range;
  return weights.map((w) => {
    const a = Math.abs(w);
    if (!Number.isFinite(a)) return r0;
    if (hi <= lo) return (r0 + r1) / 2;
    return r0 + ((a - lo) / (hi - lo)) * (r1 - r0);
  });
}

/** Read edges from a {@link PlotomicsData} in whichever form was supplied. */
export function extractEdges(data: PlotomicsData): EdgeSpec[] {
  const cols = data.columns;
  const src = cols.source as string[] | undefined;
  const tgt = cols.target as string[] | undefined;
  if (src && tgt) {
    const w = cols.weight as ArrayLike<number> | undefined;
    const c = cols.color as string[] | undefined;
    const n = Math.min(src.length, tgt.length);
    const out: EdgeSpec[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = {
        source: String(src[i]),
        target: String(tgt[i]),
        // null (R's JSON for NA) is a missing weight, not 0.
        ...(w ? { weight: w[i] == null ? Number.NaN : Number(w[i]) } : {}),
        ...(c ? { color: String(c[i]) } : {}),
      };
    }
    return out;
  }
  const pairs = data.meta?.edges as unknown;
  if (Array.isArray(pairs)) {
    return (pairs as [unknown, unknown][])
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => ({ source: String(p[0]), target: String(p[1]) }));
  }
  return [];
}

/** Build a color-resolver for node groups from a palette. Nodes with no group
 * fall back to `defaultColor`. Colors are stable per group key. */
export function groupColorResolver(
  palette: string[],
  defaultColor: string,
): (group: string | undefined) => string {
  const scale = categoricalScale(palette);
  return (group) =>
    group == null || group === "" ? defaultColor : scale(group);
}

/** A legend entry: a node group and the colour its nodes take. */
export interface GroupLegendEntry {
  label: string;
  color: string;
  /** The entry for nodes with no group. */
  missing?: boolean;
}

/**
 * The node groups of a built graph, in the order they took their colours,
 * each with the colour of its nodes. When some nodes have a group and some
 * do not, an "NA" entry in `defaultColor` comes last. Empty when no node has
 * a group.
 */
export function groupLegend(
  graph: graphology.default,
  defaultColor: string,
): GroupLegendEntry[] {
  const seen = new Map<string, string>();
  let ungrouped = false;
  graph.forEachNode((_, attrs) => {
    const group = attrs.group as string | undefined;
    if (group === undefined || group === "") {
      ungrouped = true;
      return;
    }
    if (!seen.has(group)) seen.set(group, attrs.color as string);
  });
  if (seen.size === 0) return [];
  const out: GroupLegendEntry[] = [...seen].map(([label, color]) => ({
    label,
    color,
  }));
  if (ungrouped) out.push({ label: "NA", color: defaultColor, missing: true });
  return out;
}

/** Whether ForceAtlas2 should run: only in `"forceatlas2"` mode and only when
 * both x and y coordinate columns are absent (partial coords are ignored). */
export function needsLayout(
  data: PlotomicsData,
  layout: NetworkLayout,
): boolean {
  if (layout === "precomputed") return false;
  const { x, y } = data.columns;
  return !(x && y && x.length > 0);
}

/**
 * Construct a graphology graph from a dataset. Numeric attributes (x, y, size,
 * weight) come from numeric columns; labels/groups/color from meta. Edges whose
 * endpoints are unknown nodes are skipped rather than throwing, since real
 * interaction tables often reference filtered-out nodes.
 *
 * `colorFor` maps a group key to a hex color. When `x`/`y` are present they are
 * assigned; otherwise nodes are seeded on a ring for a caller-run layout.
 *
 * Returns the graph plus an {@link EdgeDrops} tally of the edges that were left
 * out (unknown endpoint, self-loop, or a parallel edge in the simple graph).
 * When `directed` is true the graph is built directed, so `A -> B` and `B -> A`
 * are kept as distinct edges and drawn with arrowheads by the renderer.
 */
export function buildGraph(
  data: PlotomicsData,
  opts: {
    defaultNodeColor: string;
    defaultEdgeColor: string;
    defaultNodeSize: number;
    colorFor: (group: string | undefined) => string;
    directed?: boolean;
  },
): { graph: graphology.default; dropped: EdgeDrops } {
  const graph = new Graph({
    multi: false,
    type: opts.directed ? "directed" : "undirected",
  });
  const cols = data.columns;
  const ids = (cols.id as string[] | undefined) ?? [];
  const meta = data.meta ?? {};
  const labels = meta.nodeLabels as string[] | undefined;
  const groups = meta.nodeGroup as string[] | undefined;
  const x = cols.x as ArrayLike<number> | undefined;
  const y = cols.y as ArrayLike<number> | undefined;
  const size = cols.size as ArrayLike<number> | undefined;
  const hasCoords = !!(x && y);

  // A missing value is null (R's JSON for NA) or NaN; it must not become 0.
  const num = (col: ArrayLike<number>, i: number) => {
    const v = col[i] as number | null | undefined;
    return v == null ? Number.NaN : Number(v);
  };
  const missingText = (v: unknown) =>
    v == null || (typeof v === "number" && Number.isNaN(v));

  const n = ids.length;
  const noCoords: string[] = [];
  let sumX = 0;
  let sumY = 0;
  let placed = 0;
  for (let i = 0; i < n; i += 1) {
    const id = String(ids[i]);
    if (graph.hasNode(id)) continue;
    // A node with no group takes the default color, not a "null" category.
    const rawGroup = groups?.[i];
    const group = missingText(rawGroup) ? undefined : String(rawGroup);
    const rawLabel = labels?.[i];
    let nx = 0;
    let ny = 0;
    if (hasCoords) {
      nx = num(x as ArrayLike<number>, i);
      ny = num(y as ArrayLike<number>, i);
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        sumX += nx;
        sumY += ny;
        placed += 1;
      } else {
        noCoords.push(id);
      }
    }
    const nodeSize = size ? num(size, i) : Number.NaN;
    graph.addNode(id, {
      x: nx,
      y: ny,
      size: Number.isFinite(nodeSize) ? nodeSize : opts.defaultNodeSize,
      label: missingText(rawLabel) ? id : String(rawLabel),
      color: opts.colorFor(group),
      ...(group !== undefined ? { group } : {}),
    });
  }
  // The renderer rejects a node without numeric coordinates, so put those
  // at the centre of the placed nodes.
  for (const id of noCoords) {
    graph.setNodeAttribute(id, "x", placed ? sumX / placed : 0);
    graph.setNodeAttribute(id, "y", placed ? sumY / placed : 0);
  }

  const dropped: EdgeDrops = {
    missingEndpoint: 0,
    selfLoop: 0,
    duplicate: 0,
    missingCoords: noCoords.length,
  };
  const weighted: { edge: string; weight: number }[] = [];
  for (const e of extractEdges(data)) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) {
      dropped.missingEndpoint += 1;
      continue;
    }
    if (e.source === e.target) {
      dropped.selfLoop += 1;
      continue;
    }
    if (graph.hasEdge(e.source, e.target)) {
      dropped.duplicate += 1;
      continue;
    }
    const edge = graph.addEdge(e.source, e.target, {
      color: e.color ?? opts.defaultEdgeColor,
      // ForceAtlas2 reads `weight` as attraction, and a negative attraction
      // makes it diverge, so the layout gets |weight|. The signed value is kept
      // as `rawWeight`; a missing weight (NaN) falls back to the default of 1.
      ...(e.weight !== undefined && Number.isFinite(e.weight)
        ? { weight: Math.abs(e.weight), rawWeight: e.weight }
        : {}),
    });
    if (e.weight !== undefined) weighted.push({ edge, weight: e.weight });
  }
  // Edge width follows |weight| over the graph's own range, so 0-1 scores and
  // 400-999 STRING scores both give visible, bounded widths.
  const widths = edgeWidths(weighted.map((w) => w.weight));
  weighted.forEach((w, k) => {
    graph.setEdgeAttribute(w.edge, "size", widths[k] as number);
  });

  // Seed a deterministic ring when coordinates are absent so ForceAtlas2 has a
  // non-degenerate starting configuration (it stalls if every node is at 0,0).
  if (!hasCoords && graph.order > 0) {
    let i = 0;
    const step = (2 * Math.PI) / graph.order;
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, "x", Math.cos(i * step));
      graph.setNodeAttribute(node, "y", Math.sin(i * step));
      i += 1;
    });
  }

  return { graph, dropped };
}

/** Run a bounded ForceAtlas2 layout in place. No-op for empty/edgeless graphs.
 * Iterations are clamped to a sane range. Mutates node x/y. */
export function runForceAtlas2(
  graph: graphology.default,
  iterations: number,
): void {
  if (graph.order < 2 || graph.size === 0) return;
  const iters = Math.max(1, Math.min(Math.round(iterations), 2000));
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, { iterations: iters, settings });
}
