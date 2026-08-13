/**
 * Protein domain lollipop — variants along a protein, over its architecture.
 *
 * A backbone spanning the protein with Pfam/InterPro domain rectangles drawn on
 * it, mutation stems rising from it with head area proportional to recurrence,
 * and a post-translational modification track below. This is the figure that
 * answers "where in the protein do the variants land, and does that mean
 * anything" — hotspots inside a functional domain read very differently from
 * truncating variants scattered across it.
 *
 * The genome browser component cannot stand in for this: it works in genomic
 * coordinates, and a lollipop works in amino-acid coordinates over a domain
 * architecture that has no genomic extent.
 *
 * Stems and domains are canvas-drawn so a protein with thousands of variants
 * stays responsive; labels, the axis and the legend are an SVG overlay.
 *
 * Which stems get a text label is taken from `meta.labelIndex` rather than
 * decided here. Label choice is a judgement call, and letting the renderer make
 * it independently is how two views of one dataset end up labelling different
 * hotspots.
 *
 * ## Data contract
 * - `columns.position`  `number[]`  amino-acid position, 1-based (required)
 * - `columns.count`     `number[]`  recurrence per variant (required)
 * - `columns.class`     `string[]`  variant class, indexes `meta.classes`
 * - `columns.label`     `string[]`  per-variant label text, e.g. "R175H"
 * - `meta.length`       `number`    protein length in residues (required)
 * - `meta.gene` / `meta.uniprot`    identifiers for the axis title
 * - `meta.domains`      `{ name, start, end }[]` domain rectangles
 * - `meta.ptms`         `{ position, type }[]`   modification sites
 * - `meta.classes` / `meta.classColors`  legend levels and colours
 * - `meta.domainColors` `string[]`  one colour per domain
 * - `meta.labelIndex`   `number[]`  indices of variants to label
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

export interface LollipopOptions {
  /** Radius of the smallest stem head, in pixels. */
  minHeadRadius: number;
  /** Radius of the most recurrent stem head, in pixels. */
  maxHeadRadius: number;
  /** Draw the post-translational modification track. */
  showPtms: boolean;
  /** Draw the domain rectangles on the backbone. */
  showDomains: boolean;
  /** Draw the variant-class legend. */
  showLegend: boolean;
  /** Colour of the bare backbone between domains. */
  backboneColor: string;
  stemColor: string;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultLollipopOptions: LollipopOptions = {
  minHeadRadius: 3,
  maxHeadRadius: 11,
  showPtms: true,
  showDomains: true,
  showLegend: true,
  backboneColor: "#E6DCC8",
  stemColor: "#93a1b8",
  yLabel: "samples",
  theme: {},
};

export interface LollipopDomain {
  name: string;
  start: number;
  end: number;
}
export interface LollipopPtm {
  position: number;
  type: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Height of the backbone / domain band. */
const BACKBONE_H = 22;
/** Height of the PTM tick track under the backbone. */
const PTM_H = 14;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/lollipop.test.ts)
// ---------------------------------------------------------------------------

export interface LollipopLayout {
  left: number;
  right: number;
  /** Top of the stem area. */
  top: number;
  /** Baseline the stems rise from, and the top of the backbone band. */
  baseline: number;
  backboneTop: number;
  backboneBottom: number;
  ptmTop: number;
  axisY: number;
  innerW: number;
  stemH: number;
}

export function layoutLollipop(
  width: number,
  height: number,
  opts: Pick<LollipopOptions, "showPtms" | "showLegend">,
): LollipopLayout {
  const left = 52;
  const right = 16;
  // Room above the tallest stem for its head plus up to three stacked label
  // rows, so a label on the most recurrent variant never rides the top edge.
  const top = 40;
  const axisH = 26;
  const legendH = opts.showLegend ? 24 : 0;
  const ptmH = opts.showPtms ? PTM_H : 0;

  const axisY = height - legendH - 8;
  const ptmTop = axisY - axisH - ptmH;
  const backboneBottom = ptmTop - 2;
  const backboneTop = backboneBottom - BACKBONE_H;
  const baseline = backboneTop;

  return {
    left,
    right,
    top,
    baseline,
    backboneTop,
    backboneBottom,
    ptmTop,
    axisY,
    innerW: Math.max(1, width - left - right),
    stemH: Math.max(1, baseline - top),
  };
}

/**
 * Head radius for a recurrence count. Area scales with count (so a variant seen
 * twice as often looks twice as big, rather than four times), which is the
 * convention every published lollipop uses.
 */
export function headRadius(
  count: number,
  maxCount: number,
  min: number,
  max: number,
): number {
  if (maxCount <= 0) return min;
  const t = Math.sqrt(Math.max(0, count) / maxCount);
  return min + t * (max - min);
}

/**
 * Assign labels to stacked rows so adjacent labels do not overlap. Greedy:
 * walk left to right, put each label on the lowest row whose last label ends
 * before this one starts. Deterministic, so both a redraw and an export agree.
 */
export function stackLabels(
  xs: number[],
  widths: number[],
  maxRows = 3,
): number[] {
  const rowEnd: number[] = [];
  const rows: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const x0 = (xs[i] as number) - (widths[i] as number) / 2;
    const x1 = (xs[i] as number) + (widths[i] as number) / 2;
    let placed = -1;
    for (let r = 0; r < rowEnd.length && r < maxRows; r += 1) {
      if (x0 > (rowEnd[r] as number)) {
        rowEnd[r] = x1;
        placed = r;
        break;
      }
    }
    if (placed < 0) {
      if (rowEnd.length < maxRows) {
        rowEnd.push(x1);
        placed = rowEnd.length - 1;
      } else {
        placed = -1; // no room; caller skips this label
      }
    }
    rows.push(placed);
  }
  return rows;
}

/** Evenly spaced residue ticks for the axis, always including 1 and length. */
export function residueTicks(length: number, count = 6): number[] {
  if (length <= 1) return [1];
  const step = Math.max(1, Math.round(length / count));
  const out: number[] = [1];
  for (let v = step; v < length; v += step) out.push(v);
  out.push(length);
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createLollipop: PlotomicsFactory<LollipopOptions> = (el, initial) => {
  let opts: LollipopOptions = mergeOptions(defaultLollipopOptions, initial.options);
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutLollipop(0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  el.appendChild(canvas);
  el.appendChild(svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- accessors ----
  const plen = () => Math.max(1, (data.meta?.length as number) ?? 1);
  const positions = () => (data.columns.position as ArrayLike<number>) ?? [];
  const counts = () => (data.columns.count as ArrayLike<number>) ?? [];
  const vclasses = () => (data.columns.class as string[]) ?? [];
  const labels = () => (data.columns.label as string[]) ?? [];
  const classes = () => (data.meta?.classes as string[]) ?? [];
  const domains = () => (data.meta?.domains as LollipopDomain[]) ?? [];
  const ptms = () => (data.meta?.ptms as LollipopPtm[]) ?? [];
  const labelIndex = () => (data.meta?.labelIndex as number[]) ?? [];
  function classColors(): string[] {
    const given = data.meta?.classColors as string[] | undefined;
    if (given && given.length) return given;
    return classes().map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }
  function domainColors(): string[] {
    const given = data.meta?.domainColors as string[] | undefined;
    if (given && given.length) return given;
    return domains().map((_, i) => OKABE_ITO[i % OKABE_ITO.length] as string);
  }
  function maxCount(): number {
    const c = counts();
    let m = 0;
    for (let i = 0; i < c.length; i += 1) {
      const v = c[i] as number;
      if (v > m) m = v;
    }
    return m > 0 ? m : 1;
  }

  const px = (residue: number) =>
    layout.left + ((residue - 1) / Math.max(1, plen() - 1)) * layout.innerW;
  const py = (count: number) =>
    layout.baseline - (count / maxCount()) * layout.stemH;

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Nearest stem head within its own radius.
    const pos = positions();
    const cnt = counts();
    const mc = maxCount();
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < pos.length; i += 1) {
      const x = px(pos[i] as number);
      const y = py(cnt[i] as number);
      const r = headRadius(cnt[i] as number, mc, opts.minHeadRadius, opts.maxHeadRadius);
      const d = Math.hypot(mx - x, my - y);
      if (d <= r + 2 && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      const lab = labels()[best] ?? `p.${pos[best]}`;
      const cls = vclasses()[best] ?? "";
      tooltip.show(
        `<b>${esc(lab)}</b><br/>${esc(cls)}<br/>${cnt[best]} sample${cnt[best] === 1 ? "" : "s"}`,
        lastPointer.x,
        lastPointer.y,
      );
      return;
    }

    // Otherwise, a domain under the cursor.
    if (my >= layout.backboneTop && my <= layout.backboneBottom) {
      for (const d of domains()) {
        if (mx >= px(d.start) && mx <= px(d.end)) {
          tooltip.show(
            `<b>${esc(d.name)}</b><br/>${d.start}-${d.end}`,
            lastPointer.x,
            lastPointer.y,
          );
          return;
        }
      }
    }
    tooltip.hide();
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
    layout = layoutLollipop(width, height, opts);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const L = plen();
    if (L <= 1) {
      renderOverlay();
      return;
    }

    // Backbone.
    const midY = layout.backboneTop + BACKBONE_H / 2;
    ctx.fillStyle = opts.backboneColor;
    ctx.fillRect(layout.left, midY - 4, layout.innerW, 8);

    // Domain rectangles.
    if (opts.showDomains) {
      const dcols = domainColors();
      domains().forEach((d, i) => {
        const x0 = px(d.start);
        const x1 = px(d.end);
        ctx.fillStyle = dcols[i % dcols.length] as string;
        ctx.fillRect(x0, layout.backboneTop, Math.max(1, x1 - x0), BACKBONE_H);
      });
    }

    // PTM ticks.
    if (opts.showPtms) {
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.fillStyle = theme.muted;
      for (const p of ptms()) {
        const x = px(p.position);
        ctx.beginPath();
        ctx.moveTo(x, layout.ptmTop);
        ctx.lineTo(x, layout.ptmTop + PTM_H - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, layout.ptmTop + PTM_H - 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Stems, then heads, so heads always sit above neighbouring stems.
    const pos = positions();
    const cnt = counts();
    const cls = vclasses();
    const clsList = classes();
    const ccols = classColors();
    const mc = maxCount();

    ctx.strokeStyle = opts.stemColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < pos.length; i += 1) {
      const x = px(pos[i] as number);
      ctx.moveTo(x, layout.baseline);
      ctx.lineTo(x, py(cnt[i] as number));
    }
    ctx.stroke();

    for (let i = 0; i < pos.length; i += 1) {
      const x = px(pos[i] as number);
      const y = py(cnt[i] as number);
      const r = headRadius(cnt[i] as number, mc, opts.minHeadRadius, opts.maxHeadRadius);
      const ci = clsList.indexOf(cls[i] ?? "");
      ctx.fillStyle = ci >= 0 ? (ccols[ci] as string) : theme.foreground;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const L = plen();

    // y axis: a tick at 0 and at the maximum recurrence.
    const mc = maxCount();
    svg.appendChild(text(layout.left - 8, layout.baseline + 3, "0", theme.muted, "end", 9));
    svg.appendChild(text(layout.left - 8, py(mc) + 3, String(mc), theme.muted, "end", 9));
    svg.appendChild(
      rotatedText(14, layout.top + layout.stemH / 2, opts.yLabel, theme.muted, 10),
    );

    // Domain names, centred, dropped when the rectangle is too narrow to hold
    // the text rather than overflowing into its neighbours.
    if (opts.showDomains) {
      const midY = layout.backboneTop + BACKBONE_H / 2 + 3;
      domains().forEach((d) => {
        const x0 = px(d.start);
        const x1 = px(d.end);
        const w = x1 - x0;
        const label = shortDomain(d.name);
        if (w > estimateTextWidth(label, 9) + 6) {
          svg.appendChild(text((x0 + x1) / 2, midY, label, "#FBF7EF", "middle", 9));
        }
      });
    }

    // Variant labels for the stems the caller selected.
    const idx = labelIndex();
    if (idx.length) {
      const pos = positions();
      const cnt = counts();
      const labs = labels();
      const mc2 = maxCount();
      const xs = idx.map((i) => px(pos[i] as number));
      const ws = idx.map((i) => estimateTextWidth(labs[i] ?? "", 10) + 6);
      const rows = stackLabels(xs, ws);
      idx.forEach((i, k) => {
        const row = rows[k] as number;
        if (row < 0) return;
        const r = headRadius(cnt[i] as number, mc2, opts.minHeadRadius, opts.maxHeadRadius);
        const rawY = py(cnt[i] as number) - r - 4 - row * 12;
        // Keep labels inside the panel: the tallest stem's label would
        // otherwise sit above the top edge, and a label on a variant near
        // residue 1 or the C-terminus would run off the side.
        const y = Math.max(layout.top - 4, rawY);
        const half = (ws[k] as number) / 2;
        const x = Math.min(
          Math.max(xs[k] as number, layout.left + half),
          width - layout.right - half,
        );
        svg.appendChild(text(x, y, labs[i] ?? "", theme.foreground, "middle", 10));
      });
    }

    // Residue axis.
    for (const t of residueTicks(L)) {
      const x = px(t);
      svg.appendChild(line(x, layout.axisY - 4, x, layout.axisY, theme.axis));
      svg.appendChild(text(x, layout.axisY + 12, String(t), theme.muted, "middle", 9));
    }
    const gene = (data.meta?.gene as string) ?? "";
    const acc = (data.meta?.uniprot as string) ?? "";
    const title = gene && acc ? `${gene} (${acc}) - amino-acid position` : "amino-acid position";
    svg.appendChild(
      text(layout.left + layout.innerW / 2, layout.axisY + 24, title, theme.muted, "middle", 10),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const cls = classes();
    if (!cls.length) return;
    const cols = classColors();
    const y = height - 6;
    let x = layout.left;
    for (let i = 0; i < cls.length; i += 1) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x + 4));
      dot.setAttribute("cy", String(y - 4));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", cols[i] ?? theme.foreground);
      svg.appendChild(dot);
      svg.appendChild(text(x + 12, y, cls[i] ?? "", theme.foreground, "start", 10));
      x += 12 + estimateTextWidth(cls[i] ?? "", 10) + 14;
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

  const instance: PlotomicsInstance<LollipopOptions> = {
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
/** Pfam names run long ("P53 DNA-binding domain"); keep the informative head. */
function shortDomain(name: string): string {
  return name.replace(/\s*(domain|motif|family)\s*$/i, "");
}
function estimateTextWidth(s: string, size: number): number {
  return s.length * size * 0.56;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: LollipopOptions, next?: Partial<LollipopOptions>): LollipopOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
