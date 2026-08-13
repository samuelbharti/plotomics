/**
 * KM — a Kaplan-Meier survival plot with a number-at-risk table.
 *
 * The convention this follows is not negotiable in clinical work: a right-
 * continuous step function per stratum, censoring marked with ticks, and a
 * number-at-risk table under the axis aligned to the same time grid. A survival
 * curve without the risk table hides how much of the tail rests on a handful of
 * patients, which is exactly where readers over-interpret it.
 *
 * The component draws, it does not estimate. Survival probabilities, confidence
 * bands, censoring times, at-risk counts and the log-rank p all arrive computed.
 * That is deliberate: estimation belongs where the data is, and a host that also
 * renders the same figure server-side (R's `survival` package, say) must be able
 * to hand both renderers one set of numbers so the two cannot disagree about
 * where a curve steps.
 *
 * Curves and the confidence band are canvas-drawn; axes, the risk table and the
 * legend are an SVG overlay.
 *
 * ## Data contract
 * - `columns.time`   `number[]`  step time (required, ascending within a group)
 * - `columns.surv`   `number[]`  survival probability in [0, 1] (required)
 * - `columns.lower`  `number[]`  lower confidence limit; omit to skip the band
 * - `columns.upper`  `number[]`  upper confidence limit
 * - `columns.group`  `string[]`  stratum per point; omit for a single curve
 * - `meta.groups`       `string[]`  stratum order; defaults to order of appearance
 * - `meta.groupColors`  `string[]`  one colour per stratum
 * - `meta.censorTime`   `number[]`  censoring tick times
 * - `meta.censorSurv`   `number[]`  survival value at each tick
 * - `meta.censorGroup`  `string[]`  stratum per tick
 * - `meta.riskTimes`    `number[]`  time grid for the at-risk table
 * - `meta.riskCounts`   `number[]`  groups x riskTimes, row-major
 * - `meta.pLabel`       `string`    e.g. "log-rank p = 0.02", drawn in the corner
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
  OKABE_ITO,
} from "../core/index.js";

export interface KmOptions {
  /** Shade the pointwise confidence band when `lower`/`upper` are present. */
  showCI: boolean;
  /** Mark censoring times with a tick on the curve. */
  showCensors: boolean;
  /** Draw the number-at-risk table beneath the axis. */
  showRiskTable: boolean;
  /** Draw the stratum legend. */
  showLegend: boolean;
  /** Start the y axis at zero (the honest default) rather than at the lowest
   * point of the lowest curve. Zooming y exaggerates separation, so this is
   * opt-out rather than automatic. */
  yFromZero: boolean;
  /** Curve stroke width in pixels. */
  lineWidth: number;
  xLabel: string;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultKmOptions: KmOptions = {
  showCI: true,
  showCensors: true,
  showRiskTable: true,
  showLegend: true,
  yFromZero: true,
  lineWidth: 2,
  xLabel: "months",
  yLabel: "overall survival",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Height of one row in the at-risk table. */
const RISK_ROW_H = 16;
/** Gap between the axis and the top of the risk table. */
const RISK_GAP = 34;
/** Length of a censoring tick, in pixels either side of the curve. */
const CENSOR_TICK = 4;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/km.test.ts)
// ---------------------------------------------------------------------------

export interface KmLayout {
  left: number;
  right: number;
  top: number;
  /** y of the time axis. */
  axisY: number;
  /** Height of the curve panel. */
  plotH: number;
  /** y of the first risk-table row's baseline. */
  riskTop: number;
  riskRowH: number;
}

/**
 * Frame the curve panel, leaving room under the axis for one risk-table row per
 * stratum. The panel shrinks to fit the table rather than the table overflowing
 * the element, so a five-stratum plot in a short container still shows both.
 */
export function layoutKm(
  width: number,
  height: number,
  nGroups: number,
  opts: Pick<KmOptions, "showRiskTable">,
): KmLayout {
  const left = 58;
  const right = 16;
  const top = 14;
  const showTable = opts.showRiskTable && nGroups > 0;
  // Room for the axis labels alone when there is no table.
  const riskH = showTable ? RISK_GAP + nGroups * RISK_ROW_H : 30;
  // Never let the table starve the curves: the panel keeps at least half the
  // element, and if that leaves the table short its rows tighten rather than
  // running off the bottom.
  const axisY = Math.max(top + 40, height * 0.5, height - riskH);
  const avail = height - axisY - RISK_GAP;
  const riskRowH = showTable
    ? Math.min(RISK_ROW_H, Math.max(8, avail / nGroups))
    : RISK_ROW_H;
  return {
    left,
    right,
    top,
    axisY,
    plotH: Math.max(1, axisY - top),
    riskTop: axisY + RISK_GAP,
    riskRowH,
  };
}

/**
 * Expand Kaplan-Meier points into the vertices of a right-continuous step.
 *
 * Between two estimates the survival probability holds flat and then drops at
 * the event time, so drawing a straight line between points would claim a
 * gradual decline that the estimator never asserts. Returns a flat
 * `[x0, y0, x1, y0, x1, y1, ...]` polyline.
 */
export function stepPoints(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
): number[] {
  const n = Math.min(times.length, values.length);
  if (n === 0) return [];
  const out: number[] = [times[0] as number, values[0] as number];
  for (let i = 1; i < n; i += 1) {
    const t = times[i] as number;
    const v = values[i] as number;
    out.push(t, values[i - 1] as number);
    out.push(t, v);
  }
  return out;
}

/**
 * Indices at which each group's points start and end, assuming a group's points
 * are contiguous. Returns them in `groups` order, skipping absent groups.
 */
export function groupSlices(
  groupCol: ArrayLike<string>,
  groups: readonly string[],
): { group: string; start: number; end: number }[] {
  const out: { group: string; start: number; end: number }[] = [];
  for (const g of groups) {
    let start = -1;
    let end = -1;
    for (let i = 0; i < groupCol.length; i += 1) {
      if (groupCol[i] !== g) continue;
      if (start < 0) start = i;
      end = i;
    }
    if (start >= 0) out.push({ group: g, start, end });
  }
  return out;
}

/** Round `max` up to a readable axis bound and produce evenly spaced ticks. */
export function timeTicks(max: number, target = 6): number[] {
  if (!isFinite(max) || max <= 0) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) out.push(Number(t.toFixed(6)));
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createKm: PlotomicsFactory<KmOptions> = (el, initial) => {
  let opts: KmOptions = mergeOptions(defaultKmOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutKm(0, 0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const times = () => (data.columns.time as ArrayLike<number>) ?? [];
  const survs = () => (data.columns.surv as ArrayLike<number>) ?? [];
  const lowers = () => data.columns.lower as ArrayLike<number> | undefined;
  const uppers = () => data.columns.upper as ArrayLike<number> | undefined;
  const groupCol = () => (data.columns.group as string[]) ?? [];

  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    if (given && given.length) return given;
    const seen: string[] = [];
    for (const g of groupCol()) if (!seen.includes(g)) seen.push(g);
    return seen.length ? seen : ["all"];
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return groups().map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }
  function slices() {
    const gc = groupCol();
    if (!gc.length) return [{ group: groups()[0] ?? "all", start: 0, end: times().length - 1 }];
    return groupSlices(gc, groups());
  }
  function maxTime(): number {
    const t = times();
    let m = 0;
    for (let i = 0; i < t.length; i += 1) if ((t[i] as number) > m) m = t[i] as number;
    const risk = data.meta?.riskTimes as number[] | undefined;
    if (risk) for (const r of risk) if (r > m) m = r;
    return m > 0 ? m : 1;
  }
  function yMin(): number {
    if (opts.yFromZero) return 0;
    const s = survs();
    let m = 1;
    for (let i = 0; i < s.length; i += 1) if ((s[i] as number) < m) m = s[i] as number;
    return Math.max(0, Math.floor(m * 10) / 10 - 0.05);
  }

  // ---- scales ----
  function sx(t: number, tmax: number): number {
    return layout.left + (t / tmax) * (width - layout.left - layout.right);
  }
  function sy(v: number, lo: number): number {
    return layout.axisY - ((v - lo) / (1 - lo)) * layout.plotH;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (my < layout.top || my > layout.axisY || mx < layout.left || mx > width - layout.right) {
      tooltip.hide();
      return;
    }
    const tmax = maxTime();
    const lo = yMin();
    const t = ((mx - layout.left) / (width - layout.left - layout.right)) * tmax;
    const tArr = times();
    const sArr = survs();
    // Per stratum, the estimate in force at time t is the last step at or
    // before it. That is what the curve is showing at the cursor.
    const rows: string[] = [];
    const cols = groupColors();
    const gl = groups();
    for (const sl of slices()) {
      let idx = -1;
      for (let i = sl.start; i <= sl.end; i += 1) {
        if ((tArr[i] as number) <= t) idx = i;
        else break;
      }
      if (idx < 0) continue;
      const gi = gl.indexOf(sl.group);
      const col = gi >= 0 ? (cols[gi] as string) : theme.foreground;
      rows.push(
        `<span style="color:${col}">&#9632;</span> ${esc(sl.group)} ` +
          `<b>${(100 * (sArr[idx] as number)).toFixed(0)}%</b>`,
      );
    }
    if (!rows.length) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      `<b>${fmtTime(t)} ${esc(opts.xLabel)}</b><br/>${rows.join("<br/>")}`,
      lastPointer.x,
      lastPointer.y,
    );
    void lo;
  }
  function onLeave() {
    tooltip.hide();
  }
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseleave", onLeave);

  // ---- rendering ----
  function layoutCanvas() {
    const ratio = dpr();
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function render() {
    const ctx = canvas.getContext("2d");
    if (!ctx || !width || !height) return;
    const gl = groups();
    layout = layoutKm(width, height, gl.length, opts);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const tArr = times();
    if (!tArr.length) {
      renderOverlay();
      return;
    }
    const tmax = maxTime();
    const lo = yMin();
    const cols = groupColors();
    const lower = lowers();
    const upper = uppers();

    // Confidence bands first, so the curves read on top of them.
    if (opts.showCI && lower && upper) {
      for (const sl of slices()) {
        const gi = gl.indexOf(sl.group);
        const col = gi >= 0 ? (cols[gi] as string) : theme.foreground;
        const n = sl.end - sl.start + 1;
        const t = sliceOf(tArr, sl.start, n);
        const up = stepPoints(t, sliceOf(upper, sl.start, n));
        const dn = stepPoints(t, sliceOf(lower, sl.start, n));
        if (!up.length || !dn.length) continue;
        ctx.beginPath();
        ctx.moveTo(sx(up[0] as number, tmax), sy(up[1] as number, lo));
        for (let i = 2; i < up.length; i += 2) {
          ctx.lineTo(sx(up[i] as number, tmax), sy(up[i + 1] as number, lo));
        }
        for (let i = dn.length - 2; i >= 0; i -= 2) {
          ctx.lineTo(sx(dn[i] as number, tmax), sy(dn[i + 1] as number, lo));
        }
        ctx.closePath();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Curves.
    ctx.lineWidth = opts.lineWidth;
    ctx.lineJoin = "round";
    for (const sl of slices()) {
      const gi = gl.indexOf(sl.group);
      ctx.strokeStyle = gi >= 0 ? (cols[gi] as string) : theme.foreground;
      const n = sl.end - sl.start + 1;
      const pts = stepPoints(sliceOf(tArr, sl.start, n), sliceOf(survs(), sl.start, n));
      if (!pts.length) continue;
      ctx.beginPath();
      ctx.moveTo(sx(pts[0] as number, tmax), sy(pts[1] as number, lo));
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(sx(pts[i] as number, tmax), sy(pts[i + 1] as number, lo));
      }
      ctx.stroke();
    }

    // Censoring ticks.
    const ct = data.meta?.censorTime as number[] | undefined;
    const cs = data.meta?.censorSurv as number[] | undefined;
    const cg = data.meta?.censorGroup as string[] | undefined;
    if (opts.showCensors && ct && cs) {
      ctx.lineWidth = 1;
      for (let i = 0; i < ct.length; i += 1) {
        const gi = cg ? gl.indexOf(cg[i] as string) : 0;
        ctx.strokeStyle = gi >= 0 ? (cols[gi] as string) : theme.foreground;
        const x = sx(ct[i] as number, tmax);
        const y = sy(cs[i] as number, lo);
        ctx.beginPath();
        ctx.moveTo(x, y - CENSOR_TICK);
        ctx.lineTo(x, y + CENSOR_TICK);
        ctx.stroke();
      }
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const gl = groups();
    const cols = groupColors();
    const tmax = maxTime();
    const lo = yMin();

    // y gridlines and ticks, as percentages.
    for (let k = 0; k <= 4; k += 1) {
      const v = lo + (k / 4) * (1 - lo);
      const y = sy(v, lo);
      svg.appendChild(line(layout.left, y, width - layout.right, y, theme.grid));
      svg.appendChild(text(layout.left - 8, y + 3, `${Math.round(v * 100)}%`, theme.muted, "end", 9));
    }
    svg.appendChild(
      rotatedText(14, layout.top + layout.plotH / 2, opts.yLabel, theme.muted, 10),
    );

    // x axis.
    svg.appendChild(line(layout.left, layout.axisY, width - layout.right, layout.axisY, theme.axis));
    const ticks = (data.meta?.riskTimes as number[] | undefined) ?? timeTicks(tmax);
    for (const t of ticks) {
      if (t > tmax) continue;
      const x = sx(t, tmax);
      svg.appendChild(line(x, layout.axisY, x, layout.axisY + 4, theme.axis));
      svg.appendChild(text(x, layout.axisY + 15, fmtTime(t), theme.muted, "middle", 9));
    }
    svg.appendChild(
      text((layout.left + width - layout.right) / 2, layout.axisY + 28, opts.xLabel,
        theme.muted, "middle", 10),
    );

    // Number at risk, one row per stratum on the same time grid as the ticks.
    const counts = data.meta?.riskCounts as number[] | undefined;
    const riskTimes = data.meta?.riskTimes as number[] | undefined;
    if (opts.showRiskTable && counts && riskTimes) {
      svg.appendChild(
        text(layout.left, layout.riskTop - 12, "number at risk", theme.foreground, "start", 10),
      );
      for (let g = 0; g < gl.length; g += 1) {
        const y = layout.riskTop + g * layout.riskRowH;
        svg.appendChild(
          text(layout.left - 8, y + 3, gl[g] ?? "", cols[g] ?? theme.foreground, "end", 9),
        );
        for (let j = 0; j < riskTimes.length; j += 1) {
          const t = riskTimes[j] as number;
          if (t > tmax) continue;
          const n = counts[g * riskTimes.length + j];
          if (n === undefined) continue;
          svg.appendChild(
            text(sx(t, tmax), y + 3, String(n), theme.muted, "middle", 9),
          );
        }
      }
    }

    // Legend, top-right of the panel: survival curves fall left to right, so
    // the top-right corner is the one reliably empty.
    if (opts.showLegend && gl.length > 1) {
      let y = layout.top + 10;
      for (let g = 0; g < gl.length; g += 1) {
        const x = width - layout.right - 10;
        const sw = document.createElementNS(SVG_NS, "rect");
        sw.setAttribute("x", String(x - 8));
        sw.setAttribute("y", String(y - 7));
        sw.setAttribute("width", "8");
        sw.setAttribute("height", "8");
        sw.setAttribute("fill", cols[g] ?? theme.foreground);
        svg.appendChild(sw);
        svg.appendChild(text(x - 12, y, gl[g] ?? "", theme.foreground, "end", 10));
        y += 15;
      }
    }

    // The log-rank result, bottom-left of the panel where the curves have
    // already fallen away.
    const pLabel = data.meta?.pLabel as string | undefined;
    if (pLabel) {
      svg.appendChild(
        text(layout.left + 10, layout.axisY - 10, pLabel, theme.foreground, "start", 11),
      );
    }
  }

  // ---- SVG helpers ----
  function text(x: number, y: number, content: string, fill: string, anchor: string, size = 10) {
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
  function rotatedText(x: number, y: number, content: string, fill: string, size: number) {
    const t = text(x, y, content, fill, "middle", size);
    t.setAttribute("transform", `rotate(-90 ${x} ${y})`);
    return t;
  }
  function line(x1: number, y1: number, x2: number, y2: number, stroke: string) {
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", String(x1));
    l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2));
    l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", stroke);
    l.setAttribute("stroke-width", "1");
    return l;
  }

  function doResize(w: number, h: number) {
    width = w;
    height = h;
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    doResize(m.width, m.height);
  }

  const instance: PlotomicsInstance<KmOptions> = {
    setData(next) {
      data = next;
      render();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      render();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      return canvasToPNG(canvas, scale);
    },
    destroy() {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
/** A window of a column as a plain array, so helpers stay array-agnostic. */
function sliceOf(col: ArrayLike<number>, start: number, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) out[i] = col[start + i] as number;
  return out;
}
function fmtTime(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 1 : 0);
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: KmOptions, next?: Partial<KmOptions>): KmOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
