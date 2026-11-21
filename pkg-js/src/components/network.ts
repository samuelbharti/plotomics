/**
 * Network graph — large gene/protein interaction networks.
 *
 * Renders on the GPU via **sigma v3** (WebGL) over a **graphology** graph model,
 * so tens of thousands of nodes/edges stay interactive. When node coordinates
 * are not supplied, a bounded run of **graphology-layout-forceatlas2** lays the
 * graph out; otherwise the provided x/y are used verbatim. Categorical node
 * groups are colored from the shared `plotomics/core` palette. Hovering a node
 * highlights it and its neighbors and shows a tooltip; zoom/pan are sigma's
 * built-in camera controls. Unless `boundedView` is false, zooming out stops
 * at the view of the whole graph, a pan stops at its edges and zooming in
 * stops at 1/10,000 of its range; a double-click or the reset button in the
 * top right corner goes back to the whole graph (see core/view.ts). When the
 * nodes have groups, a legend of the groups sits in a gutter on the right, so
 * it never covers a node.
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
 * - `meta.nodeGroupLevels` `string[]`    optional order of the groups (an R
 *                                        factor's levels, a pandas
 *                                        Categorical's categories): colours
 *                                        and legend rows follow it, unused
 *                                        levels included; other groups come
 *                                        after, in the order the nodes have them
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
  createPlotBox,
  type Tooltip,
  measure,
  textWidth,
  fitText,
  fitLegend,
  legendCandidates,
  legendLabelsFit,
  serializeSVG,
  padSVG,
  compositePNG,
  releaseContainer,
  categoricalColors,
  MIN_VIEW_SHARE,
  createResetButton,
} from "../core/index.js";
import { guardDestroy } from "../core/dom.js";
import {
  bytesToColour,
  colourBytes,
  hideUnreadableColours,
  luminance,
  plainColour,
  setCanvasColour,
  textFallback,
} from "../core/paint.js";
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
  type LabelBox,
  type LabelCandidate,
  buildGraph,
  clearLabels,
  groupColorResolver,
  groupLegend,
  groupOrder,
  needsLayout,
  runForceAtlas2,
} from "./network-core.js";

// Re-export the pure helpers so consumers (and lib/index.ts) get the whole
// component surface from this module.
export {
  type EdgeSpec,
  type EdgeDrops,
  type GroupLegendEntry,
  type LabelBox,
  type LabelCandidate,
  type NetworkLayout,
  LABEL_GAP,
  buildGraph,
  clearLabels,
  extractEdges,
  groupColorResolver,
  groupLegend,
  groupOrder,
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
  /** Colour of an edge with no colour of its own. `null` (the default)
   * takes the theme background with a fifth of the theme foreground mixed
   * in, so edges stay quieter than the nodes and the labels on a light and
   * on a dark background. */
  defaultEdgeColor: string | null;
  /** Minimum node size (px) on screen for its label to render. At the
   * default of 4, nodes of the default size are labelled at the starting
   * zoom, and sigma's label grid keeps the labels from crowding. Where
   * the letters of two labels would run into each other, the label of the
   * smaller node is left out. */
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
  /**
   * Keep pan and zoom inside the graph: zooming out stops at the view that
   * shows all of it, a pan stops at its edges, and zooming in stops at
   * 1/10,000 of its range. `false` lets the view move freely. Either way a
   * double-click, the reset button in the top right corner of the graph,
   * or `resetView()` goes back to the view of the whole graph.
   */
  boundedView: boolean;
}

/** The handle {@link createNetwork} returns. */
export interface NetworkInstance extends PlotomicsInstance<NetworkOptions> {
  /**
   * Go back to the home view, the one that shows the whole graph, as a
   * double-click or the reset button does: the camera moves there over
   * 150 ms. Does nothing at the home view, and nothing after `destroy()`.
   */
  resetView(): void;
}

export const defaultNetworkOptions: NetworkOptions = {
  layout: "forceatlas2",
  iterations: 200,
  defaultNodeColor: "#7c8598",
  defaultEdgeColor: null,
  labelThreshold: 4,
  defaultNodeSize: 4,
  palette: null,
  directed: false,
  showLegend: true,
  theme: {},
  onSelect: null,
  boundedView: true,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Sigma's camera at the view of the whole graph, where it starts. */
const HOME = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
/** How long the camera takes to go back to the home view, in ms. */
const RESET_MS = 150;

/**
 * Whether a camera state is the home view, give or take rounding. Sigma
 * bounds a pan through its float32 matrices, which leaves the camera up to
 * about 1e-7 off home after a drag at home: a millionth of the graph, far
 * below a pixel.
 */
function atHome(state: typeof HOME): boolean {
  return (
    Math.abs(state.x - HOME.x) < 1e-6 &&
    Math.abs(state.y - HOME.y) < 1e-6 &&
    Math.abs(state.ratio - HOME.ratio) < 1e-6 &&
    Math.abs(state.angle - HOME.angle) < 1e-6
  );
}
/** Cap on legend rows before the rest go into a "+N more" line. */
const LEGEND_MAX = 14;
/** The largest share of the widget's width that the legend gutter takes. */
const MAX_LEGEND_SHARE = 0.35;
/** Space left and right of the legend, in px. */
const LEGEND_PAD = 8;
/** Share of the theme foreground in the default edge colour. */
const EDGE_MIX = 0.2;
/**
 * Hex colours sigma reads as they are: 3, 6 or 8 digits. It reads the 4
 * digits of "#rgba" as the first digits of "#rrggbb", so those are read
 * for it like any other colour.
 */
const SIGMA_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Room sigma keeps by default between the node centres and its edges. */
const STAGE_PADDING = 30;
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

/**
 * The colours sigma draws a hover with, as hex or rgba(), the only forms
 * sigma reads: any other colour, such as "none", "grey90" or var(), it
 * draws black.
 *
 * - `label`: the label text, in the theme foreground, or, when that
 *   cannot be read, the default foreground for the background.
 * - `box`: the box behind a hovered label. It is the theme background when
 *   the label reads on it (a contrast of 4.5 or more), else white behind a
 *   dark label and near black behind a light one.
 * - `dim`: the nodes a hover fades. It is the grid colour, or, for a grid
 *   colour that paints nothing, the background with 15% of the label
 *   colour mixed in, or the label colour at 20% over no background.
 */
export function hoverColours(
  theme: Pick<PlotomicsTheme, "foreground" | "background" | "grid">,
  el?: Element,
): { label: string; box: string; dim: string } {
  const fg = colourBytes(theme.foreground, el) ??
    colourBytes(textFallback("foreground", theme.background, el)) ?? [
      0, 0, 0, 255,
    ];
  const bg = colourBytes(theme.background, el);
  const opaque = bg && bg[3] === 255 ? bg : null;
  const lf = luminance(fg);
  const lb = opaque ? luminance(opaque) : 0;
  const contrast = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  // White and black read equally well on a luminance of about 0.18.
  const box =
    opaque && contrast >= 4.5
      ? bytesToColour(opaque)
      : lf < 0.18
        ? "#ffffff"
        : "#111827";
  let dim = plainColour(theme.grid, el);
  if (!dim) {
    dim = opaque
      ? bytesToColour(
          [0, 1, 2].map((i) =>
            Math.round(0.85 * (opaque[i] as number) + 0.15 * (fg[i] as number)),
          ),
        )
      : `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.2)`;
  }
  return { label: bytesToColour(fg), box, dim };
}

/**
 * The colour of an edge with no colour of its own, as hex or rgba(), the
 * forms sigma reads. A `given` colour is used as it is, with var() and
 * currentColor read inside `el`; one that paints nothing, or that cannot
 * be read, is clear, as sigma draws any other form black. Without one it
 * is the theme background with a fifth of the foreground mixed in, which
 * stays quieter than the nodes and the labels on a light and on a dark
 * background. A foreground that cannot be read is the default one for the
 * background, as the labels take it. Over a background that paints
 * nothing it is the foreground at a fifth.
 */
export function edgeColour(
  theme: Pick<PlotomicsTheme, "foreground" | "background">,
  given: string | null,
  el?: Element,
): string {
  if (given) return plainColour(given, el) ?? "rgba(0, 0, 0, 0)";
  const fg = colourBytes(theme.foreground, el) ??
    colourBytes(textFallback("foreground", theme.background, el)) ?? [
      0, 0, 0, 255,
    ];
  const bg = colourBytes(theme.background, el);
  if (bg && bg[3] === 255) {
    return bytesToColour(
      [0, 1, 2].map((i) =>
        Math.round(
          (1 - EDGE_MIX) * (bg[i] as number) + EDGE_MIX * (fg[i] as number),
        ),
      ),
    );
  }
  return `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${EDGE_MIX})`;
}

/** A legend row: a group and its colour, or the "+N more" line (no colour). */
interface LegendRow {
  label: string;
  color: string | null;
}

type LabelArgs = Parameters<NodeLabelDrawingFunction>;

/**
 * Which side of its node a label goes on, and its width. Sigma puts it on
 * the right; a label that would run past the right edge goes on the left.
 * A label that `wasLeft` in the frame before stays there while it fits
 * there, so a zoom that moves its node away from the edge does not make it
 * jump to the other side and back. Sets the label font on the context.
 */
function labelSide(
  context: LabelArgs[0],
  data: LabelArgs[1],
  settings: LabelArgs[2],
  wasLeft = false,
): { left: boolean; width: number; metrics: TextMetrics } {
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  const metrics = context.measureText(data.label ?? "");
  const width = metrics.width;
  // The context is scaled by the pixel ratio; the edge is in CSS pixels.
  const edge = context.canvas.width / (context.getTransform().a || 1);
  const past = data.x + data.size + 3 + width > edge;
  const fitsLeft = data.x - data.size - 3 - width >= 0;
  return { left: past || (wasLeft && fitsLeft), width, metrics };
}

/**
 * Where a node label goes, on the side that {@link labelSide} picks: the x
 * its text starts at, its baseline, and the box its letters fill.
 */
function labelPlace(
  context: LabelArgs[0],
  data: LabelArgs[1],
  settings: LabelArgs[2],
  wasLeft = false,
): { x: number; baseline: number; box: LabelBox; left: boolean } {
  const size = settings.labelSize;
  const { left, width, metrics } = labelSide(context, data, settings, wasLeft);
  const x = left
    ? Math.max(0, data.x - data.size - 3 - width)
    : data.x + data.size + 3;
  const baseline = data.y + size / 3;
  // A browser without the measures of the letters gets the advance width
  // and most of the font size.
  const ink = (v: number, fallback: number) =>
    Number.isFinite(v) ? v : fallback;
  return {
    x,
    baseline,
    left,
    box: {
      left: x - ink(metrics.actualBoundingBoxLeft, 0),
      right: x + ink(metrics.actualBoundingBoxRight, width),
      top: baseline - ink(metrics.actualBoundingBoxAscent, size * 0.8),
      bottom: baseline + ink(metrics.actualBoundingBoxDescent, size * 0.2),
    },
  };
}

/** A node label, on the side that {@link labelSide} picks. */
function drawNodeLabel(
  context: LabelArgs[0],
  data: LabelArgs[1],
  settings: LabelArgs[2],
  wasLeft = false,
): void {
  if (!data.label) return;
  const { x, baseline } = labelPlace(context, data, settings, wasLeft);
  context.fillStyle = settings.labelColor.color ?? "#000";
  context.fillText(data.label, x, baseline);
}

/** A node label sigma asks for in a frame: where it goes, and how. */
interface FrameLabel extends LabelCandidate {
  /** The node. */
  key: string;
  /** Whether the label went on the left of its node. */
  left: boolean;
  text: string;
  x: number;
  baseline: number;
  font: string;
  color: string;
}

/**
 * Sigma's label grid, which its types leave out: per cell, the nodes in
 * the order the grid ranks them.
 */
interface LabelGrid {
  cells?: unknown;
}

/**
 * The node labels of a frame. Sigma asks for each label in turn, cell by
 * cell of its label grid; they are collected here and drawn when the frame
 * is done, larger nodes first and with no label whose letters run into one
 * already drawn (see {@link clearLabels}). Sigma's grid shows a set number
 * of labels per cell, but labels in neighbouring cells can still overlap.
 * The labels drawn in the frame before go first, so a zoom does not make a
 * label blink out for a frame.
 */
class FrameLabels {
  private labels: FrameLabel[] = [];
  private context: CanvasRenderingContext2D | null = null;
  /** The nodes whose labels the frame before drew. */
  private shown = new Set<string>();
  /** The nodes whose labels went on the left in the frame before. */
  private left = new Set<string>();
  /** The place of each node in its cell of sigma's label grid. */
  private ranks = new Map<string, number>();
  /** The cells the ranks were read from. */
  private rankedCells: unknown = null;

  /**
   * Read the place of each node in its cell of sigma's label grid, once
   * each time sigma builds the grid again. A sigma without the grid where
   * this looks leaves the ranks out, and labels on screen then go by the
   * size of their node.
   */
  private readRanks(renderer: Sigma): void {
    // The grid is sigma's own, outside its types, so a cell that is not a
    // list of nodes is passed over, and a read that throws leaves the
    // ranks out; the labels on screen then go by the size of their node.
    try {
      const grid = (renderer as unknown as { labelGrid?: LabelGrid }).labelGrid;
      const cells = grid?.cells;
      if (cells === this.rankedCells) return;
      this.rankedCells = cells;
      this.ranks = new Map();
      if (!cells || typeof cells !== "object") return;
      for (const cell of Object.values(cells)) {
        if (!Array.isArray(cell)) continue;
        cell.forEach((c: unknown, i) => {
          const key = (c as { key?: unknown } | null)?.key;
          if (typeof key === "string") this.ranks.set(key, i);
        });
      }
    } catch {
      this.rankedCells = null;
      this.ranks = new Map();
    }
  }

  /** The drawing function sigma calls for each label. */
  readonly collect: NodeLabelDrawingFunction = (context, data, settings) => {
    if (!data.label) return;
    // Sigma passes the node as `key`, which its type leaves out.
    const key = (data as { key?: string }).key ?? data.label;
    const { x, baseline, box, left } = labelPlace(
      context,
      data,
      settings,
      this.left.has(key),
    );
    this.context = context;
    this.labels.push({
      key,
      left,
      shown: this.shown.has(key),
      text: data.label,
      x,
      baseline,
      box,
      size: data.size,
      font: context.font,
      color: settings.labelColor.color ?? "#000",
    });
  };

  /** Forget the labels collected so far, as a new frame starts. */
  clear(): void {
    this.labels = [];
  }

  /** Whether the label of `key` went on the left in the frame before. */
  wasLeft(key: string): boolean {
    return this.left.has(key);
  }

  /**
   * Draw the labels that keep clear of each other, and forget them all.
   * With `remember`, the next frame lets them go first. A hover hides the
   * labels of the nodes it fades, so a frame drawn under a hover is not
   * remembered: the labels before it come back after it.
   */
  draw(remember: boolean, renderer: Sigma | null): void {
    const context = this.context;
    const drawn = new Set<string>();
    // Sigma builds its grid again in the frame, before it asks for labels.
    if (renderer) this.readRanks(renderer);
    for (const label of this.labels) label.rank = this.ranks.get(label.key);
    if (context) {
      for (const i of clearLabels(this.labels)) {
        const label = this.labels[i] as FrameLabel;
        context.font = label.font;
        context.fillStyle = label.color;
        context.fillText(label.text, label.x, label.baseline);
        drawn.add(label.key);
      }
    }
    if (remember) {
      this.shown = drawn;
      this.left = new Set(
        this.labels.filter((label) => label.left).map((label) => label.key),
      );
    }
    this.labels = [];
  }
}

/**
 * The hovered node: sigma's box with a shadow around the node and its
 * label, in `fill`, on the same side as the label, then the label itself.
 */
function drawNodeHover(
  context: LabelArgs[0],
  data: LabelArgs[1],
  settings: LabelArgs[2],
  fill: string,
  wasLeft = false,
): void {
  const size = settings.labelSize;
  const pad = 2;
  context.fillStyle = fill;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 8;
  context.shadowColor = "#000";
  if (typeof data.label === "string") {
    const { left, width } = labelSide(context, data, settings, wasLeft);
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
  drawNodeLabel(context, data, settings, wasLeft);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createNetwork: PlotomicsFactory<
  NetworkOptions,
  NetworkInstance
> = (el, initial) => {
  let opts: NetworkOptions = mergeOptions(
    defaultNetworkOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  el.style.position = el.style.position || "relative";
  // The plot's frame paints the theme background over the whole element,
  // under sigma's transparent canvases, so the element's own background is
  // left as it is.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;";
  // The legend, over the gutter right of the graph.
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  // Sigma and the legend draw in the plot box: the element less the theme
  // padding. `width` and `height` below are the size of the box.
  const plot = createPlotBox(el);
  plot.box.append(host, svg);
  let outerW = 0;
  let outerH = 0;
  /** Fit the plot box to an element `w` x `h` px and take its size. */
  function fitBox(w = outerW, h = outerH) {
    outerW = w;
    outerH = h;
    ({ width, height } = plot.fit(w, h, theme));
  }
  const tooltip: Tooltip = createTooltip(el, theme);
  // Over the graph, in its top right corner, clear of the legend gutter.
  // A wheel over it zooms the graph, through sigma's mouse layer.
  const resetButton = createResetButton(
    plot.box,
    el,
    () => resetView(),
    () => host.querySelector("canvas.sigma-mouse"),
  );

  let width = 0;
  let height = 0;
  /** Width of the legend gutter, 0 when there is no legend. */
  let gutter = 0;
  let legend: GroupLegendEntry[] = [];

  let graph: Graph = new Graph();
  let renderer: Sigma | null = null;
  /** The node labels of the frame being drawn. */
  const frameLabels = new FrameLabels();
  /**
   * The hover colours the renderer draws with (see hoverColours) and the
   * colour of the edges of a hovered node. The renderer reads them when it
   * draws, so a recolour changes them in place.
   */
  let hover = { label: "#000000", box: "#ffffff", dim: "#e5e7eb" };
  let hoverEdge = "#000000";
  let hovered: string | null = null;
  let neighborSet: Set<string> = new Set();

  const lastPointer = { x: 0, y: 0 };
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  };
  el.addEventListener("mousemove", onMove);

  /** The given levels of the node groups, as text. */
  function groupLevels(): string[] {
    const given = data.meta?.nodeGroupLevels as unknown[] | undefined;
    return Array.isArray(given) ? groupOrder(undefined, given) : [];
  }

  /** The node groups in the order they take their colours. */
  function groups(): string[] {
    return groupOrder(
      data.meta?.nodeGroup as unknown[] | undefined,
      groupLevels(),
    );
  }

  /** The given palette, or the theme palette sized to the node groups. */
  function paletteColors(): string[] {
    if (opts.palette?.length) return opts.palette;
    // Missing groups (null, NaN, "") take the default node colour.
    return categoricalColors(theme.categorical, groups().length);
  }

  /**
   * `colour` as sigma reads it: hex or rgba(), with var() and currentColor
   * read inside the element. Sigma draws any other colour black; one that
   * paints nothing comes back clear.
   */
  function sigmaColour(colour: string): string {
    return plainColour(colour, el) ?? "rgba(0, 0, 0, 0)";
  }

  /**
   * The colour of an edge with no colour of its own (see edgeColour). The
   * build, the renderer, readColours and recolour all take it from here,
   * so recolour finds the edges of the default colour by the one the last
   * build gave them.
   */
  function defaultEdge(): string {
    return edgeColour(theme, opts.defaultEdgeColor, el);
  }

  /** The colour of each node group, in the order of {@link groups}. */
  function groupColours(): (group: string | undefined) => string {
    return groupColorResolver(
      paletteColors().map(sigmaColour),
      sigmaColour(opts.defaultNodeColor),
      groups(),
    );
  }

  /**
   * A reader of the colours of the `color` column, as sigma reads them:
   * hex sigma reads as it is, and each other distinct colour once (see
   * sigmaColour), so one that paints nothing is clear, not black.
   */
  function edgeColourReader(): (colour: string) => string {
    const read = new Map<string, string>();
    return (colour) => {
      // Hex sigma reads goes as it is: a read takes a canvas, and a colour
      // scale gives each of thousands of edges a colour of its own.
      const given = colour.trim();
      if (SIGMA_HEX.test(given)) return given;
      let out = read.get(colour);
      if (out === undefined) {
        out = sigmaColour(colour);
        read.set(colour, out);
      }
      return out;
    };
  }

  /**
   * The colours of the `color` column that depend on the page, var() and
   * currentColor, as read now.
   */
  function pageEdgeColours(): string[] {
    const given = data.columns.color as unknown;
    if (!Array.isArray(given)) return [];
    const page = new Set<string>();
    for (const c of given) {
      if (typeof c === "string" && /var\(|currentcolor/i.test(c)) page.add(c);
    }
    return [...page].map((c) => `${c}=${sigmaColour(c)}`);
  }

  /**
   * The colours the graph is drawn with, as read inside the element: the
   * group palette, the default node and edge colours, the hover colours
   * and the edge colours that depend on the page.
   */
  function readColours(): string {
    return JSON.stringify([
      paletteColors().map(sigmaColour),
      sigmaColour(opts.defaultNodeColor),
      defaultEdge(),
      hoverColours(theme, el),
      pageEdgeColours(),
    ]);
  }
  /** The colours of the last build or recolour, from readColours. */
  let drawnColours = "";

  /**
   * Give the nodes and the edges the colours read now, an edge with a
   * colour of its own reading it again, and the renderer its new default
   * and hover colours, in place. The
   * graph, its layout, the camera and a hover stay as they are. A new
   * renderer started at the first view, and never sent leaveNode for the
   * node hovered in the old one, so its tooltip and dimming stayed. The
   * groups keep the order of their levels, in the colours and the legend.
   */
  function recolour(colours: string) {
    const colorFor = groupColours();
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(
        node,
        "color",
        colorFor(attrs.group as string | undefined),
      );
    });
    // An edge with a colour of its own reads it again; any other takes
    // the default colour.
    const edge = defaultEdge();
    const readEdge = edgeColourReader();
    graph.forEachEdge((key, attrs) => {
      const raw = attrs.rawColor as string | undefined;
      graph.setEdgeAttribute(
        key,
        "color",
        raw === undefined ? edge : readEdge(raw),
      );
    });
    legend = groupLegend(
      graph,
      sigmaColour(opts.defaultNodeColor),
      groupLevels(),
      colorFor,
    );
    drawnColours = colours;
    hover = hoverColours(theme, el);
    hoverEdge = sigmaColour(opts.defaultNodeColor);
    renderer?.setSetting(
      "defaultNodeColor",
      sigmaColour(opts.defaultNodeColor),
    );
    renderer?.setSetting("defaultEdgeColor", edge);
    renderer?.setSetting("labelColor", { color: hover.label });
  }

  function buildAndLayout(): {
    graph: Graph;
    dropped: EdgeDrops;
    colorFor: (group: string | undefined) => string;
  } {
    const colorFor = groupColours();
    const { graph: g, dropped } = buildGraph(data, {
      defaultNodeColor: sigmaColour(opts.defaultNodeColor),
      defaultEdgeColor: defaultEdge(),
      readEdgeColor: edgeColourReader(),
      defaultNodeSize: opts.defaultNodeSize,
      directed: opts.directed,
      colorFor,
    });
    if (needsLayout(data, opts.layout)) runForceAtlas2(g, opts.iterations);
    return { graph: g, dropped, colorFor };
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
    // Sigma draws its first frame while it is created, before the
    // listeners below are on, so the labels of the old renderer go now,
    // and those of the first frame are drawn once the listeners are on.
    frameLabels.clear();
    const labelSize = textSizes(theme).label;
    hover = hoverColours(theme, el);
    hoverEdge = sigmaColour(opts.defaultNodeColor);
    renderer = new Sigma(graph, host, {
      stagePadding: stagePadding(),
      // The padding can take the whole element, which leaves sigma's
      // container no width or height. Sigma would throw there; with this
      // setting it draws 1 px canvases, which the host hides.
      allowInvalidContainer: true,
      defaultNodeColor: sigmaColour(opts.defaultNodeColor),
      defaultEdgeColor: defaultEdge(),
      labelColor: { color: hover.label },
      labelFont: theme.fontFamily,
      labelSize,
      // Sigma shows a set number of labels per grid cell, 100 px wide by
      // default. The cell grows with the labels, so larger text is not more
      // crowded. A label whose letters would still run into those of
      // another is left out, the label of the smaller node first.
      labelGridCellSize: Math.round((100 * labelSize) / 11),
      defaultDrawNodeLabel: frameLabels.collect,
      // The hovered label goes on the side its label is on.
      defaultDrawNodeHover: (context, data, settings) =>
        drawNodeHover(
          context,
          data,
          settings,
          hover.box,
          frameLabels.wasLeft((data as { key?: string }).key ?? ""),
        ),
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
        return { ...attrs, color: hover.dim, label: "", zIndex: 0 };
      },
      edgeReducer: (edge, attrs) => {
        if (!hovered) return attrs;
        const [s, t] = graph.extremities(edge);
        if (s === hovered || t === hovered) {
          return { ...attrs, color: hoverEdge, zIndex: 1 };
        }
        return { ...attrs, hidden: true };
      },
    });

    applyBounds();
    // The reset button shows while the camera is away from home. A new
    // renderer starts at home.
    resetButton.show(false);
    renderer.getCamera().on("updated", (state) => {
      resetButton.show(!atHome(state));
    });
    // A double-click goes back to the whole graph, in place of sigma's
    // zoom in.
    const onDoubleClick = (e: { preventSigmaDefault(): void }) => {
      e.preventSigmaDefault();
      resetView();
    };
    renderer.on("doubleClickStage", onDoubleClick);
    renderer.on("doubleClickNode", onDoubleClick);

    renderer.on("beforeRender", () => frameLabels.clear());
    renderer.on("afterRender", () => frameLabels.draw(!hovered, renderer));
    frameLabels.draw(!hovered, renderer);
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

  /**
   * The box in graph coordinates that the home view shows, which a bounded
   * pan keeps the view inside, or null while sigma's container has no size.
   * It follows the size of the container, so a resize reads it again.
   */
  function homeBox(): { x: [number, number]; y: [number, number] } | null {
    if (!renderer) return null;
    const { width: w, height: h } = renderer.getDimensions();
    if (!(w > 0 && h > 0)) return null;
    const a = renderer.viewportToGraph({ x: 0, y: 0 }, { cameraState: HOME });
    const b = renderer.viewportToGraph({ x: w, y: h }, { cameraState: HOME });
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
    return {
      x: [Math.min(a.x, b.x), Math.max(a.x, b.x)],
      y: [Math.min(a.y, b.y), Math.max(a.y, b.y)],
    };
  }

  /**
   * Sigma's camera bounds, from boundedView: the ratio of the camera stays
   * from MIN_VIEW_SHARE (zoomed in) to 1 (the home view), and its pan
   * boundaries keep the view inside the box the home view shows. Sigma
   * applies them to every camera state, a wheel zoom, a drag and its
   * glide included, so the view never leaves them. With boundedView false
   * the camera moves freely, as sigma's defaults let it.
   */
  function applyBounds() {
    if (!renderer) return;
    const on = opts.boundedView !== false;
    const box = on ? homeBox() : null;
    renderer.setSettings({
      minCameraRatio: on ? MIN_VIEW_SHARE : null,
      maxCameraRatio: on ? 1 : null,
      cameraPanBoundaries: box ? { boundaries: box, tolerance: 0 } : null,
    });
  }

  /** Move the camera back to the home view, unless it is there. */
  function resetView() {
    const camera = renderer?.getCamera();
    if (!camera || atHome(camera.getState())) return;
    void camera.animate(HOME, { duration: RESET_MS });
  }

  /**
   * Room sigma keeps between the node centres and the edges of the plot
   * box. Sigma keeps 30 px of its own; the theme padding now gives part of
   * it, so sigma keeps 30 px less the smallest side of the padding, and the
   * total stays 30 px with the default. It never keeps less than the
   * radius of the largest node and the 2 px of its hover box, nor less
   * than the label size and 4 px, so the label and the hover box of a node
   * at the edge are not cut.
   */
  function stagePadding(): number {
    const p = plot.padding;
    let largest = 0;
    graph.forEachNode((_, attrs) => {
      const size = Number(attrs.size);
      if (Number.isFinite(size) && size > largest) largest = size;
    });
    const pad = Math.min(p.top, p.right, p.bottom, p.left);
    const label = textSizes(theme).label;
    return Math.max(
      Math.ceil(largest + 2),
      Math.ceil(label + 4),
      STAGE_PADDING - pad,
    );
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
   * fits, or when the widest gutter cannot show a few characters of every
   * label the legend can show at some height. That last check does not
   * depend on the height, so a taller widget never loses the legend.
   */
  function legendLayout(): { rows: LegendRow[]; gutter: number } {
    const none = { rows: [], gutter: 0 };
    if (!opts.showLegend || legend.length === 0) return none;
    const fs = textSizes(theme).label;
    const rowH = Math.round(fs * 1.3);
    const y0 = Math.round(fs + 5);
    const groups = legend.filter((e) => !e.missing);
    const tail = legend.find((e) => e.missing);
    const sw = swatchSize();
    const cap = Math.floor(width * MAX_LEGEND_SHARE);
    const candidates = legendCandidates(
      groups.map((e) => e.label),
      tail !== undefined,
      LEGEND_MAX,
    );
    const widest = cap - 2 * LEGEND_PAD - sw - 5;
    if (!legendLabelsFit(candidates, widest, fs, theme.fontFamily)) return none;
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
    const longest = rows.reduce(
      (mx, r) => Math.max(mx, textWidth(r.label, fs, theme.fontFamily)),
      0,
    );
    const want = LEGEND_PAD + sw + 5 + Math.ceil(longest) + LEGEND_PAD;
    return { rows, gutter: Math.min(want, cap) };
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
    resetButton.place(
      { left: 0, top: 0, width: Math.max(0, width - gutter), height },
      theme,
    );
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
    hideUnreadableColours(el, theme, svg);
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
    legend = groupLegend(
      graph,
      sigmaColour(opts.defaultNodeColor),
      groupLevels(),
      built.colorFor,
    );
    drawnColours = readColours();
    reportDropped(built.dropped);
    // Sigma reads the size of its container when it is created.
    layout();
    makeRenderer();
  }

  // Initial render.
  {
    const m = measure(el);
    fitBox(m.width, m.height);
    applyData();
  }

  const instance: NetworkInstance = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      fitBox();
      applyData();
    },
    resize(w, h) {
      fitBox(w, h);
      // Sigma cannot read var(), so its colours were read inside the
      // element. A custom property the page changed since takes its new
      // value here, as the canvas plots take it when they draw again.
      const colours = readColours();
      if (colours !== drawnColours) recolour(colours);
      layout();
      renderer?.resize();
      // The box the home view shows follows the size of the graph.
      applyBounds();
      renderer?.refresh();
    },
    resetView() {
      resetView();
    },
    exportSVG() {
      // Sigma is WebGL; a true vector export is not available. Embed the
      // composited raster inside an <svg>, with the legend over it as vector,
      // so callers get a single figure asset.
      const canvas = compositeCanvas();
      if (!canvas) return null;
      const out = svg.cloneNode(true) as SVGSVGElement;
      out.removeAttribute("style");
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width - gutter));
      img.setAttribute("height", String(height));
      img.setAttributeNS(XLINK_NS, "xlink:href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      // The theme padding goes around the plot, with the background under
      // all of it.
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
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
        padding: plot.padding,
        background: theme.background,
        element: el,
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
      releaseContainer(el);
      el.removeEventListener("mousemove", onMove);
      tooltip.destroy();
      renderer?.kill();
      renderer = null;
      plot.remove();
    },
  };

  /**
   * Sigma's canvases in its own stacking order, freshly drawn, or null when
   * there is nothing to export.
   */
  function sigmaLayers(): HTMLCanvasElement[] | null {
    // A hidden container (a collapsed notebook output), or a plot box the
    // padding takes whole, has no size: there is nothing to export.
    if (!renderer || host.offsetWidth === 0 || host.offsetHeight === 0) {
      return null;
    }
    // Sigma's WebGL layers do not keep their drawing buffer, so a copy taken
    // after the frame was shown reads a cleared canvas. refresh() renders
    // synchronously, and the caller copies the canvases before the browser
    // clears them.
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
    if (setCanvasColour(ctx, "fillStyle", theme.background, el)) {
      ctx.fillRect(0, 0, out.width, out.height);
    }
    for (const c of layers) ctx.drawImage(c, 0, 0);
    return out;
  }

  return guardDestroy(instance);
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
