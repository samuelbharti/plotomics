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
  type Tooltip,
  measure,
  releaseContainer,
  textWidth,
  dpr,
  serializeSVG,
  compositePNG,
  toNdc,
  baseDomains,
  fitView,
  resizeView,
  isStartView,
  createRenderLoop,
  afterQuiet,
} from "../core/index.js";
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
  showThresholdLines: boolean;
  /** Label the N most significant up- and down-regulated genes. */
  labelTopN: number;
  theme: Partial<PlotomicsTheme>;
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
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Margins around the plot area. They hold the tick labels and the axis
 * titles, so they grow with the text: 16, 18, 46 and 60 px at the default
 * sizes of 11 px ticks and 13 px titles. The left margin fits the y title
 * and tick labels of about five characters.
 */
function axisMargins(sizes: TextSizes): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: Math.round(sizes.label + 5),
    right: Math.round(sizes.label + 7),
    bottom: Math.round(sizes.label + sizes.axisTitle + 22),
    left: Math.round(sizes.axisTitle + 4.3 * sizes.label),
  };
}

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

/**
 * Read the x and y columns into the points that can be drawn. A row with a
 * missing x or y (null, which is how R's JSON sends NA, or NaN) is left out.
 * A y of +Infinity (p = 0, common in differential-expression tables) is kept:
 * it is classified as significant and drawn just above the highest finite y.
 * `infiniteRows` lists rows whose y is +Infinity even though the column holds
 * null there; R uses it, because JSON has no Infinity.
 */
export function preparePoints(
  xCol: Column,
  yCol: Column,
  infiniteRows?: ArrayLike<number>,
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
  // 5% of the drawn y range above the highest finite y. The axis starts at
  // 0, so the range is measured from 0, which keeps p = 0 clear of the top
  // finite point when the finite values sit in a narrow band.
  const span = hi - Math.min(0, lo);
  const top = Number.isFinite(hi) ? hi + 0.05 * (span || 1) : 1;
  return {
    rows: Int32Array.from(rows),
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    yDraw: Float64Array.from(ys, (y) => (y === Infinity ? top : y)),
  };
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
 * that stays inside `bounds` and clears every label placed before it; a label
 * with no free corner is left out. Labels are placed in the order given, so
 * pass the most important first.
 */
export function placeLabels(
  items: { x: number; y: number; width: number }[],
  bounds: LabelBox,
  fontSize: number,
): ({ x: number; y: number; anchor: "start" | "end" } | null)[] {
  const placed: LabelBox[] = [];
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

export const createVolcano: PlotomicsFactory<VolcanoOptions> = (
  el,
  initial,
) => {
  let opts: VolcanoOptions = mergeOptions(
    defaultVolcanoOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  // Text sizes and the margins that hold the axis text, from the theme.
  let sizes = textSizes(theme);
  let margin = axisMargins(sizes);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  // Layout state
  let width = 0;
  let height = 0;
  // The visible range, which follows pan/zoom and drives the axes.
  let xDomain: [number, number] = [-1, 1];
  let yDomain: [number, number] = [0, 1];
  // The range that [-1, 1] stands for, fixed at the last fit. A redraw at
  // the current zoom converts the points with this one.
  let baseX: [number, number] = [-1, 1];
  let baseY: [number, number] = [0, 1];

  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);

  // DOM: a canvas (GPU points) inset by margins, between two full-size SVGs.
  // The one under it holds the gridlines, which show through the canvas
  // because regl-scatterplot leaves it transparent where there is no point.
  // The one over it holds the axes, the threshold lines and the labels.
  el.style.position = el.style.position || "relative";
  // regl-scatterplot leaves the canvas transparent, so the theme background is
  // painted on the element: the plot panel and the axis margins alike.
  // destroy() puts back what the element had.
  const priorBackground = el.style.backgroundColor;
  el.style.backgroundColor = theme.background;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;";
  const under = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  for (const layer of [under, svg]) {
    layer.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  }
  el.appendChild(under);
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // GPU scatter. It draws points in [-1, 1], and keeps the d3 scales in sync
  // with pan/zoom once fitView() has handed them over. See core/scatter.ts.
  const scatterplot = createScatterplot({
    canvas,
    xScale,
    yScale,
    pointSize: opts.pointSize,
    opacity: opts.opacity,
    backgroundColor: theme.background,
    lassoInitiator: false,
  });
  const loop = createRenderLoop((fit) => render(fit));
  let destroyed = false;
  // Until the person pans or zooms, the plot keeps showing all the data, so
  // it fits again once a resize has settled. After that it keeps their view.
  const refitAfterResize = afterQuiet(() => {
    if (data.columns.x && isStartView(scatterplot)) applyData();
  }, 120);

  scatterplot.subscribe("pointOver", (i: number) => showTip(i));
  scatterplot.subscribe("pointOut", () => tooltip.hide());
  scatterplot.subscribe("view", () => {
    // Domains were mutated in place by the scatterplot; redraw the overlay.
    xDomain = xScale.domain() as [number, number];
    yDomain = yScale.domain() as [number, number];
    renderOverlay();
  });

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
  const onMove = (e: MouseEvent) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  };
  el.addEventListener("mousemove", onMove);

  // ---- pixel mapping (overlay) ----
  const innerW = () => Math.max(1, width - margin.left - margin.right);
  const innerH = () => Math.max(1, height - margin.top - margin.bottom);
  const pxX = (v: number) =>
    margin.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW();
  const pxY = (v: number) =>
    margin.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH();

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
  }

  // Every change asks the loop for a render. Renders run one at a time and
  // read the current state when they start. `fit` frames all the data again:
  // new data and a settled resize ask for it. Options only recolor and
  // relabel, so they redraw at the current pan/zoom.
  function applyData(fit = true) {
    loop.request(fit);
  }

  async function render(fit: boolean) {
    const cols = data.columns;
    pts =
      cols.x && cols.y
        ? preparePoints(
            cols.x,
            cols.y,
            data.meta?.yInfinite as number[] | undefined,
          )
        : preparePoints([], []);
    if (pts.rows.length === 0) {
      void scatterplot.clear?.();
      renderOverlay();
      return;
    }
    const fitW = innerW();
    const fitH = innerH();
    if (fit) {
      xDomain = symmetricExtent(pts.x);
      yDomain = paddedExtent(pts.yDraw);
      yDomain[0] = Math.min(0, yDomain[0]);
      [baseX, baseY] = baseDomains(xDomain, yDomain, fitW, fitH);
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
    // A resize that arrived while this fit ran used the old size for the
    // base ranges. Fit again at the new one, unless the view has moved.
    if (
      fit &&
      !destroyed &&
      (innerW() !== fitW || innerH() !== fitH) &&
      isStartView(scatterplot)
    ) {
      applyData(true);
    }
  }

  function applyColors() {
    scatterplot.set({
      colorBy: "category",
      pointColor: [opts.colors.down, opts.colors.ns, opts.colors.up],
      pointSize: opts.pointSize,
      opacity: opts.opacity,
      backgroundColor: theme.background,
    });
  }

  // ---- overlay rendering (axes, thresholds, labels) ----
  function renderOverlay() {
    for (const layer of [under, svg]) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    if (!width || !height) return;

    const axisColor = theme.axis;
    const gridColor = theme.grid;

    // Baseline offset that centres a tick label on its tick.
    const mid = Math.round(sizes.label * 0.35);
    // Gridlines go in the SVG under the canvas, so no line crosses a point.
    // x ticks
    for (const t of niceTicks(xDomain)) {
      const x = pxX(t);
      if (x < margin.left - 1 || x > width - margin.right + 1) continue;
      under.appendChild(
        line(x, margin.top, x, height - margin.bottom, gridColor, 1),
      );
      svg.appendChild(
        text(
          x,
          height - margin.bottom + 5 + sizes.label,
          fmt(t),
          axisColor,
          "middle",
        ),
      );
    }
    // y ticks
    for (const t of niceTicks(yDomain)) {
      const y = pxY(t);
      if (y < margin.top - 1 || y > height - margin.bottom + 1) continue;
      under.appendChild(
        line(margin.left, y, width - margin.right, y, gridColor, 1),
      );
      svg.appendChild(text(margin.left - 8, y + mid, fmt(t), axisColor, "end"));
    }

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
    // The y title's baseline, one title size in from the left edge.
    const titleX = Math.round(3 + sizes.axisTitle);
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
      if (x < bounds.left || x > bounds.right) continue;
      if (y < bounds.top || y > bounds.bottom) continue;
      const label = str(cols.label, pts.rows[i] as number) ?? "";
      items.push({
        i,
        x,
        y,
        width: textWidth(label, sizes.label, theme.fontFamily),
        label,
      });
    }
    const spots = placeLabels(items, bounds, sizes.label);
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
    width = w;
    height = h;
    layoutCanvas();
    void resizeView(scatterplot, innerW(), innerH());
    renderOverlay();
  }

  // Initial sizing from the container (or sensible defaults when detached).
  {
    const m = measure(el);
    doResize(m.width, m.height);
    if (data.columns.x) applyData();
  }

  const instance: PlotomicsInstance<VolcanoOptions> = {
    setData(next) {
      data = next;
      applyData();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      el.style.backgroundColor = theme.background;
      const prev = margin;
      sizes = textSizes(theme);
      margin = axisMargins(sizes);
      if (
        margin.top !== prev.top ||
        margin.right !== prev.right ||
        margin.bottom !== prev.bottom ||
        margin.left !== prev.left
      ) {
        // A new text size changes the plot area, which refits while the
        // view is untouched, as a resize does.
        doResize(width, height);
        applyData(isStartView(scatterplot));
        return;
      }
      // No other option changes the data range, so the current pan/zoom
      // stays.
      applyData(false);
    },
    resize(w, h) {
      if (w === width && h === height) return;
      doResize(w, h);
      refitAfterResize();
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
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      // The points at their place, over the gridlines and under the axes
      // and labels.
      return compositePNG({
        width,
        height,
        scale,
        background: theme.background,
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
      tooltip.destroy();
      scatterplot.destroy();
      under.remove();
      canvas.remove();
      svg.remove();
      el.style.backgroundColor = priorBackground;
    },
  };

  return instance;
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
function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
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
