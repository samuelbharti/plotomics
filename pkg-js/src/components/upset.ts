/**
 * Upset — set intersections as a bar chart over a membership matrix.
 *
 * Venn diagrams stop being readable at four sets and stop being drawable at
 * five. UpSet replaces the areas with an explicit matrix: one column per
 * intersection, a filled dot in every set that intersection belongs to, and a
 * bar above giving its size. That scales to dozens of sets and stays exact.
 *
 * Intersections here are **exclusive**: a column counts the elements in
 * precisely that combination of sets and no others. That is what makes the
 * columns sum to the union rather than double-counting, and it is why an
 * apparently small "A + B" bar next to large "A" and "B" bars is evidence of
 * mutual exclusivity rather than an artefact.
 *
 * Bars and dots are canvas-drawn; labels and axes are an SVG overlay.
 *
 * The component draws the columns in the order given. Which intersections are
 * worth showing, and in what order, is an analysis decision.
 *
 * ## Data contract
 * - `columns.size`  `number[]`  size of each intersection (required)
 * - `meta.sets`        `string[]`  set names, top to bottom (required)
 * - `meta.setSizes`    `number[]`  total size of each set, for the left bars
 * - `meta.membership`  `number[]`  intersections x sets, row-major, 1 = member
 * - `meta.total`       `number`    universe size, shown in the corner
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
} from "../core/index.js";

export interface UpsetOptions {
  /** Fraction of the height given to the intersection bars, in (0, 1). */
  barFraction: number;
  /** Draw the per-set total bars on the left. */
  showSetSizes: boolean;
  /** Radius of a matrix dot in pixels. */
  dotRadius: number;
  /** Fill for the intersection bars and the filled dots. */
  barColor: string | null;
  /** Fill for dots not in the intersection. */
  emptyDotColor: string | null;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultUpsetOptions: UpsetOptions = {
  barFraction: 0.55,
  showSetSizes: true,
  dotRadius: 5,
  barColor: null,
  emptyDotColor: null,
  yLabel: "intersection size",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/upset.test.ts)
// ---------------------------------------------------------------------------

export interface UpsetLayout {
  /** Left edge of the matrix and the bar panel. */
  left: number;
  top: number;
  /** Baseline of the intersection bars, and the top of the matrix. */
  barBaseline: number;
  barH: number;
  /** Height of one matrix row. */
  rowH: number;
  /** Width of one intersection column. */
  colW: number;
  matrixH: number;
  /** Width of the left-hand set-size panel. */
  setPanelW: number;
}

/**
 * Frame the three panels. The left gutter holds set names and, when shown,
 * their total bars; the matrix gets whatever height the bars do not take.
 */
export function layoutUpset(
  width: number,
  height: number,
  nSets: number,
  nIntersections: number,
  opts: Pick<UpsetOptions, "barFraction" | "showSetSizes">,
  longestName = 8,
): UpsetLayout {
  const setPanelW = opts.showSetSizes ? 74 : 0;
  const nameW = Math.min(130, Math.max(44, longestName * 6.4 + 10));
  const left = setPanelW + nameW + 12;
  const top = 14;
  const bottom = 16;
  const avail = Math.max(1, height - top - bottom);
  // Clamp the split so neither panel can vanish at extreme aspect ratios.
  const frac = Math.min(0.8, Math.max(0.2, opts.barFraction));
  const barH = avail * frac;
  const matrixH = avail - barH;
  return {
    left,
    top,
    barBaseline: top + barH,
    barH,
    rowH: nSets > 0 ? matrixH / nSets : matrixH,
    colW: nIntersections > 0 ? Math.max(1, (width - left - 12) / nIntersections) : 1,
    matrixH,
    setPanelW,
  };
}

/** Round up to a readable axis maximum (1, 2, 2.5 or 5 times a power of ten). */
export function niceMax(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= max) return m * mag;
  }
  return mag * 10;
}

/**
 * Read one intersection's membership row out of the flattened matrix.
 * Returns all-false when the matrix is missing or the row is out of range,
 * so a malformed feed draws an empty column rather than throwing.
 */
export function membershipRow(
  membership: ArrayLike<number> | undefined,
  index: number,
  nSets: number,
): boolean[] {
  const out = new Array<boolean>(nSets).fill(false);
  if (!membership || nSets <= 0 || index < 0) return out;
  const base = index * nSets;
  if (base + nSets > membership.length) return out;
  for (let s = 0; s < nSets; s += 1) out[s] = (membership[base + s] as number) === 1;
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createUpset: PlotomicsFactory<UpsetOptions> = (el, initial) => {
  let opts: UpsetOptions = mergeOptions(defaultUpsetOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutUpset(0, 0, 0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const sizes = () => (data.columns.size as ArrayLike<number>) ?? [];
  const sets = () => (data.meta?.sets as string[]) ?? [];
  const setSizes = () => data.meta?.setSizes as ArrayLike<number> | undefined;
  const membership = () => data.meta?.membership as ArrayLike<number> | undefined;
  const barFill = () => opts.barColor ?? theme.foreground;
  const emptyFill = () => opts.emptyDotColor ?? theme.grid;

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const s = sizes();
    const i = Math.floor((mx - layout.left) / layout.colW);
    if (mx < layout.left || i < 0 || i >= s.length) {
      tooltip.hide();
      return;
    }
    const names = sets();
    const inSet = membershipRow(membership(), i, names.length)
      .map((v, k) => (v ? names[k] : null))
      .filter(Boolean);
    const total = data.meta?.total as number | undefined;
    const pct = total ? ` (${((100 * (s[i] as number)) / total).toFixed(1)}%)` : "";
    tooltip.show(
      `<b>${(s[i] as number).toLocaleString()}</b>${pct}<br/>` +
        `${inSet.length ? esc(inSet.join(" + ")) : "none"}`,
      lastPointer.x,
      lastPointer.y,
    );
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
    const s = sizes();
    const names = sets();
    const longest = names.reduce((m, n) => Math.max(m, n.length), 4);
    layout = layoutUpset(width, height, names.length, s.length, opts, longest);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    if (!s.length || !names.length) {
      renderOverlay(1);
      return;
    }

    const max = niceMax(s);
    const bw = Math.max(1, layout.colW * 0.68);
    const mem = membership();

    // Intersection bars.
    ctx.fillStyle = barFill();
    for (let i = 0; i < s.length; i += 1) {
      const h = ((s[i] as number) / max) * (layout.barH - 6);
      const x = layout.left + i * layout.colW + (layout.colW - bw) / 2;
      ctx.fillRect(x, layout.barBaseline - h, bw, h);
    }

    // Membership matrix: alternating row bands, then the dots and the spine
    // connecting the filled ones.
    for (let r = 0; r < names.length; r += 1) {
      if (r % 2 === 1) continue;
      ctx.fillStyle = theme.grid;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(layout.left, layout.barBaseline + r * layout.rowH,
        width - layout.left - 12, layout.rowH);
      ctx.globalAlpha = 1;
    }
    const r = Math.min(opts.dotRadius, layout.colW / 2 - 1, layout.rowH / 2 - 1);
    for (let i = 0; i < s.length; i += 1) {
      const cx = layout.left + (i + 0.5) * layout.colW;
      const row = membershipRow(mem, i, names.length);
      let first = -1;
      let last = -1;
      for (let k = 0; k < names.length; k += 1) {
        if (!row[k]) continue;
        if (first < 0) first = k;
        last = k;
      }
      if (first >= 0 && last > first) {
        ctx.strokeStyle = barFill();
        ctx.lineWidth = Math.max(1.5, r * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx, layout.barBaseline + (first + 0.5) * layout.rowH);
        ctx.lineTo(cx, layout.barBaseline + (last + 0.5) * layout.rowH);
        ctx.stroke();
      }
      for (let k = 0; k < names.length; k += 1) {
        ctx.beginPath();
        ctx.arc(cx, layout.barBaseline + (k + 0.5) * layout.rowH, Math.max(1, r), 0, Math.PI * 2);
        ctx.fillStyle = row[k] ? barFill() : emptyFill();
        ctx.fill();
      }
    }

    // Set totals, drawn leftwards from the matrix so they read against it.
    const ss = setSizes();
    if (opts.showSetSizes && ss) {
      const smax = niceMax(ss);
      ctx.fillStyle = barFill();
      ctx.globalAlpha = 0.55;
      for (let k = 0; k < names.length; k += 1) {
        const w = ((ss[k] as number) / smax) * (layout.setPanelW - 10);
        const y = layout.barBaseline + k * layout.rowH + layout.rowH * 0.2;
        ctx.fillRect(layout.setPanelW - w, y, w, layout.rowH * 0.6);
      }
      ctx.globalAlpha = 1;
    }

    renderOverlay(max);
  }

  function renderOverlay(max: number) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const names = sets();

    // Bar axis.
    for (let t = 0; t <= 4; t += 1) {
      const v = (t / 4) * max;
      const y = layout.barBaseline - (t / 4) * (layout.barH - 6);
      svg.appendChild(line(layout.left, y, width - 12, y, theme.grid));
      svg.appendChild(text(layout.left - 6, y + 3, fmtInt(v), theme.muted, "end", 9));
    }
    svg.appendChild(
      rotatedText(14, layout.top + layout.barH / 2, opts.yLabel, theme.muted, 10),
    );

    // Set names, between the total bars and the matrix.
    for (let k = 0; k < names.length; k += 1) {
      svg.appendChild(
        text(layout.left - 10, layout.barBaseline + (k + 0.5) * layout.rowH + 3,
          names[k] ?? "", theme.foreground, "end", 10),
      );
    }

    const ss = setSizes();
    if (opts.showSetSizes && ss) {
      svg.appendChild(
        text(0, layout.barBaseline - 6, "set size", theme.muted, "start", 9),
      );
      for (let k = 0; k < names.length; k += 1) {
        svg.appendChild(
          text(layout.setPanelW + 3, layout.barBaseline + (k + 0.5) * layout.rowH + 3,
            fmtInt(ss[k] as number), theme.muted, "start", 8),
        );
      }
    }

    const total = data.meta?.total as number | undefined;
    if (total) {
      svg.appendChild(
        text(width - 12, layout.top + 2, `${total.toLocaleString()} total`,
          theme.muted, "end", 9),
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

  const instance: PlotomicsInstance<UpsetOptions> = {
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
function fmtInt(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(v));
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: UpsetOptions, next?: Partial<UpsetOptions>): UpsetOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
