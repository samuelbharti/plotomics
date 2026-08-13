/**
 * Volcano plot — differential-expression scatter of effect size vs. significance.
 *
 * Renders points on the GPU via regl-scatterplot (handles millions of genes /
 * features at 60fps) while drawing crisp vector axes, threshold guides and gene
 * labels on an SVG overlay that stays in sync with pan/zoom. This file is the
 * reference implementation for the whole component library — new components
 * should mirror its structure (pure helpers + a factory returning a
 * PlotomicsInstance).
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type Column,
  resolveTheme,
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
} from "@plotomics/core";
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

const MARGIN = { top: 16, right: 18, bottom: 46, left: 60 };
const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/volcano.test.ts)
// ---------------------------------------------------------------------------

/** Min/max of a numeric column with symmetric padding (fraction of range). */
export function paddedExtent(col: Column, pad = 0.04): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const n = col.length;
  for (let i = 0; i < n; i += 1) {
    const v = (col as ArrayLike<number>)[i] as number;
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

/** Classify a point given its log2FC (x), -log10p (y) and cutoffs. */
export function classify(
  x: number,
  y: number,
  fcThreshold: number,
  yThreshold: number,
): Category {
  if (y < yThreshold) return 1;
  if (x >= fcThreshold) return 2;
  if (x <= -fcThreshold) return 0;
  return 1;
}

/** Nice axis tick values for a domain. */
export function niceTicks(domain: [number, number], count = 6): number[] {
  return d3ticks(domain[0], domain[1], count);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createVolcano: PlotomicsFactory<VolcanoOptions> = (el, initial) => {
  let opts: VolcanoOptions = mergeOptions(defaultVolcanoOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  // Layout state
  let width = 0;
  let height = 0;
  let xDomain: [number, number] = [-1, 1];
  let yDomain: [number, number] = [0, 1];

  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);

  // DOM: a canvas (GPU points) inset by margins, plus a full-size SVG overlay.
  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // GPU scatter. Passing d3 scales makes draw() accept *data* coordinates and
  // keeps domains in sync with pan/zoom.
  const scatterplot = createScatterplot({
    canvas,
    xScale,
    yScale,
    pointSize: opts.pointSize,
    opacity: opts.opacity,
    backgroundColor: theme.background,
    lassoInitiator: false,
  });

  scatterplot.subscribe("pointOver", (i: number) => showTip(i));
  scatterplot.subscribe("pointOut", () => tooltip.hide());
  scatterplot.subscribe("view", () => {
    // Domains were mutated in place by the scatterplot; redraw the overlay.
    xDomain = xScale.domain() as [number, number];
    yDomain = yScale.domain() as [number, number];
    renderOverlay();
  });

  function showTip(i: number) {
    const cols = data.columns;
    const x = num(cols.x, i);
    const y = num(cols.y, i);
    const label = str(cols.label, i) ?? `#${i}`;
    tooltip.show(
      `<b>${label}</b><br/>log2FC: ${x.toFixed(2)}<br/>-log10p: ${y.toFixed(2)}`,
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
  const innerW = () => Math.max(1, width - MARGIN.left - MARGIN.right);
  const innerH = () => Math.max(1, height - MARGIN.top - MARGIN.bottom);
  const pxX = (v: number) =>
    MARGIN.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW();
  const pxY = (v: number) =>
    MARGIN.top + (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH();

  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.left = `${MARGIN.left}px`;
    canvas.style.top = `${MARGIN.top}px`;
    canvas.style.width = `${innerW()}px`;
    canvas.style.height = `${innerH()}px`;
    canvas.width = Math.round(innerW() * ratio);
    canvas.height = Math.round(innerH() * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  function applyData() {
    const cols = data.columns;
    if (!cols.x || !cols.y || cols.x.length === 0) {
      scatterplot.clear?.();
      renderOverlay();
      return;
    }
    xDomain = symmetricExtent(cols.x);
    yDomain = paddedExtent(cols.y);
    yDomain[0] = Math.min(0, yDomain[0]);
    xScale.domain(xDomain);
    yScale.domain(yDomain);

    const yThresh = -Math.log10(opts.pThreshold);
    const n = cols.x.length;
    const z = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      z[i] = classify(num(cols.x, i), num(cols.y, i), opts.fcThreshold, yThresh);
    }
    applyColors();
    scatterplot.draw({
      x: cols.x as ArrayLike<number>,
      y: cols.y as ArrayLike<number>,
      z,
    });
    renderOverlay();
  }

  function applyColors() {
    scatterplot.set({
      colorBy: "category",
      pointColor: [opts.colors.down, opts.colors.ns, opts.colors.up],
      pointSize: opts.pointSize,
      opacity: opts.opacity,
    });
  }

  // ---- overlay rendering (axes, thresholds, labels) ----
  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;

    const axisColor = theme.axis;
    const gridColor = theme.grid;

    // x ticks
    for (const t of niceTicks(xDomain)) {
      const x = pxX(t);
      if (x < MARGIN.left - 1 || x > width - MARGIN.right + 1) continue;
      svg.appendChild(line(x, MARGIN.top, x, height - MARGIN.bottom, gridColor, 1));
      svg.appendChild(
        text(x, height - MARGIN.bottom + 16, fmt(t), axisColor, "middle"),
      );
    }
    // y ticks
    for (const t of niceTicks(yDomain)) {
      const y = pxY(t);
      if (y < MARGIN.top - 1 || y > height - MARGIN.bottom + 1) continue;
      svg.appendChild(line(MARGIN.left, y, width - MARGIN.right, y, gridColor, 1));
      svg.appendChild(text(MARGIN.left - 8, y + 4, fmt(t), axisColor, "end"));
    }

    // axis frame
    svg.appendChild(
      line(MARGIN.left, height - MARGIN.bottom, width - MARGIN.right, height - MARGIN.bottom, axisColor, 1.5),
    );
    svg.appendChild(line(MARGIN.left, MARGIN.top, MARGIN.left, height - MARGIN.bottom, axisColor, 1.5));

    // axis titles
    svg.appendChild(
      text(MARGIN.left + innerW() / 2, height - 8, opts.xLabel, theme.foreground, "middle", 13),
    );
    const yTitle = text(16, MARGIN.top + innerH() / 2, opts.yLabel, theme.foreground, "middle", 13);
    yTitle.setAttribute("transform", `rotate(-90 16 ${MARGIN.top + innerH() / 2})`);
    svg.appendChild(yTitle);

    if (opts.showThresholdLines) renderThresholds();
    renderLabels();
  }

  function renderThresholds() {
    const yThresh = -Math.log10(opts.pThreshold);
    const yp = pxY(yThresh);
    if (yp > MARGIN.top && yp < height - MARGIN.bottom) {
      svg.appendChild(dashed(MARGIN.left, yp, width - MARGIN.right, yp, theme.muted));
    }
    for (const fx of [-opts.fcThreshold, opts.fcThreshold]) {
      const xp = pxX(fx);
      if (xp > MARGIN.left && xp < width - MARGIN.right) {
        svg.appendChild(dashed(xp, MARGIN.top, xp, height - MARGIN.bottom, theme.muted));
      }
    }
  }

  function renderLabels() {
    const cols = data.columns;
    if (!opts.labelTopN || !cols.label || !cols.x) return;
    const yThresh = -Math.log10(opts.pThreshold);
    const n = cols.x.length;
    const up: number[] = [];
    const down: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const c = classify(num(cols.x, i), num(cols.y, i), opts.fcThreshold, yThresh);
      if (c === 2) up.push(i);
      else if (c === 0) down.push(i);
    }
    const byY = (a: number, b: number) => num(cols.y, b) - num(cols.y, a);
    const chosen = [
      ...up.sort(byY).slice(0, opts.labelTopN),
      ...down.sort(byY).slice(0, opts.labelTopN),
    ];
    for (const i of chosen) {
      const x = pxX(num(cols.x, i));
      const y = pxY(num(cols.y, i));
      if (x < MARGIN.left || x > width - MARGIN.right) continue;
      if (y < MARGIN.top || y > height - MARGIN.bottom) continue;
      svg.appendChild(text(x + 4, y - 4, str(cols.label, i) ?? "", theme.foreground, "start", 11));
    }
  }

  // ---- SVG element helpers ----
  function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", String(w));
    return l;
  }
  function dashed(x1: number, y1: number, x2: number, y2: number, stroke: string) {
    const l = line(x1, y1, x2, y2, stroke, 1);
    l.setAttribute("stroke-dasharray", "4 3");
    return l;
  }
  function text(x: number, y: number, content: string, fill: string, anchor: string, size = 11) {
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
    scatterplot.set({ width: innerW(), height: innerH() });
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
      applyData();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Hybrid figure: rasterized GPU layer + vector axes/labels.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", String(MARGIN.left));
      img.setAttribute("y", String(MARGIN.top));
      img.setAttribute("width", String(innerW()));
      img.setAttribute("height", String(innerH()));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      tooltip.destroy();
      scatterplot.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
function num(col: Column | undefined, i: number): number {
  return col ? ((col as ArrayLike<number>)[i] as number) : 0;
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
function mergeOptions(base: VolcanoOptions, next?: Partial<VolcanoOptions>): VolcanoOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    colors: { ...base.colors, ...(next.colors ?? {}) },
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
