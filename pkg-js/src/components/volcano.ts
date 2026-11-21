/**
 * Volcano plot — differential-expression scatter of effect size vs. significance.
 *
 * Renders points on the GPU via regl-scatterplot (handles millions of genes /
 * features at 60fps) while drawing crisp vector axes, threshold guides and gene
 * labels on an SVG overlay that stays in sync with pan/zoom. This file is the
 * reference implementation for the whole component library — new components
 * should mirror its structure (pure helpers + a factory returning a
 * PlotomicsInstance).
 *
 * The gridlines sit in a second SVG under the points, so no line crosses a
 * point.
 *
 * Pan and zoom stay inside the data unless `boundedView` is false, and a
 * double-click or the reset button in the top right corner of the plot
 * area goes back to the view of all the data (see core/view.ts).
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type Column,
  type TextSizes,
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
  toNdc,
  baseDomains,
  fitView,
  resizeView,
  isStartView,
  START_VIEW,
  type ViewMatrix,
  frameView,
  atView,
  boundCamera,
  createResetButton,
  createRenderLoop,
  afterQuiet,
} from "../core/index.js";
import { guardDestroy } from "../core/dom.js";
import { fitAxisTicks } from "../core/ticks.js";
import {
  hideUnreadableColours,
  scatterBackground,
  scatterColour,
} from "../core/paint.js";
import createScatterplot from "regl-scatterplot";
import { scaleLinear } from "d3-scale";
import { ticks as d3ticks } from "d3-array";

export interface VolcanoOptions {
  /** |log2 fold change| cutoff for calling a gene up/down. */
  fcThreshold: number;
  /** p-value cutoff (compared on the -log10 scale). */
  pThreshold: number;
  pointSize: number;
  opacity: number;
  colors: { up: string; down: string; ns: string };
  xLabel: string;
  yLabel: string;
  /** Draw the dashed fold-change and p-value threshold lines. The y axis
   * then always reaches the p-value line. */
  showThresholdLines: boolean;
  /** Label the N most significant up- and down-regulated genes. */
  labelTopN: number;
  /**
   * Keep pan and zoom inside the data: zooming out stops at the view that
   * shows all of it, a pan stops at its edges, and zooming in stops at
   * 1/10,000 of its range on each axis. `false` lets the view move freely.
   * Either way a double-click, the reset button in the top right corner of
   * the plot area, or `resetView()` goes back to the view of all the data.
   */
  boundedView: boolean;
  theme: Partial<PlotomicsTheme>;
}

/** The handle {@link createVolcano} returns. */
export interface VolcanoInstance extends PlotomicsInstance<VolcanoOptions> {
  /**
   * Go back to the home view, the one that shows all the data, as a
   * double-click or the reset button does. Does nothing at the home view,
   * and nothing after `destroy()`.
   */
  resetView(): void;
}

export const defaultVolcanoOptions: VolcanoOptions = {
  fcThreshold: 1,
  pThreshold: 0.05,
  pointSize: 3,
  opacity: 0.8,
  colors: { up: "#D55E00", down: "#0072B2", ns: "#b0b0b0" },
  xLabel: "log2 fold change",
  yLabel: "-log10 p-value",
  showThresholdLines: true,
  labelTopN: 10,
  boundedView: true,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Margins around the plot area. They hold the tick labels and the axis
 * titles, so they grow with the text: 16, 18, 46 and 60 px at the default
 * sizes of 11 px ticks and 13 px titles. The left margin fits the y title
 * and tick labels of about five characters; the plot widens it, and the
 * right margin, for longer tick labels (see fitTickMargins).
 */
function axisMargins(sizes: TextSizes): Margins {
  return {
    top: Math.round(sizes.label + 5),
    right: Math.round(sizes.label + 7),
    bottom: Math.round(sizes.label + sizes.axisTitle + 22),
    left: Math.round(sizes.axisTitle + 4.3 * sizes.label),
  };
}

/** Space around the plot area, in px. */
interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Whether two sets of margins are the same on every side. */
function sameSides(a: Margins, b: Margins): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}

/**
 * The largest shares of the plot box that the left and right margins take
 * for long tick labels.
 */
const MAX_LEFT_SHARE = 0.4;
const MAX_RIGHT_SHARE = 0.2;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/volcano.test.ts)
// ---------------------------------------------------------------------------

/**
 * Min/max of the finite values of a numeric column, with symmetric padding
 * (fraction of range). NaN, null and Infinity are left out.
 */
export function paddedExtent(col: Column, pad = 0.04): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const n = col.length;
  for (let i = 0; i < n; i += 1) {
    const v = (col as ArrayLike<number>)[i] as number;
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const d = (max - min) * pad;
  return [min - d, max + d];
}

/** Symmetric x-extent so the volcano is centered on log2FC = 0. */
export function symmetricExtent(col: Column, pad = 0.04): [number, number] {
  const [lo, hi] = paddedExtent(col, pad);
  const m = Math.max(Math.abs(lo), Math.abs(hi));
  return [-m, m];
}

export type Category = 0 | 1 | 2; // 0 down, 1 ns, 2 up

/**
 * Classify a point given its log2FC (x), -log10p (y) and cutoffs. A missing
 * (NaN) value is never a hit.
 */
export function classify(
  x: number,
  y: number,
  fcThreshold: number,
  yThreshold: number,
): Category {
  if (!(y >= yThreshold)) return 1;
  if (x >= fcThreshold) return 2;
  if (x <= -fcThreshold) return 0;
  return 1;
}

/** The points that can be drawn, in row order. */
export interface VolcanoPoints {
  /** Data row of each drawn point. */
  rows: Int32Array;
  /** log2 fold change of each drawn point. */
  x: Float64Array;
  /** -log10 p as given; +Infinity for p = 0. */
  y: Float64Array;
  /** The y each point is drawn at: Infinity becomes the top of the plot. */
  yDraw: Float64Array;
}

/** Whether a y threshold is one the plot shows: finite and above 0. */
function shownThreshold(y: number | undefined): y is number {
  return y !== undefined && Number.isFinite(y) && y > 0;
}

/**
 * Read the x and y columns into the points that can be drawn. A row with a
 * missing x or y (null, which is how R's JSON sends NA, or NaN) is left out.
 * A y of +Infinity (p = 0, common in differential-expression tables) is kept:
 * it is classified as significant and drawn just above the highest finite y
 * and the threshold line at `yThreshold`, so it sits with the significant
 * genes. `infiniteRows` lists rows whose y is +Infinity even though the
 * column holds null there; R uses it, because JSON has no Infinity.
 */
export function preparePoints(
  xCol: Column,
  yCol: Column,
  infiniteRows?: ArrayLike<number>,
  yThreshold?: number,
): VolcanoPoints {
  const n = Math.min(xCol.length, yCol.length);
  const inf = new Set<number>();
  if (infiniteRows) {
    for (let k = 0; k < infiniteRows.length; k += 1) {
      inf.add(infiniteRows[k] as number);
    }
  }
  const read = (col: Column, i: number) => {
    const v = (col as ArrayLike<number | null>)[i];
    return v == null ? Number.NaN : Number(v);
  };
  const rows: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = read(xCol, i);
    const y = inf.has(i) ? Infinity : read(yCol, i);
    if (!Number.isFinite(x)) continue;
    if (!Number.isFinite(y) && y !== Infinity) continue;
    rows.push(i);
    xs.push(x);
    ys.push(y);
    if (Number.isFinite(y)) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  // 5% of the drawn y range above the highest finite y and the threshold
  // line. The axis starts at 0, so the range is measured from 0, which
  // keeps p = 0 clear of the top finite point when the finite values sit
  // in a narrow band.
  if (shownThreshold(yThreshold) && yThreshold > hi) hi = yThreshold;
  const span = hi - Math.min(0, lo);
  const top = Number.isFinite(hi) ? hi + 0.05 * (span || 1) : 1;
  return {
    rows: Int32Array.from(rows),
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    yDraw: Float64Array.from(ys, (y) => (y === Infinity ? top : y)),
  };
}

/**
 * The y range a fit shows: the drawn y values with 4% of their range above
 * and below, down to 0 at least. The highest point, or the threshold line
 * at `yThreshold` when the plot draws one, keeps 4% of the axis above it,
 * so the line is always in view and p = 0 drawn above a high finite y is
 * not cut by the top of the plot.
 */
export function yRange(
  yDraw: ArrayLike<number>,
  yThreshold?: number,
): [number, number] {
  const range = paddedExtent(yDraw as Column);
  range[0] = Math.min(0, range[0]);
  let high = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < yDraw.length; i += 1) {
    const y = yDraw[i] as number;
    if (Number.isFinite(y) && y > high) high = y;
  }
  if (shownThreshold(yThreshold) && yThreshold > high) high = yThreshold;
  if (Number.isFinite(high)) {
    const top = high + 0.04 * (high - range[0]);
    if (range[1] < top) range[1] = top;
  }
  return range;
}

/**
 * Widen `range`, the range of an axis `length` px long that holds the
 * points from `lo` to `hi`, so that each end keeps at least `room` px past
 * the outermost point: a point `2 * room` px across then ends inside the
 * plot. The room the range gives already is kept. A point too large for
 * the axis takes at most 45% of it at each end.
 */
export function roomForPoints(
  range: [number, number],
  lo: number,
  hi: number,
  room: number,
  length: number,
): [number, number] {
  if (
    !(length > 0) ||
    !(room > 0) ||
    !Number.isFinite(lo) ||
    !Number.isFinite(hi) ||
    hi < lo
  ) {
    return range;
  }
  const f = Math.min(room / length, 0.45);
  const below = Math.max(0, lo - range[0]);
  const above = Math.max(0, range[1] - hi);
  const d = hi - lo;
  // The span s holds the points and, at each end, the larger of the room
  // given and the share f of s: s = d + max(below, f s) + max(above, f s).
  // Each way of taking the two maxima gives a span, and the one that
  // holds is the largest of them.
  const span = Math.max(
    d + below + above,
    (d + below) / (1 - f),
    (d + above) / (1 - f),
    d / (1 - 2 * f),
  );
  return [lo - Math.max(below, f * span), hi + Math.max(above, f * span)];
}

/**
 * The smallest and the largest finite value, read in one pass, so a
 * million points do not overflow the call stack as a spread would.
 * NaN for both when no value is finite.
 */
function finiteExtent(values: ArrayLike<number>): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [Number.NaN, Number.NaN];
}

/** Tooltip HTML for one point; the label is escaped. */
export function tooltipHtml(label: string, x: number, y: number): string {
  const yText = y === Infinity ? "Inf (p = 0)" : y.toFixed(2);
  return `<b>${escapeHTML(label)}</b><br/>log2FC: ${x.toFixed(2)}<br/>-log10p: ${yText}`;
}

/** A label box in pixels, for overlap checks. */
export interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Place labels next to their points without overlap. Each label tries the
 * four corners around its point (right-above first) and takes the first one
 * that stays inside `bounds` and clears every label placed before it, and
 * every box in `taken`, such as the reset button; a label with no free
 * corner is left out. Labels are placed in the order given, so pass the
 * most important first.
 */
export function placeLabels(
  items: { x: number; y: number; width: number }[],
  bounds: LabelBox,
  fontSize: number,
  taken: readonly LabelBox[] = [],
): ({ x: number; y: number; anchor: "start" | "end" } | null)[] {
  const placed: LabelBox[] = [...taken];
  const gap = 4;
  // Baseline offsets: above the point, or below it.
  const above = -gap;
  const below = gap + fontSize;
  const tries: [number, number, "start" | "end"][] = [
    [gap, above, "start"],
    [-gap, above, "end"],
    [gap, below, "start"],
    [-gap, below, "end"],
  ];
  return items.map((it) => {
    for (const [dx, dy, anchor] of tries) {
      const bx = it.x + dx;
      const by = it.y + dy;
      const box: LabelBox = {
        left: anchor === "start" ? bx : bx - it.width,
        right: anchor === "start" ? bx + it.width : bx,
        top: by - fontSize * 0.8,
        bottom: by + fontSize * 0.2,
      };
      if (
        box.left < bounds.left ||
        box.right > bounds.right ||
        box.top < bounds.top ||
        box.bottom > bounds.bottom
      ) {
        continue;
      }
      const hit = placed.some(
        (p) =>
          box.left < p.right + 1 &&
          box.right > p.left - 1 &&
          box.top < p.bottom + 1 &&
          box.bottom > p.top - 1,
      );
      if (hit) continue;
      placed.push(box);
      return { x: bx, y: by, anchor };
    }
    return null;
  });
}

/** Nice axis tick values for a domain. */
export function niceTicks(domain: [number, number], count = 6): number[] {
  return d3ticks(domain[0], domain[1], count);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createVolcano: PlotomicsFactory<
  VolcanoOptions,
  VolcanoInstance
> = (el, initial) => {
  let opts: VolcanoOptions = mergeOptions(
    defaultVolcanoOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  // Text sizes and the margins that hold the axis text, from the theme.
  let sizes = textSizes(theme);
  // The margins the text sizes give, and those in use, whose left and
  // right sides widen for long tick labels.
  let baseMargin = axisMargins(sizes);
  let margin = baseMargin;
  // True while the plot area takes margins just widened. The view it then
  // reports may only widen them again, so a change never undoes itself.
  let settling = false;
  let data: PlotomicsData = initial.data ?? { columns: {} };

  // Layout state: the size of the element, and of the plot box inside its
  // padding, which every layer and coordinate below is in.
  let outerW = 0;
  let outerH = 0;
  let width = 0;
  let height = 0;
  // The visible range, which follows pan/zoom and drives the axes.
  let xDomain: [number, number] = [-1, 1];
  let yDomain: [number, number] = [0, 1];
  // The range that [-1, 1] stands for, fixed at the last fit. A redraw at
  // the current zoom converts the points with this one.
  let baseX: [number, number] = [-1, 1];
  let baseY: [number, number] = [0, 1];
  // The plot area at the last fit, in px.
  let fitSize: [number, number] = [0, 0];
  // The home view: the camera view that shows all the data in the plot
  // area and with the options of now. A fit makes it the start view. When
  // the plot area or a fit option changes while the view is away from home,
  // the base ranges and the camera stay, so the view keeps its place and
  // its scale, and the home view frames the new fit over the old ranges.
  let homeView: Float32Array = Float32Array.from(START_VIEW);
  // Whether the camera is at the home view, as of the last change to either.
  let atHome = true;
  // True while a fit runs: the plot area it changes is fitted after it.
  let fitting = false;
  // The height of the plot area the camera was last placed for, in px.
  let cameraHeight = 0;

  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);

  // DOM: a canvas (GPU points) inset by margins, between two full-size SVGs.
  // The one under it holds the gridlines, which show through the canvas
  // because regl-scatterplot leaves it transparent where there is no point.
  // The one over it holds the axes, the threshold lines and the labels.
  el.style.position = el.style.position || "relative";
  // regl-scatterplot leaves the canvas transparent. The plot's frame paints
  // the theme background under it, over the whole element, the axis margins
  // included, so the element's own background is left as it is.
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;";
  const under = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  for (const layer of [under, svg]) {
    layer.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  }
  const plot = createPlotBox(el);
  plot.box.append(under, canvas, svg);
  const tooltip: Tooltip = createTooltip(el, theme);
  // Over the layers, in the top right corner of the plot area. A wheel
  // over it zooms the points.
  const resetButton = createResetButton(
    plot.box,
    el,
    () => resetView(),
    () => canvas,
  );

  // GPU scatter. It draws points in [-1, 1], and keeps the d3 scales in sync
  // with pan/zoom once fitView() has handed them over. See core/scatter.ts.
  const scatterplot = createScatterplot({
    canvas,
    xScale,
    yScale,
    pointSize: opts.pointSize,
    opacity: opts.opacity,
    backgroundColor: scatterBackground(theme, el),
    lassoInitiator: false,
  });
  // The camera stays inside the view of all the data, the one the last
  // fit made, unless boundedView is false.
  const cameraBounds = boundCamera(scatterplot, {
    bounded: () => opts.boundedView !== false,
    aspect: () => innerW() / innerH(),
    home: () => homeView,
  });
  const loop = createRenderLoop((fit) => render(fit));
  let destroyed = false;
  // Until the person pans or zooms, the plot keeps showing all the data, so
  // it fits again once a resize has settled. After that it keeps their view,
  // and the home view follows the new size at once (see areaMoved).
  const refitAfterResize = afterQuiet(() => {
    if (data.columns.x && atHome) applyData(true);
  }, 120);

  scatterplot.subscribe("pointOver", (i: number) => {
    // A drag pans the view or draws a lasso: no tooltip until it ends.
    if (pressed) forgetHover();
    else showTip(i);
  });
  scatterplot.subscribe("pointOut", () => tooltip.hide());
  scatterplot.subscribe("view", () => {
    // A view published after destroy() has no camera to read.
    if (destroyed) return;
    // Domains were mutated in place by the scatterplot; redraw the overlay.
    xDomain = xScale.domain() as [number, number];
    yDomain = yScale.domain() as [number, number];
    // The reset button shows while the view is away from home, and the
    // labels the overlay places keep clear of it.
    syncHome();
    renderOverlay();
    // The point the tooltip names has moved with the view.
    forgetHover();
  });
  // A lasso stops the hover, and the tooltip would stay through it.
  scatterplot.subscribe("lassoStart", () => forgetHover());

  /**
   * Hide the tooltip, and forget the hovered point, so the next move of
   * the pointer names the point under it, also when that is the same one.
   */
  function forgetHover() {
    tooltip.hide();
    scatterplot.hover(-1, { preventEvent: true });
  }

  // The points drawn last, in drawn order. regl-scatterplot reports drawn
  // indices, and rows with a missing value are not drawn, so map back here.
  let pts: VolcanoPoints = preparePoints([], []);

  function showTip(i: number) {
    const row = pts.rows[i];
    if (row === undefined) return;
    const label = str(data.columns.label, row) ?? `#${row}`;
    tooltip.show(
      tooltipHtml(label, pts.x[i] as number, pts.y[i] as number),
      lastPointer.x,
      lastPointer.y,
    );
  }

  const lastPointer = { x: 0, y: 0 };
  /** Whether a mouse button was down at the last move over the plot. */
  let pressed = false;
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    pressed = e.buttons !== 0;
  };
  el.addEventListener("mousemove", onMove);
  // A double-click goes back to the view of all the data. regl-scatterplot
  // also clears the selection on it.
  const onDblClick = () => resetView();
  canvas.addEventListener("dblclick", onDblClick);

  /**
   * Go back to the home view: fit all the data again, at the plot area and
   * the options of now. At the home view there is nothing to do.
   */
  function resetView() {
    if (destroyed || !data.columns.x || atHome) return;
    applyData(true);
  }

  /**
   * The parts of a fit that do not depend on the size of the plot area,
   * kept for the points and threshold line they were read from, so a
   * resize reads no point.
   */
  let fitParts: {
    pts: VolcanoPoints;
    line: number | undefined;
    x: [number, number];
    y: [number, number];
    xLo: number;
    xHi: number;
    yLo: number;
    yHi: number;
  } | null = null;

  /**
   * The data ranges a fit to a plot area `w` x `h` px shows, for the
   * points and the options of now; null with no point to show.
   */
  function fitRanges(
    w: number,
    h: number,
  ): [[number, number], [number, number]] | null {
    if (pts.rows.length === 0) return null;
    const line = opts.showThresholdLines
      ? -Math.log10(opts.pThreshold)
      : undefined;
    if (!fitParts || fitParts.pts !== pts || fitParts.line !== line) {
      const [xLo, xHi] = finiteExtent(pts.x);
      const [yLo, yHi] = finiteExtent(pts.yDraw);
      fitParts = {
        pts,
        line,
        x: symmetricExtent(pts.x),
        y: yRange(pts.yDraw, line),
        xLo,
        xHi,
        yLo,
        yHi,
      };
    }
    const f = fitParts;
    // Each side keeps the radius of a point, and a pixel, past the
    // outermost points, so a large point is not cut by the plot's edge.
    const room = opts.pointSize / 2 + 1;
    const [x0, x1] = roomForPoints([...f.x], f.xLo, f.xHi, room, w);
    // The x range stays centred on 0.
    const half = Math.max(Math.abs(x0), Math.abs(x1));
    return [[-half, half], roomForPoints([...f.y], f.yLo, f.yHi, room, h)];
  }

  /**
   * Frame the home view again, for the plot area and the options of now,
   * over the base ranges of the last fit, and bound the camera to it. With
   * `follow`, a camera at home moves to the new home view with it.
   */
  function updateHome(follow: boolean) {
    const ranges = fitRanges(innerW(), innerH());
    if (!ranges) return;
    homeView = frameView(
      ranges[0],
      ranges[1],
      baseX,
      baseY,
      innerW() / innerH(),
    );
    cameraBounds.update();
    if (follow)
      void scatterplot.set({ cameraView: Float32Array.from(homeView) });
    syncHome();
  }

  /** Read whether the camera is at home, and show the reset button if not. */
  function syncHome() {
    const view = scatterplot.get("cameraView") as ViewMatrix | undefined;
    atHome = !view || atView(view, homeView);
    resetButton.show(!atHome);
  }

  /**
   * The plot area changed: a resize, a new margin for longer tick labels,
   * new text sizes or padding. The home view follows it, and so does a
   * camera at home. A fit that runs fits the new area itself.
   */
  function areaMoved() {
    if (fitting) return;
    // One camera unit is half the plot area's height on both axes, so a
    // view away from home keeps its data units per pixel, its scale, when
    // the height changes by scaling with it about its centre. A new width
    // keeps them as it is: a wider area shows more around the same centre.
    const h = innerH();
    if (!atHome && cameraHeight > 0 && h !== cameraHeight) {
      const view = Float32Array.from(
        scatterplot.get("cameraView") as ArrayLike<number>,
      );
      const k = cameraHeight / h;
      for (const i of [0, 5, 12, 13]) view[i] = (view[i] as number) * k;
      void scatterplot.set({ cameraView: view });
    }
    cameraHeight = h;
    updateHome(atHome);
  }

  // ---- pixel mapping (overlay) ----
  const innerW = () => Math.max(1, width - margin.left - margin.right);
  const innerH = () => Math.max(1, height - margin.top - margin.bottom);
  const pxX = (v: number) =>
    margin.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW();
  const pxY = (v: number) =>
    margin.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH();

  const labelWidth = (s: string) => textWidth(s, sizes.label, theme.fontFamily);
  const widest = (labels: string[]) =>
    labels.reduce((w, s) => Math.max(w, labelWidth(s)), 0);
  /** The baseline of the y title, turned upright. */
  const yTitleX = () => Math.round(3 + sizes.axisTitle);
  /**
   * The left margin that y tick labels `labels` need: the y title, whose
   * letters reach 0.3 of its size right of its baseline, 4 px, the
   * labels, and the 8 px from their end to the axis.
   */
  const leftFor = (labels: string[]) =>
    Math.ceil(yTitleX() + 0.3 * sizes.axisTitle + 4 + widest(labels) + 8);

  /**
   * Round ticks with exact labels in one unit per axis, for the current
   * view and plot area: as many as keep the labels clear of each other.
   */
  function axisTicks() {
    return {
      x: fitAxisTicks(xDomain[0], xDomain[1], innerW(), labelWidth, {
        maxCount: 6,
        gapPx: 8,
      }),
      y: fitAxisTicks(yDomain[0], yDomain[1], innerH(), () => sizes.label, {
        maxCount: 6,
        gapPx: 5,
      }),
    };
  }

  /**
   * Fit the left margin to the widest y tick label in view, and the right
   * margin to half the widest x tick label, which is centred on a tick
   * that can sit at the right end of the plot area. Deep in a zoom, exact
   * labels such as "0.85630" are longer than the margins the text sizes
   * give, and would run under the y title or past the edge. A margin stays
   * between the one the text sizes give and a share of the plot box; with
   * `growOnly` it only widens. Returns whether a margin changed: the plot
   * area then takes its new size and keeps its view, which it reports on
   * the next frame.
   */
  function fitTickMargins(growOnly: boolean): boolean {
    const { x, y } = axisTicks();
    let left = Math.min(
      Math.max(baseMargin.left, leftFor(y.labels)),
      Math.max(baseMargin.left, Math.floor(MAX_LEFT_SHARE * width)),
    );
    let right = Math.min(
      Math.max(baseMargin.right, Math.ceil(widest(x.labels) / 2 + 1)),
      Math.max(baseMargin.right, Math.floor(MAX_RIGHT_SHARE * width)),
    );
    if (growOnly) {
      left = Math.max(left, margin.left);
      right = Math.max(right, margin.right);
    }
    if (left === margin.left && right === margin.right) return false;
    margin = { ...margin, left, right };
    layoutCanvas();
    void resizeView(scatterplot, innerW(), innerH());
    return true;
  }

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = `${margin.left}px`;
    canvas.style.top = `${margin.top}px`;
    canvas.style.width = `${innerW()}px`;
    canvas.style.height = `${innerH()}px`;
    canvas.width = Math.round(innerW() * ratio);
    canvas.height = Math.round(innerH() * ratio);
    for (const layer of [under, svg]) {
      layer.setAttribute("width", String(width));
      layer.setAttribute("height", String(height));
    }
    placeReset();
    areaMoved();
  }

  /** Put the reset button in the top right corner of the plot area. */
  function placeReset() {
    resetButton.place(
      { left: margin.left, top: margin.top, width: innerW(), height: innerH() },
      theme,
    );
  }

  // Every change asks the loop for a render. Renders run one at a time and
  // read the current state when they start. `fit` frames all the data again:
  // new data and a settled resize ask for it. Options only recolor and
  // relabel, so they redraw at the current pan/zoom.
  function applyData(fit = true) {
    loop.request(fit);
  }

  async function render(fit: boolean) {
    fitting = fit;
    try {
      await renderPoints(fit);
    } finally {
      fitting = false;
    }
    // A resize that arrived while this fit ran used the old size for the
    // base ranges. Fit again at the new one, unless the view has moved; a
    // view that moved keeps its place, with a home view for the new size.
    if (
      fit &&
      !destroyed &&
      pts.rows.length > 0 &&
      (innerW() !== fitSize[0] || innerH() !== fitSize[1])
    ) {
      if (isStartView(scatterplot)) applyData(true);
      else areaMoved();
    }
  }

  async function renderPoints(fit: boolean) {
    const cols = data.columns;
    pts =
      cols.x && cols.y
        ? preparePoints(
            cols.x,
            cols.y,
            data.meta?.yInfinite as number[] | undefined,
            -Math.log10(opts.pThreshold),
          )
        : preparePoints([], []);
    if (pts.rows.length === 0) {
      // With nothing to draw, the view goes home and the reset button,
      // which would have nothing to do, hides.
      void scatterplot.clear?.();
      homeView = Float32Array.from(START_VIEW);
      cameraBounds.update();
      if (!isStartView(scatterplot)) void scatterplot.reset();
      atHome = true;
      resetButton.show(false);
      renderOverlay();
      return;
    }
    const fitW = innerW();
    const fitH = innerH();
    const ranges = fitRanges(fitW, fitH);
    if (fit && ranges) {
      [xDomain, yDomain] = ranges;
      [baseX, baseY] = baseDomains(ranges[0], ranges[1], fitW, fitH);
      fitSize = [fitW, fitH];
      cameraHeight = fitH;
      homeView = Float32Array.from(START_VIEW);
      cameraBounds.update();
      atHome = true;
    } else {
      // New options can move the fit, as a new p threshold does: the home
      // view follows them, and the view keeps its place.
      updateHome(false);
    }
    const [xBase, yBase] = [baseX, baseY];

    const yThresh = -Math.log10(opts.pThreshold);
    const n = pts.rows.length;
    const z = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      z[i] = classify(
        pts.x[i] as number,
        pts.y[i] as number,
        opts.fcThreshold,
        yThresh,
      );
    }
    const points = {
      x: toNdc(pts.x, xBase),
      y: toNdc(pts.yDraw, yBase),
      z,
    };
    renderOverlay();
    if (fit) {
      await fitView(scatterplot, xScale, yScale, xBase, yBase);
      if (destroyed) return;
    }
    // Colours go in just before the points they belong to.
    applyColors();
    await scatterplot.draw(points);
  }

  function applyColors() {
    scatterplot.set({
      colorBy: "category",
      // regl-scatterplot reads hex and RGBA arrays only, so each colour is
      // read first, var() and currentColor included.
      pointColor: [opts.colors.down, opts.colors.ns, opts.colors.up].map((c) =>
        scatterColour(c, el),
      ),
      pointSize: opts.pointSize,
      opacity: opts.opacity,
      backgroundColor: scatterBackground(theme, el),
    });
  }

  // ---- overlay rendering (axes, thresholds, labels) ----
  /**
   * Draw the overlay, then give every colour in it that the page cannot
   * read the value "none", as the canvas leaves such marks out (see
   * hideUnreadableColours), so the screen and the exports agree.
   */
  function renderOverlay(...args: Parameters<typeof drawOverlay>) {
    drawOverlay(...args);
    hideUnreadableColours(el, theme, under, svg);
  }

  function drawOverlay() {
    for (const layer of [under, svg]) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    if (!width || !height) return;
    // Margins widened for long tick labels apply to the plot area at once.
    // Its view follows on the next frame, and draws the overlay again.
    settling = fitTickMargins(settling);

    const axisColor = theme.axis;
    const gridColor = theme.grid;

    // Baseline offset that centres a tick label on its tick.
    const mid = Math.round(sizes.label * 0.35);
    const { x: xAxis, y: yAxis } = axisTicks();
    // Gridlines go in the SVG under the canvas, so no line crosses a point.
    // A label that would still leave the plot box, past a margin at its
    // largest share, is left out; its gridline stays.
    // x ticks
    xAxis.ticks.forEach((t, i) => {
      const x = pxX(t);
      // A view zoomed past the precision of its numbers has no width, and
      // its one tick no place on the axis.
      if (
        !Number.isFinite(x) ||
        x < margin.left - 1 ||
        x > width - margin.right + 1
      ) {
        return;
      }
      under.appendChild(
        line(x, margin.top, x, height - margin.bottom, gridColor, 1),
      );
      const label = xAxis.labels[i] ?? "";
      const half = labelWidth(label) / 2;
      if (x - half < 0 || x + half > width) return;
      svg.appendChild(
        text(
          x,
          height - margin.bottom + 5 + sizes.label,
          label,
          axisColor,
          "middle",
        ),
      );
    });
    // y ticks
    yAxis.ticks.forEach((t, i) => {
      const y = pxY(t);
      if (
        !Number.isFinite(y) ||
        y < margin.top - 1 ||
        y > height - margin.bottom + 1
      ) {
        return;
      }
      under.appendChild(
        line(margin.left, y, width - margin.right, y, gridColor, 1),
      );
      const label = yAxis.labels[i] ?? "";
      if (margin.left - 8 - labelWidth(label) < 0) return;
      svg.appendChild(text(margin.left - 8, y + mid, label, axisColor, "end"));
    });

    // axis frame
    svg.appendChild(
      line(
        margin.left,
        height - margin.bottom,
        width - margin.right,
        height - margin.bottom,
        axisColor,
        1.5,
      ),
    );
    svg.appendChild(
      line(
        margin.left,
        margin.top,
        margin.left,
        height - margin.bottom,
        axisColor,
        1.5,
      ),
    );

    // axis titles
    svg.appendChild(
      text(
        margin.left + innerW() / 2,
        height - Math.round(sizes.axisTitle * 0.6),
        opts.xLabel,
        theme.foreground,
        "middle",
        sizes.axisTitle,
      ),
    );
    // The y title's baseline, one title size in from the left edge. When
    // the left margin at its largest share is still too narrow for it and
    // the tick labels, the title is left out, so no label runs under it.
    const titleX = yTitleX();
    if (leftFor(yAxis.labels) <= margin.left) {
      const yTitle = text(
        titleX,
        margin.top + innerH() / 2,
        opts.yLabel,
        theme.foreground,
        "middle",
        sizes.axisTitle,
      );
      yTitle.setAttribute(
        "transform",
        `rotate(-90 ${titleX} ${margin.top + innerH() / 2})`,
      );
      svg.appendChild(yTitle);
    }

    if (opts.showThresholdLines) renderThresholds();
    renderLabels();
  }

  function renderThresholds() {
    const yThresh = -Math.log10(opts.pThreshold);
    const yp = pxY(yThresh);
    if (yp > margin.top && yp < height - margin.bottom) {
      svg.appendChild(
        dashed(margin.left, yp, width - margin.right, yp, theme.muted),
      );
    }
    for (const fx of [-opts.fcThreshold, opts.fcThreshold]) {
      const xp = pxX(fx);
      if (xp > margin.left && xp < width - margin.right) {
        svg.appendChild(
          dashed(xp, margin.top, xp, height - margin.bottom, theme.muted),
        );
      }
    }
  }

  function renderLabels() {
    const cols = data.columns;
    if (!opts.labelTopN || !cols.label || pts.rows.length === 0) return;
    const yThresh = -Math.log10(opts.pThreshold);
    const up: number[] = [];
    const down: number[] = [];
    for (let i = 0; i < pts.rows.length; i += 1) {
      // A gene with no label (NA from R) takes no label slot or space.
      if (!str(cols.label, pts.rows[i] as number)) continue;
      const c = classify(
        pts.x[i] as number,
        pts.y[i] as number,
        opts.fcThreshold,
        yThresh,
      );
      if (c === 2) up.push(i);
      else if (c === 0) down.push(i);
    }
    // Most significant first; p = 0 (Infinity) sorts to the front.
    const byY = (a: number, b: number) => {
      const ya = pts.y[a] as number;
      const yb = pts.y[b] as number;
      return ya === yb ? 0 : ya < yb ? 1 : -1;
    };
    const chosen = [
      ...up.sort(byY).slice(0, opts.labelTopN),
      ...down.sort(byY).slice(0, opts.labelTopN),
    ];
    const bounds = {
      left: margin.left,
      right: width - margin.right,
      top: margin.top,
      bottom: height - margin.bottom,
    };
    const items: {
      i: number;
      x: number;
      y: number;
      width: number;
      label: string;
    }[] = [];
    for (const i of chosen) {
      const x = pxX(pts.x[i] as number);
      const y = pxY(pts.yDraw[i] as number);
      // Points outside the current view keep no label.
      if (!Number.isFinite(x) || x < bounds.left || x > bounds.right) continue;
      if (!Number.isFinite(y) || y < bounds.top || y > bounds.bottom) continue;
      const label = str(cols.label, pts.rows[i] as number) ?? "";
      items.push({
        i,
        x,
        y,
        width: textWidth(label, sizes.label, theme.fontFamily),
        label,
      });
    }
    // No label goes under the reset button.
    const button = resetButton.box;
    const taken = button
      ? [
          {
            left: button.left,
            right: button.left + button.width,
            top: button.top,
            bottom: button.top + button.height,
          },
        ]
      : [];
    const spots = placeLabels(items, bounds, sizes.label, taken);
    items.forEach((it, k) => {
      const spot = spots[k];
      if (!spot) return;
      const t = text(
        spot.x,
        spot.y,
        it.label,
        theme.foreground,
        spot.anchor,
        sizes.label,
      );
      // Widths are measured at normal weight; a bold page must not widen
      // the drawn text past its measured box.
      t.setAttribute("font-weight", "normal");
      t.setAttribute("letter-spacing", "normal");
      svg.appendChild(t);
    });
  }

  // ---- SVG element helpers ----
  function line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    w: number,
  ) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", String(w));
    return l;
  }
  function dashed(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
  ) {
    const l = line(x1, y1, x2, y2, stroke, 1);
    l.setAttribute("stroke-dasharray", "4 3");
    return l;
  }
  function text(
    x: number,
    y: number,
    content: string,
    fill: string,
    anchor: string,
    size = sizes.label,
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

  function doResize(w: number, h: number) {
    outerW = w;
    outerH = h;
    ({ width, height } = plot.fit(w, h, theme));
    layoutCanvas();
    void resizeView(scatterplot, innerW(), innerH());
    renderOverlay();
  }

  // Initial sizing from the container (or sensible defaults when detached).
  {
    cameraBounds.update();
    const m = measure(el);
    doResize(m.width, m.height);
    if (data.columns.x) applyData();
  }

  const instance: VolcanoInstance = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      const prevOpts = opts;
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      const prev = margin;
      const prevBase = baseMargin;
      const [prevW, prevH] = [width, height];
      sizes = textSizes(theme);
      baseMargin = axisMargins(sizes);
      // New text sizes start the margins again from their own; the overlay
      // widens them as its tick labels need.
      if (!sameSides(baseMargin, prevBase)) margin = baseMargin;
      ({ width, height } = plot.fit(outerW, outerH, theme));
      // The reset button takes the colours and size of the new theme.
      placeReset();
      if ((opts.boundedView !== false) !== (prevOpts.boundedView !== false)) {
        cameraBounds.update();
      }
      if (!sameSides(margin, prev) || width !== prevW || height !== prevH) {
        // A new text size or padding changes the plot area, which refits
        // at home as a resize does. Away from home the view keeps its place
        // and the home view follows the new area.
        doResize(outerW, outerH);
        applyData(atHome);
        return;
      }
      // A new p threshold moves its line and the p = 0 genes above it, and
      // the line, shown or hidden, joins or leaves the y range, so the plot
      // fits again. No other option changes the data range, so the current
      // pan/zoom stays.
      // A new point size changes the room kept for the points at the
      // edges, so it fits again too. Away from home the view keeps its
      // place, and the home view follows the new fit, so a zoom out
      // reaches it.
      const refit =
        opts.pThreshold !== prevOpts.pThreshold ||
        opts.showThresholdLines !== prevOpts.showThresholdLines ||
        opts.pointSize !== prevOpts.pointSize;
      applyData(refit && atHome);
    },
    resize(w, h) {
      if (w === outerW && h === outerH) return;
      doResize(w, h);
      refitAfterResize();
    },
    resetView() {
      resetView();
    },
    exportSVG() {
      // Hybrid figure: rasterized GPU layer + vector axes/labels.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", String(margin.left));
      img.setAttribute("y", String(margin.top));
      img.setAttribute("width", String(innerW()));
      img.setAttribute("height", String(innerH()));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      // The gridlines go under the points, as on screen.
      for (const node of Array.from(under.childNodes).reverse()) {
        out.insertBefore(node.cloneNode(true), out.firstChild);
      }
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
    },
    async exportPNG(scale = 2) {
      // The points at their place, over the gridlines and under the axes
      // and labels.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        element: el,
        layers: [
          {
            canvas,
            x: margin.left,
            y: margin.top,
            width: innerW(),
            height: innerH(),
          },
        ],
        underlay: under,
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      destroyed = true;
      loop.stop();
      refitAfterResize.cancel();
      el.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("dblclick", onDblClick);
      tooltip.destroy();
      scatterplot.destroy();
      plot.remove();
    },
  };

  return guardDestroy(instance);
};

// ---- small utilities ----
function escapeHTML(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
function str(col: Column | undefined, i: number): string | undefined {
  if (!col) return undefined;
  const v = (col as unknown[])[i];
  return v == null ? undefined : String(v);
}
function mergeOptions(
  base: VolcanoOptions,
  next?: Partial<VolcanoOptions>,
): VolcanoOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    colors: { ...base.colors, ...(next.colors ?? {}) },
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
