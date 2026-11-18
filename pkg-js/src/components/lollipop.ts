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
 * Variants at one residue stack on one stem (see {@link stackVariants}), so
 * equal counts never hide each other and the top of a stem is the residue's
 * total.
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
/**
 * Room under the residue axis: ticks to axisY + 4, tick labels on axisY + 15,
 * the title on axisY + 28, and its descent.
 */
const AXIS_TEXT_H = 33;
/** Height of one legend row. */
const LEGEND_ROW_H = 15;
/** Height of a variant label box, and the step between label rows. */
const LABEL_H = 12;
/** Label rows a label may climb above its own head to find free space. */
const LABEL_MAX_ROWS = 4;

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

/**
 * Frame the plot from the bottom up: legend rows, then the residue axis with
 * its tick labels and title below `axisY`, then the PTM track, the backbone,
 * and the stem area above it.
 */
export function layoutLollipop(
  width: number,
  height: number,
  opts: Pick<LollipopOptions, "showPtms" | "showLegend">,
  /** Rows of legend entries; the legend wraps, so it can need several. */
  legendRows = 1,
): LollipopLayout {
  const left = 52;
  const right = 16;
  // Room above the tallest stem for its head and two label rows, so a label
  // on the most recurrent variant never rides the top edge.
  const top = 40;
  const legendH =
    opts.showLegend && legendRows > 0 ? legendRows * LEGEND_ROW_H + 4 : 0;
  const ptmH = opts.showPtms ? PTM_H : 0;

  const axisY = height - legendH - AXIS_TEXT_H;
  const ptmTop = axisY - ptmH;
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
 * Stack the variants that share a residue on one stem. Each variant spans
 * `base` to `top` in count units: the most recurrent sits at the bottom and
 * the others follow by count (ties keep their row order), so the top of a
 * stem is the residue's total. `order` is the drawing order, bottom head
 * first, so a head drawn later is the one on top.
 */
export function stackVariants(
  positions: ArrayLike<number>,
  counts: ArrayLike<number>,
): { base: number[]; top: number[]; order: number[] } {
  const n = Math.min(positions.length, counts.length);
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort(
    (a, b) =>
      (positions[a] as number) - (positions[b] as number) ||
      (counts[b] as number) - (counts[a] as number) ||
      a - b,
  );
  const base = new Array<number>(n).fill(0);
  const top = new Array<number>(n).fill(0);
  let prevPos = Number.NaN;
  let sum = 0;
  for (const i of order) {
    const p = positions[i] as number;
    if (p !== prevPos) {
      prevPos = p;
      sum = 0;
    }
    base[i] = sum;
    sum += Math.max(0, counts[i] as number);
    top[i] = sum;
  }
  return { base, top, order };
}

/** A box in px, used for labels and the heads they must not cover. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A label to place: its centre x, preferred baseline y and width. */
export interface LabelCandidate {
  x: number;
  y: number;
  width: number;
}

/**
 * Place variant labels so none overlaps another label or any head. Labels are
 * placed in the order given (most important first). Each tries its preferred
 * baseline, then climbs one row at a time, up to `maxRows` rows; a label with
 * no free spot inside `bounds` is dropped (null). x is clamped so the label
 * stays inside the bounds. Deterministic, so a redraw and an export agree.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  obstacles: Box[],
  bounds: { left: number; right: number; top: number },
  maxRows = LABEL_MAX_ROWS,
): ({ x: number; y: number } | null)[] {
  const placed: Box[] = [];
  const hits = (b: Box, others: Box[]) =>
    others.some(
      (o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0,
    );
  return candidates.map((c) => {
    const half = c.width / 2;
    const x = Math.min(Math.max(c.x, bounds.left + half), bounds.right - half);
    for (let row = 0; row < maxRows; row += 1) {
      const y = c.y - row * LABEL_H;
      // A 10 px label: the box runs from its cap height to its descent.
      const box = {
        x0: x - half,
        y0: y - LABEL_H + 2,
        x1: x + half,
        y1: y + 2,
      };
      if (box.y0 < bounds.top) break;
      if (hits(box, placed) || hits(box, obstacles)) continue;
      placed.push(box);
      return { x, y };
    }
    return null;
  });
}

/**
 * Lay legend entries out in rows no wider than `maxWidth`. `widths` holds each
 * entry's full width, marker and text; `gap` separates entries in a row.
 */
export function wrapRows(
  widths: number[],
  maxWidth: number,
  gap = 14,
): { x: number; row: number }[] {
  const out: { x: number; row: number }[] = [];
  let row = 0;
  let x = 0;
  for (const w of widths) {
    if (x > 0 && x + w > maxWidth) {
      row += 1;
      x = 0;
    }
    out.push({ x, row });
    x += w + gap;
  }
  return out;
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

export const createLollipop: PlotomicsFactory<LollipopOptions> = (
  el,
  initial,
) => {
  let opts: LollipopOptions = mergeOptions(
    defaultLollipopOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutLollipop(0, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
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
  /** The largest single-variant count, which sets the head size scale. */
  function maxCount(): number {
    const c = counts();
    let m = 0;
    for (let i = 0; i < c.length; i += 1) {
      const v = c[i] as number;
      if (v > m) m = v;
    }
    return m > 0 ? m : 1;
  }
  // Variants at one residue share a stem; see stackVariants.
  let stack = stackVariants([], []);
  function restack() {
    stack = stackVariants(positions(), counts());
  }
  /** The tallest stem, which sets the y scale. */
  function maxStack(): number {
    let m = 0;
    for (const t of stack.top) if (t > m) m = t;
    return m > 0 ? m : 1;
  }
  /** Total count of the variants at one residue. */
  function residueTotal(residue: number): number {
    const pos = positions();
    let m = 0;
    for (let i = 0; i < stack.top.length; i += 1) {
      if (pos[i] === residue && (stack.top[i] as number) > m) {
        m = stack.top[i] as number;
      }
    }
    return m;
  }
  function radius(i: number, mc: number): number {
    return headRadius(
      counts()[i] as number,
      mc,
      opts.minHeadRadius,
      opts.maxHeadRadius,
    );
  }

  const measureCtx = document.createElement("canvas").getContext("2d");
  function textWidth(s: string, size: number): number {
    if (!measureCtx) return s.length * size * 0.56;
    measureCtx.font = `${size}px ${theme.fontFamily}`;
    return measureCtx.measureText(s).width;
  }
  /** Each legend entry's x and row; the legend wraps to the panel width. */
  function legendLayout(): { x: number; row: number }[] {
    const widths = classes().map((c) => 12 + textWidth(c, 10));
    return wrapRows(widths, Math.max(1, width - 52 - 16));
  }
  function legendRows(): number {
    const items = legendLayout();
    return items.length ? (items[items.length - 1]?.row ?? 0) + 1 : 0;
  }

  const px = (residue: number) =>
    layout.left + ((residue - 1) / Math.max(1, plen() - 1)) * layout.innerW;
  const py = (count: number) =>
    layout.baseline - (count / maxStack()) * layout.stemH;

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Nearest stem head within its own radius. Heads are visited in drawing
    // order and a tie goes to the later one, which is the head on top.
    const pos = positions();
    const cnt = counts();
    const mc = maxCount();
    let best = -1;
    let bestD = Infinity;
    for (const i of stack.order) {
      const x = px(pos[i] as number);
      const y = py(stack.top[i] as number);
      const d = Math.hypot(mx - x, my - y);
      if (d <= radius(i, mc) + 2 && d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      const p = pos[best] as number;
      const lab = labels()[best] ?? `p.${p}`;
      const cls = vclasses()[best] ?? "";
      const n = cnt[best] as number;
      const total = residueTotal(p);
      const more =
        total > n
          ? `<br/>residue ${p}: ${total} sample${total === 1 ? "" : "s"} in total`
          : "";
      tooltip.show(
        `<b>${esc(lab)}</b><br/>${esc(cls)}<br/>${n} sample${n === 1 ? "" : "s"}${more}`,
        lastPointer.x,
        lastPointer.y,
      );
      return;
    }

    // Otherwise, a domain under the cursor, when domains are drawn.
    if (
      opts.showDomains &&
      my >= layout.backboneTop &&
      my <= layout.backboneBottom
    ) {
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
    restack();
    layout = layoutLollipop(width, height, opts, legendRows());
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
    const cls = vclasses();
    const clsList = classes();
    const ccols = classColors();
    const mc = maxCount();

    ctx.strokeStyle = opts.stemColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const i of stack.order) {
      const x = px(pos[i] as number);
      ctx.moveTo(x, py(stack.base[i] as number));
      ctx.lineTo(x, py(stack.top[i] as number));
    }
    ctx.stroke();

    // Bottom head first, so a stacked head is drawn over the one below.
    for (const i of stack.order) {
      const x = px(pos[i] as number);
      const y = py(stack.top[i] as number);
      const r = radius(i, mc);
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

    // y axis: a tick at 0 and at the tallest stem.
    const top = maxStack();
    svg.appendChild(
      text(layout.left - 8, layout.baseline + 3, "0", theme.muted, "end", 9),
    );
    svg.appendChild(
      text(layout.left - 8, py(top) + 3, String(top), theme.muted, "end", 9),
    );
    svg.appendChild(
      rotatedText(
        14,
        layout.top + layout.stemH / 2,
        opts.yLabel,
        theme.muted,
        10,
      ),
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
        if (w > textWidth(label, 9) + 6) {
          svg.appendChild(
            text((x0 + x1) / 2, midY, label, "#FBF7EF", "middle", 9),
          );
        }
      });
    }

    // Variant labels for the stems the caller selected. Each starts just
    // above its own head and climbs only as far as it must to clear the other
    // labels and every head; the most recurrent variants are placed first,
    // and a label with no free spot is dropped.
    const pos = positions();
    const cnt = counts();
    const labs = labels();
    const idx = labelIndex().filter(
      (i) => i >= 0 && i < pos.length && (labs[i] ?? "") !== "",
    );
    if (idx.length) {
      const mc = maxCount();
      const headTop = (i: number) => py(stack.top[i] as number) - radius(i, mc);
      idx.sort(
        (a, b) =>
          (cnt[b] as number) - (cnt[a] as number) ||
          (pos[a] as number) - (pos[b] as number),
      );
      const heads: Box[] = [];
      for (let i = 0; i < pos.length; i += 1) {
        const x = px(pos[i] as number);
        const y = py(stack.top[i] as number);
        const r = radius(i, mc);
        heads.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
      }
      const spots = placeLabels(
        idx.map((i) => ({
          x: px(pos[i] as number),
          y: headTop(i) - 4,
          width: textWidth(labs[i] ?? "", 10) + 4,
        })),
        heads,
        { left: layout.left, right: width - layout.right, top: 2 },
      );
      idx.forEach((i, k) => {
        const spot = spots[k];
        if (!spot) return;
        const hx = px(pos[i] as number);
        // A label that climbed gets a leader line down to its head.
        if (spot.y < headTop(i) - 4 - 1) {
          svg.appendChild(
            line(hx, headTop(i) - 1, spot.x, spot.y + 2, theme.muted),
          );
        }
        svg.appendChild(
          text(spot.x, spot.y, labs[i] ?? "", theme.foreground, "middle", 10),
        );
      });
    }

    // Residue axis.
    for (const t of residueTicks(L)) {
      const x = px(t);
      svg.appendChild(line(x, layout.axisY, x, layout.axisY + 4, theme.axis));
      svg.appendChild(
        text(x, layout.axisY + 15, String(t), theme.muted, "middle", 9),
      );
    }
    const gene = (data.meta?.gene as string) ?? "";
    const acc = (data.meta?.uniprot as string) ?? "";
    // Either identifier alone still names the protein.
    const id = gene && acc ? `${gene} (${acc})` : gene || acc;
    const title = id ? `${id} - amino-acid position` : "amino-acid position";
    svg.appendChild(
      text(
        layout.left + layout.innerW / 2,
        layout.axisY + 28,
        title,
        theme.muted,
        "middle",
        10,
      ),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const cls = classes();
    if (!cls.length) return;
    const cols = classColors();
    const items = legendLayout();
    // Rows start under the axis title.
    const firstY = layout.axisY + AXIS_TEXT_H + 11;
    items.forEach(({ x: dx, row }, i) => {
      const x = layout.left + dx;
      const y = firstY + row * LEGEND_ROW_H;
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x + 4));
      dot.setAttribute("cy", String(y - 4));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", cols[i] ?? theme.foreground);
      svg.appendChild(dot);
      svg.appendChild(
        text(x + 12, y, cls[i] ?? "", theme.foreground, "start", 10),
      );
    });
  }

  // ---- SVG helpers ----
  function text(
    x: number,
    y: number,
    content: string,
    fill: string,
    anchor: string,
    size = 10,
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
  function rotatedText(
    x: number,
    y: number,
    content: string,
    fill: string,
    size: number,
  ) {
    const t = text(x, y, content, fill, "middle", size);
    t.setAttribute("transform", `rotate(-90 ${x} ${y})`);
    return t;
  }
  function line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
  ) {
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
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
function mergeOptions(
  base: LollipopOptions,
  next?: Partial<LollipopOptions>,
): LollipopOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
