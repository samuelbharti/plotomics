/**
 * Pure, GPU-free helpers for the network component: data-contract parsing,
 * graph construction, group→color mapping and the ForceAtlas2 layout call.
 *
 * These are split out from `network.ts` so they can be unit-tested in a plain
 * Node environment — importing `sigma` (WebGL) at module load fails outside a
 * browser, so the factory keeps that import to itself.
 */
import type { PlotomicsData } from "@plotomics/core";
import { categoricalScale } from "@plotomics/core";
import Graph from "graphology";
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
        ...(w ? { weight: Number(w[i]) } : {}),
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
  return (group) => (group == null || group === "" ? defaultColor : scale(group));
}

/** Whether ForceAtlas2 should run: only in `"forceatlas2"` mode and only when
 * both x and y coordinate columns are absent (partial coords are ignored). */
export function needsLayout(data: PlotomicsData, layout: NetworkLayout): boolean {
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
): { graph: Graph; dropped: EdgeDrops } {
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

  const n = ids.length;
  for (let i = 0; i < n; i += 1) {
    const id = String(ids[i]);
    if (graph.hasNode(id)) continue;
    const group = groups ? String(groups[i]) : undefined;
    graph.addNode(id, {
      x: hasCoords ? Number(x![i]) : 0,
      y: hasCoords ? Number(y![i]) : 0,
      size: size ? Number(size[i]) : opts.defaultNodeSize,
      label: labels ? String(labels[i]) : id,
      color: opts.colorFor(group),
      ...(group !== undefined ? { group } : {}),
    });
  }

  const dropped: EdgeDrops = { missingEndpoint: 0, selfLoop: 0, duplicate: 0 };
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
    graph.addEdge(e.source, e.target, {
      color: e.color ?? opts.defaultEdgeColor,
      ...(e.weight !== undefined ? { weight: e.weight, size: e.weight } : {}),
    });
  }

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
export function runForceAtlas2(graph: Graph, iterations: number): void {
  if (graph.order < 2 || graph.size === 0) return;
  const iters = Math.max(1, Math.min(Math.round(iterations), 2000));
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, { iterations: iters, settings });
}
