/**
 * Network graph — large gene/protein interaction networks.
 *
 * Renders on the GPU via **sigma v3** (WebGL) over a **graphology** graph model,
 * so tens of thousands of nodes/edges stay interactive. When node coordinates
 * are not supplied, a bounded run of **graphology-layout-forceatlas2** lays the
 * graph out; otherwise the provided x/y are used verbatim. Categorical node
 * groups are colored from the shared `@plotomics/core` palette. Hovering a node
 * highlights it and its neighbors and shows a tooltip; zoom/pan are sigma's
 * built-in camera controls.
 *
 * Mirrors the volcano reference: pure helpers (in `network-core.ts`, unit-tested
 * without a GPU) plus a factory returning a PlotomicsInstance. Sigma touches WebGL
 * globals at import time, so it is imported only here — never in the test path.
 *
 * ## Data contract
 * - `columns.id`      `string[]`         node ids (required; also sets node count)
 * - `columns.x`,`y`   `number[]`         optional precomputed coordinates
 * - `columns.size`    `number[]`         optional per-node size (px radius)
 * - `columns.source`  `string[]`         edge source ids (index-aligned with target)
 * - `columns.target`  `string[]`         edge target ids
 * - `columns.weight`  `number[]`         optional per-edge weight
 * - `columns.color`   `string[]`         optional per-edge color (else defaultEdgeColor)
 * - `meta.nodeLabels` `string[]`         optional labels (default: id)
 * - `meta.nodeGroup`  `string[]`         optional categorical group -> palette color
 * - `meta.edges`      `[src,tgt][]`      alternative edge form (pairs of ids)
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
  canvasToPNG,
} from "@plotomics/core";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import {
  type NetworkLayout,
  type EdgeDrops,
  buildGraph,
  groupColorResolver,
  needsLayout,
  runForceAtlas2,
} from "./network-core.js";

// Re-export the pure helpers so consumers (and lib/index.ts) get the whole
// component surface from this module.
export {
  type EdgeSpec,
  type EdgeDrops,
  type NetworkLayout,
  buildGraph,
  extractEdges,
  groupColorResolver,
  needsLayout,
  runForceAtlas2,
} from "./network-core.js";

export interface NetworkOptions {
  /** `"forceatlas2"` runs a layout when x/y are missing; `"precomputed"`
   * requires x/y in the data and never runs a layout. */
  layout: NetworkLayout;
  /** ForceAtlas2 iteration count (bounded to keep layout time predictable). */
  iterations: number;
  /** Fallback node color when a node has no group. */
  defaultNodeColor: string;
  /** Edge color. */
  defaultEdgeColor: string;
  /** Minimum node size (px) for its label to render. */
  labelThreshold: number;
  /** Default node radius (px) when `size` column is absent. */
  defaultNodeSize: number;
  /** Optional categorical palette override (else `@plotomics/core` palette). */
  palette: string[] | null;
  /** Draw the graph as directed, with arrowheads. When true, `A -> B` and
   * `B -> A` are kept as distinct edges; when false (default) the graph is
   * undirected and a reciprocal pair collapses to one line. */
  directed: boolean;
  theme: Partial<PlotomicsTheme>;
  /** Called with a node id when a node is clicked, or `null` when the empty
   * canvas is clicked. In a Shiny app the runtime injects a handler that pushes
   * the value to `input$<outputId>_selected`. */
  onSelect: ((node: string | null) => void) | null;
}

export const defaultNetworkOptions: NetworkOptions = {
  layout: "forceatlas2",
  iterations: 200,
  defaultNodeColor: "#7c8598",
  defaultEdgeColor: "#d6dae1",
  labelThreshold: 8,
  defaultNodeSize: 4,
  palette: null,
  directed: false,
  theme: {},
  onSelect: null,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createNetwork: PlotomicsFactory<NetworkOptions> = (el, initial) => {
  let opts: NetworkOptions = mergeOptions(defaultNetworkOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  el.style.position = el.style.position || "relative";
  el.style.background = theme.background;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  el.appendChild(host);
  const tooltip: Tooltip = createTooltip(el, theme);

  let graph: Graph = new Graph();
  let renderer: Sigma | null = null;
  let hovered: string | null = null;
  let neighborSet: Set<string> = new Set();

  const lastPointer = { x: 0, y: 0 };
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  };
  el.addEventListener("mousemove", onMove);

  function paletteColors(): string[] {
    return opts.palette && opts.palette.length ? opts.palette : theme.categorical;
  }

  function buildAndLayout(): { graph: Graph; dropped: EdgeDrops } {
    const colorFor = groupColorResolver(paletteColors(), opts.defaultNodeColor);
    const { graph: g, dropped } = buildGraph(data, {
      defaultNodeColor: opts.defaultNodeColor,
      defaultEdgeColor: opts.defaultEdgeColor,
      defaultNodeSize: opts.defaultNodeSize,
      directed: opts.directed,
      colorFor,
    });
    if (needsLayout(data, opts.layout)) runForceAtlas2(g, opts.iterations);
    return { graph: g, dropped };
  }

  /** Warn once per render when edges were left out, so a caller is not shown an
   * incomplete graph without notice (unknown endpoint, self-loop, parallel). */
  function reportDropped(dropped: EdgeDrops) {
    const total =
      dropped.missingEndpoint + dropped.selfLoop + dropped.duplicate;
    if (total === 0) return;
    console.warn(
      `plotomics network: dropped ${total} edge(s): ` +
        `${dropped.missingEndpoint} with an unknown endpoint, ` +
        `${dropped.selfLoop} self-loop(s), ` +
        `${dropped.duplicate} parallel or duplicate.`,
    );
  }

  function makeRenderer() {
    renderer?.kill();
    renderer = new Sigma(graph, host, {
      defaultNodeColor: opts.defaultNodeColor,
      defaultEdgeColor: opts.defaultEdgeColor,
      labelColor: { color: theme.foreground },
      labelFont: theme.fontFamily,
      labelRenderedSizeThreshold: opts.labelThreshold,
      renderLabels: true,
      // Directed graphs draw arrowheads via sigma's arrow edge program.
      ...(opts.directed
        ? {
            defaultEdgeType: "arrow",
            edgeProgramClasses: { arrow: EdgeArrowProgram },
          }
        : {}),
      // Dim non-neighbors on hover; leave everything at full color otherwise.
      nodeReducer: (node, attrs) => {
        if (!hovered) return attrs;
        if (node === hovered || neighborSet.has(node)) {
          return { ...attrs, zIndex: 1 };
        }
        return { ...attrs, color: theme.grid, label: "", zIndex: 0 };
      },
      edgeReducer: (edge, attrs) => {
        if (!hovered) return attrs;
        const [s, t] = graph.extremities(edge);
        if (s === hovered || t === hovered) {
          return { ...attrs, color: opts.defaultNodeColor, zIndex: 1 };
        }
        return { ...attrs, hidden: true };
      },
    });

    renderer.on("enterNode", ({ node }) => {
      hovered = node;
      neighborSet = new Set(graph.neighbors(node));
      renderer?.refresh({ skipIndexation: true });
      showTip(node);
    });
    renderer.on("leaveNode", () => {
      hovered = null;
      neighborSet = new Set();
      renderer?.refresh({ skipIndexation: true });
      tooltip.hide();
    });
    // Clicking a node reports its id through onSelect. In Shiny the runtime
    // injects a handler that pushes the id to input$<outputId>_selected, so a
    // host app can react to the selection; outside Shiny this is a no-op.
    renderer.on("clickNode", ({ node }) => {
      opts.onSelect?.(node);
    });
    // Clicking the empty canvas clears the selection.
    renderer.on("clickStage", () => {
      opts.onSelect?.(null);
    });
  }

  function showTip(node: string) {
    const label = graph.getNodeAttribute(node, "label") as string | undefined;
    const group = graph.getNodeAttribute(node, "group") as string | undefined;
    const deg = graph.degree(node);
    const parts = [`<b>${escapeHtml(label ?? node)}</b>`];
    if (group) parts.push(`group: ${escapeHtml(group)}`);
    parts.push(`degree: ${deg}`);
    tooltip.show(parts.join("<br/>"), lastPointer.x, lastPointer.y);
  }

  function applyData() {
    hovered = null;
    neighborSet = new Set();
    const built = buildAndLayout();
    graph = built.graph;
    reportDropped(built.dropped);
    makeRenderer();
  }

  // Initial render.
  {
    const m = measure(el);
    host.style.width = `${m.width}px`;
    host.style.height = `${m.height}px`;
    applyData();
  }

  const instance: PlotomicsInstance<NetworkOptions> = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      el.style.background = theme.background;
      applyData();
    },
    resize(w, h) {
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      renderer?.resize();
      renderer?.refresh();
    },
    exportSVG() {
      // Sigma is WebGL; a true vector export is not available. Embed the
      // composited raster inside an <svg> so callers get a single figure asset.
      const canvas = compositeCanvas();
      if (!canvas) return null;
      const w = canvas.width;
      const h = canvas.height;
      const href = canvas.toDataURL("image/png");
      return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect width="${w}" height="${h}" fill="${theme.background}"/>` +
        `<image x="0" y="0" width="${w}" height="${h}" xlink:href="${href}"/>` +
        `</svg>`
      );
    },
    async exportPNG(scale = 2) {
      const canvas = compositeCanvas();
      if (!canvas) return null;
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      tooltip.destroy();
      renderer?.kill();
      renderer = null;
      host.remove();
    },
  };

  /** Flatten sigma's WebGL/canvas layers into one raster canvas over the theme
   * background so PNG/SVG export captures edges, nodes and labels together. */
  function compositeCanvas(): HTMLCanvasElement | null {
    if (!renderer) return null;
    const canvases = renderer.getCanvases();
    const order = ["edges", "edgeLabels", "nodes", "labels", "hovers"];
    const layers = order
      .map((k) => canvases[k])
      .filter((c): c is HTMLCanvasElement => !!c);
    if (layers.length === 0) return null;
    const out = document.createElement("canvas");
    out.width = layers[0]!.width;
    out.height = layers[0]!.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, out.width, out.height);
    for (const c of layers) ctx.drawImage(c, 0, 0);
    return out;
  }

  return instance;
};

// ---- small utilities ----
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mergeOptions(base: NetworkOptions, next?: Partial<NetworkOptions>): NetworkOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    palette: next.palette !== undefined ? next.palette : base.palette,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
