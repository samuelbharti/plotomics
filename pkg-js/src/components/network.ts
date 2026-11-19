/**
 * Network graph — large gene/protein interaction networks.
 *
 * Renders on the GPU via **sigma v3** (WebGL) over a **graphology** graph model,
 * so tens of thousands of nodes/edges stay interactive. When node coordinates
 * are not supplied, a bounded run of **graphology-layout-forceatlas2** lays the
 * graph out; otherwise the provided x/y are used verbatim. Categorical node
 * groups are colored from the shared `plotomics/core` palette. Hovering a node
 * highlights it and its neighbors and shows a tooltip; zoom/pan are sigma's
 * built-in camera controls. When the nodes have groups, a legend of the groups
 * sits in a gutter on the right, so it never covers a node.
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
  textSizes,
  createTooltip,
  type Tooltip,
  measure,
  textWidth,
  fitText,
  fitLegend,
  legendLabelsFit,
  serializeSVG,
  compositePNG,
  categoricalColors,
} from "../core/index.js";
import Graph from "graphology";
import Sigma from "sigma";
import {
  EdgeArrowProgram,
  type NodeLabelDrawingFunction,
} from "sigma/rendering";
import {
  type NetworkLayout,
  type EdgeDrops,
  type GroupLegendEntry,
  buildGraph,
  groupColorResolver,
  groupLegend,
  needsLayout,
  runForceAtlas2,
} from "./network-core.js";

// Re-export the pure helpers so consumers (and lib/index.ts) get the whole
// component surface from this module.
export {
  type EdgeSpec,
  type EdgeDrops,
  type GroupLegendEntry,
  type NetworkLayout,
  buildGraph,
  extractEdges,
  groupColorResolver,
  groupLegend,
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
  /** Minimum node size (px) on screen for its label to render. At the
   * default of 4, nodes of the default size are labelled at the starting
   * zoom, and sigma's label grid keeps the labels from crowding. */
  labelThreshold: number;
  /** Default node radius (px) when `size` column is absent. */
  defaultNodeSize: number;
  /** Optional categorical palette override (else `plotomics/core` palette). */
  palette: string[] | null;
  /** Draw the graph as directed, with arrowheads. When true, `A -> B` and
   * `B -> A` are kept as distinct edges; when false (default) the graph is
   * undirected and a reciprocal pair collapses to one line. */
  directed: boolean;
  /** Draw a legend of the node groups, in a gutter on the right, when the
   * nodes have groups. */
  showLegend: boolean;
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
  labelThreshold: 4,
  defaultNodeSize: 4,
  palette: null,
  directed: false,
  showLegend: true,
  theme: {},
  onSelect: null,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Cap on legend rows before the rest go into a "+N more" line. */
const LEGEND_MAX = 14;
/** The largest share of the widget's width that the legend gutter takes. */
const MAX_LEGEND_SHARE = 0.35;
/** Space left and right of the legend, in px. */
const LEGEND_PAD = 8;
/** Sigma's canvases, bottom first. A hovered node is redrawn on hoverNodes
 * above the label box that hovers paints. */
const LAYER_ORDER = [
  "edges",
  "edgeLabels",
  "nodes",
  "labels",
  "hovers",
  "hoverNodes",
];

/** A legend row: a group and its colour, or the "+N more" line (no colour). */
interface LegendRow {
  label: string;
  color: string | null;
}

type LabelArgs = Parameters<NodeLabelDrawingFunction>;

/**
 * Which side of its node a label goes on, and its width. Sigma puts it on
 * the right; a label that would run past the right edge goes on the left.
 * Sets the label font on the context.
 */
function labelSide(
  context: LabelArgs[0],
  data: LabelArgs[1],
  settings: LabelArgs[2],
): { left: boolean; width: number } {
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  const width = context.measureText(data.label ?? "").width;
  // The context is scaled by the pixel ratio; the edge is in CSS pixels.
  const edge = context.canvas.width / (context.getTransform().a || 1);
  return { left: data.x + data.size + 3 + width > edge, width };
}

/** A node label, on the side that {@link labelSide} picks. */
const drawNodeLabel: NodeLabelDrawingFunction = (context, data, settings) => {
  if (!data.label) return;
  const size = settings.labelSize;
  const { left, width } = labelSide(context, data, settings);
  context.fillStyle = settings.labelColor.color ?? "#000";
  const x = left
    ? Math.max(0, data.x - data.size - 3 - width)
    : data.x + data.size + 3;
  context.fillText(data.label, x, data.y + size / 3);
};

/**
 * The hovered node: sigma's white box with a shadow around the node and its
 * label, on the same side as the label, then the label itself.
 */
const drawNodeHover: NodeLabelDrawingFunction = (context, data, settings) => {
  const size = settings.labelSize;
  const pad = 2;
  context.fillStyle = "#FFF";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 8;
  context.shadowColor = "#000";
  if (typeof data.label === "string") {
    const { left, width } = labelSide(context, data, settings);
    const boxWidth = Math.round(width + 5);
    const boxHeight = Math.round(size + 2 * pad);
    const radius = Math.max(data.size, size / 2) + pad;
    const angle = Math.asin(boxHeight / 2 / radius);
    const dx = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));
    // The box runs right of the node, or left of it for a label on the left.
    const s = left ? -1 : 1;
    context.beginPath();
    context.moveTo(data.x + s * dx, data.y + boxHeight / 2);
    context.lineTo(data.x + s * (radius + boxWidth), data.y + boxHeight / 2);
    context.lineTo(data.x + s * (radius + boxWidth), data.y - boxHeight / 2);
    context.lineTo(data.x + s * dx, data.y - boxHeight / 2);
    if (left)
      context.arc(data.x, data.y, radius, Math.PI + angle, Math.PI - angle);
    else context.arc(data.x, data.y, radius, angle, -angle);
    context.closePath();
    context.fill();
  } else {
    context.beginPath();
    context.arc(data.x, data.y, data.size + pad, 0, Math.PI * 2);
    context.closePath();
    context.fill();
  }
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 0;
  drawNodeLabel(context, data, settings);
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createNetwork: PlotomicsFactory<NetworkOptions> = (
  el,
  initial,
) => {
  let opts: NetworkOptions = mergeOptions(
    defaultNetworkOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  el.style.position = el.style.position || "relative";
  el.style.background = theme.background;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;";
  el.appendChild(host);
  // The legend, over the gutter right of the graph.
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  let width = 0;
  let height = 0;
  /** Width of the legend gutter, 0 when there is no legend. */
  let gutter = 0;
  let legend: GroupLegendEntry[] = [];

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

  /** The given palette, or the theme palette sized to the node groups. */
  function paletteColors(): string[] {
    if (opts.palette?.length) return opts.palette;
    const groups = (data.meta?.nodeGroup as unknown[] | undefined) ?? [];
    // Missing groups (null, NaN, "") take the default node colour.
    const n = new Set(
      groups
        .filter(
          (g) =>
            g != null &&
            g !== "" &&
            !(typeof g === "number" && Number.isNaN(g)),
        )
        .map((g) => String(g)),
    ).size;
    return categoricalColors(theme.categorical, n);
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
    if (dropped.missingCoords) {
      console.warn(
        `plotomics network: ${dropped.missingCoords} node(s) had no x or y ` +
          "and were placed at the centre of the others.",
      );
    }
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
    const labelSize = textSizes(theme).label;
    renderer = new Sigma(graph, host, {
      defaultNodeColor: opts.defaultNodeColor,
      defaultEdgeColor: opts.defaultEdgeColor,
      labelColor: { color: theme.foreground },
      labelFont: theme.fontFamily,
      labelSize,
      // Sigma shows a set number of labels per grid cell, 100 px wide by
      // default. The cell grows with the labels, so larger text is not more
      // crowded.
      labelGridCellSize: Math.round((100 * labelSize) / 11),
      defaultDrawNodeLabel: drawNodeLabel,
      defaultDrawNodeHover: drawNodeHover,
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

  /** Side of a legend swatch: 9 px next to the default 11 px labels. */
  function swatchSize(): number {
    return Math.round((textSizes(theme).label * 9) / 11);
  }

  /**
   * The legend rows and the width of their gutter. The rows are those the
   * height holds (see fitLegend), and the gutter is the widest row with its
   * swatch and padding, at most a share of the widget, with longer labels
   * cut. No rows and no gutter when there are no groups, when not one row
   * fits, or when the gutter cannot show a few characters of each label.
   */
  function legendLayout(): { rows: LegendRow[]; gutter: number } {
    const none = { rows: [], gutter: 0 };
    if (!opts.showLegend || legend.length === 0) return none;
    const fs = textSizes(theme).label;
    const rowH = Math.round(fs * 1.3);
    const y0 = Math.round(fs + 5);
    const groups = legend.filter((e) => !e.missing);
    const tail = legend.find((e) => e.missing);
    // Rows whose baseline is 6 px or more above the bottom, so the text
    // ends inside the widget.
    const fit = fitLegend(
      groups.length,
      tail !== undefined,
      Math.floor((height - 6 - y0) / rowH) + 1,
      LEGEND_MAX,
    );
    const rows: LegendRow[] = groups
      .slice(0, fit.shown)
      .map((e) => ({ label: e.label, color: e.color }));
    if (fit.more) rows.push({ label: `+${fit.more} more`, color: null });
    if (fit.missing && tail)
      rows.push({ label: tail.label, color: tail.color });
    if (rows.length === 0) return none;
    const sw = swatchSize();
    const labels = rows.map((r) => r.label);
    const longest = labels.reduce(
      (mx, s) => Math.max(mx, textWidth(s, fs, theme.fontFamily)),
      0,
    );
    const want = LEGEND_PAD + sw + 5 + Math.ceil(longest) + LEGEND_PAD;
    const gutter = Math.min(want, Math.floor(width * MAX_LEGEND_SHARE));
    const room = gutter - 2 * LEGEND_PAD - sw - 5;
    if (!legendLabelsFit(labels, room, fs, theme.fontFamily)) return none;
    return { rows, gutter };
  }

  /** Size the graph to the widget less the legend gutter, and draw the legend. */
  function layout() {
    const { rows, gutter: g } = legendLayout();
    gutter = g;
    host.style.width = `${Math.max(0, width - gutter)}px`;
    host.style.height = `${height}px`;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    drawLegend(rows);
  }

  function drawLegend(rows: LegendRow[]) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (rows.length === 0) return;
    const fs = textSizes(theme).label;
    const sw = swatchSize();
    const rowH = Math.round(fs * 1.3);
    const x0 = width - gutter + LEGEND_PAD;
    const room = gutter - 2 * LEGEND_PAD - sw - 5;
    let y = Math.round(fs + 5);
    for (const row of rows) {
      if (row.color) {
        const r = document.createElementNS(SVG_NS, "rect");
        r.setAttribute("x", String(x0));
        r.setAttribute("y", String(y - Math.round(fs * 0.35 + sw / 2)));
        r.setAttribute("width", String(sw));
        r.setAttribute("height", String(sw));
        r.setAttribute("rx", "2");
        r.setAttribute("fill", row.color);
        svg.appendChild(r);
      }
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(x0 + sw + 5));
      t.setAttribute("y", String(y));
      t.setAttribute("fill", row.color ? theme.foreground : theme.muted);
      t.setAttribute("text-anchor", "start");
      t.setAttribute("font-family", theme.fontFamily);
      t.setAttribute("font-size", String(fs));
      t.textContent = fitText(row.label, room, fs, theme.fontFamily);
      svg.appendChild(t);
      y += rowH;
    }
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
    // The new renderer never sends leaveNode for the old one's hovered node.
    tooltip.hide();
    const built = buildAndLayout();
    graph = built.graph;
    legend = groupLegend(graph, opts.defaultNodeColor);
    reportDropped(built.dropped);
    // Sigma reads the size of its container when it is created.
    layout();
    makeRenderer();
  }

  // Initial render.
  {
    const m = measure(el);
    width = m.width;
    height = m.height;
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
      width = w;
      height = h;
      layout();
      renderer?.resize();
      renderer?.refresh();
    },
    exportSVG() {
      // Sigma is WebGL; a true vector export is not available. Embed the
      // composited raster inside an <svg>, with the legend over it as vector,
      // so callers get a single figure asset.
      const canvas = compositeCanvas();
      if (!canvas) return null;
      const out = svg.cloneNode(true) as SVGSVGElement;
      out.removeAttribute("style");
      out.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("width", String(width));
      bg.setAttribute("height", String(height));
      bg.setAttribute("fill", theme.background);
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width - gutter));
      img.setAttribute("height", String(height));
      img.setAttributeNS(XLINK_NS, "xlink:href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      out.insertBefore(bg, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      const layers = sigmaLayers();
      if (!layers) return null;
      // compositePNG copies the canvases before it first waits, while they
      // still hold the frame drawn above.
      return compositePNG({
        width,
        height,
        scale,
        background: theme.background,
        layers: layers.map((canvas) => ({
          canvas,
          x: 0,
          y: 0,
          width: width - gutter,
          height,
        })),
        overlay: svg.firstChild ? svg : null,
      });
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      tooltip.destroy();
      renderer?.kill();
      renderer = null;
      host.remove();
      svg.remove();
    },
  };

  /**
   * Sigma's canvases in its own stacking order, freshly drawn, or null when
   * there is nothing to export.
   */
  function sigmaLayers(): HTMLCanvasElement[] | null {
    if (!renderer) return null;
    // Sigma's WebGL layers do not keep their drawing buffer, so a copy taken
    // after the frame was shown reads a cleared canvas. refresh() renders
    // synchronously, and the caller copies the canvases before the browser
    // clears them. A hidden container (a collapsed notebook output) has no
    // size, and Sigma then throws; there is nothing to export in that case.
    try {
      renderer.refresh();
    } catch {
      return null;
    }
    const canvases = renderer.getCanvases();
    const layers = LAYER_ORDER.map((k) => canvases[k]).filter(
      (c): c is HTMLCanvasElement => !!c,
    );
    return layers.length ? layers : null;
  }

  /** Flatten sigma's WebGL/canvas layers into one raster canvas over the theme
   * background so the SVG export holds edges, nodes and labels together. */
  function compositeCanvas(): HTMLCanvasElement | null {
    const layers = sigmaLayers();
    if (!layers) return null;
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mergeOptions(
  base: NetworkOptions,
  next?: Partial<NetworkOptions>,
): NetworkOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    palette: next.palette !== undefined ? next.palette : base.palette,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
