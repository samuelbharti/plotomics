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
  rangeTicks,
  spaceTicks,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth as measureText,
  categoricalColors,
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
/** Smallest height of the backbone / domain band. */
const BACKBONE_H = 22;
/** Height of the PTM tick track under the backbone. */
const PTM_H = 14;
/**
 * Height of a variant label box, and the step between label rows, for the
 * label size of the default theme.
 */
const LABEL_H = 12;
/** Label rows a label may climb above its own head to find free space. */
const LABEL_MAX_ROWS = 4;
/**
 * Room a line of text takes above and below its baseline, as a share of its
 * size. This covers the font box of the common system fonts.
 */
const ASCENT = 1.08;
const DESCENT = 0.26;
/** Text sizes of the default theme, for a layout computed without a theme. */
const DEFAULT_SIZES = textSizes(defaultTheme);

/** How far below a line a text's baseline goes to centre the text on it. */
function midline(size: number): number {
  return size * 0.35;
}

/**
 * Where the text around the plot goes for the given text sizes: offsets
 * below the residue axis of its labels, its title and the first legend row,
 * and the size of the parts that hold text. Each line starts under the font
 * box of the line above it.
 */
function lollipopText(s: TextSizes) {
  const tick = 6 + s.label;
  const title = tick + Math.ceil(DESCENT * s.label + ASCENT * s.axisTitle) + 1;
  const axisText = Math.ceil(title + DESCENT * s.axisTitle) + 1;
  return {
    /** x of the rotated y title, far enough right for its letters. */
    titleX: Math.ceil(1.1 * s.axisTitle),
    tick,
    title,
    /** Room under the residue axis for its labels and title. */
    axisText,
    /** Baseline of the first legend row. */
    legend: axisText + Math.ceil(ASCENT * s.label),
    /** Height of one legend row. */
    legendRowH: Math.round(s.label + 4),
    /** Height of a variant label box, and the step between label rows. */
    labelH: Math.round(s.label + 1),
    /** Height of the backbone band, which holds the domain names. */
    backboneH: Math.max(
      BACKBONE_H,
      Math.ceil((ASCENT + DESCENT) * s.small) + 6,
    ),
  };
}

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
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
  /** Width in px of the widest y tick label. */
  tickWidth = 0,
  /** Width in px of the label of the last residue tick. */
  endWidth = 0,
): LollipopLayout {
  const t = lollipopText(sizes);
  // The y tick labels sit between the rotated y title and the stems.
  const left = Math.max(
    52,
    Math.ceil(t.titleX + DESCENT * sizes.axisTitle + 3 + tickWidth + 8),
  );
  // The last residue label is centred on the right end of the axis.
  const right = Math.max(16, Math.ceil(endWidth / 2) + 2);
  // Room above the tallest stem for its head and two label rows, so a label
  // on the most recurrent variant never rides the top edge.
  const top = Math.max(40, 2 * t.labelH + 16);
  const legendH =
    opts.showLegend && legendRows > 0 ? legendRows * t.legendRowH + 4 : 0;
  const ptmH = opts.showPtms ? PTM_H : 0;

  const axisY = height - legendH - t.axisText;
  const ptmTop = axisY - ptmH;
  const backboneBottom = ptmTop - 2;
  const backboneTop = backboneBottom - t.backboneH;
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
  // A missing (null or NaN) or negative count weighs nothing, so it cannot
  // turn the rest of its stem into NaN.
  const w = (i: number) => countOf(counts[i]);
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort(
    (a, b) =>
      (positions[a] as number) - (positions[b] as number) ||
      w(b) - w(a) ||
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
    sum += w(i);
    top[i] = sum;
  }
  return { base, top, order };
}

/** A count as a number of samples: missing or negative counts are 0. */
function countOf(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** A box in px, used for labels and the heads they must not cover. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * One place a label may go: the text anchor point (x by `anchor`, y the
 * baseline) and, for a label away from its head, where its leader line ends.
 */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
  leader?: { x: number; y: number };
}

/** A label to place: its width and the spots to try, best first. */
export interface LabelCandidate {
  width: number;
  spots: LabelSpot[];
}

/** The box a label of `width` takes at `spot`, in a row `labelH` tall. */
function labelBox(spot: LabelSpot, width: number, labelH: number): Box {
  const x0 =
    spot.anchor === "middle"
      ? spot.x - width / 2
      : spot.anchor === "start"
        ? spot.x
        : spot.x - width;
  // The box runs from the cap height of the label to its descent, which
  // takes a sixth of the row.
  const descent = labelH / 6;
  return {
    x0,
    y0: spot.y - labelH + descent,
    x1: x0 + width,
    y1: spot.y + descent,
  };
}

/**
 * Place variant labels so none overlaps another label, a leader line or any
 * head. Labels are placed in the order given (most important first), each at
 * the first of its spots that is free and inside `bounds`; a centred label is
 * first moved sideways to fit the bounds. A label with no free spot is
 * dropped (null). Deterministic, so a redraw and an export agree.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  obstacles: Box[],
  bounds: { left: number; right: number; top: number },
  /** Height of a label box; see {@link labelBox}. */
  labelH = LABEL_H,
): (LabelSpot | null)[] {
  const placed: Box[] = [];
  const hits = (b: Box, others: Box[]) =>
    others.some(
      (o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0,
    );
  return candidates.map((c) => {
    for (const s of c.spots) {
      const spot =
        s.anchor === "middle"
          ? {
              ...s,
              x: Math.min(
                Math.max(s.x, bounds.left + c.width / 2),
                bounds.right - c.width / 2,
              ),
            }
          : s;
      const box = labelBox(spot, c.width, labelH);
      if (
        box.y0 < bounds.top ||
        box.x0 < bounds.left - 0.5 ||
        box.x1 > bounds.right + 0.5
      ) {
        continue;
      }
      if (hits(box, placed) || hits(box, obstacles)) continue;
      // A leader line must not cross a label already placed.
      let lead: Box | null = null;
      if (spot.leader) {
        lead = {
          x0: Math.min(spot.leader.x, spot.x) - 1,
          y0: Math.min(spot.leader.y, spot.y + 2),
          x1: Math.max(spot.leader.x, spot.x) + 1,
          y1: Math.max(spot.leader.y, spot.y + 2),
        };
        if (hits(lead, placed)) continue;
      }
      placed.push(box);
      if (lead) placed.push(lead);
      return spot;
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

/**
 * Residue ticks for the axis: round positions (multiples of 1, 2 or 5 x 10^k)
 * with 1 and the protein length at the ends. A round tick too close to an end
 * is left out, so the last two labels never overlap.
 */
export function residueTicks(length: number, count = 6): number[] {
  return rangeTicks(length, count);
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
  let sizes = textSizes(theme);
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
    return categoricalColors(theme.categorical, classes().length);
  }
  function domainColors(): string[] {
    const given = data.meta?.domainColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, domains().length);
  }
  // Variants at one residue share a stem; see stackVariants. The largest
  // single count (the head size scale) and the tallest stem (the y scale)
  // are kept with the stack, so each draw reads them once.
  let stack = stackVariants([], []);
  let countMax = 1;
  let stackMax = 1;
  function restack() {
    stack = stackVariants(positions(), counts());
    const c = counts();
    countMax = 0;
    for (let i = 0; i < c.length; i += 1) {
      countMax = Math.max(countMax, countOf(c[i]));
    }
    stackMax = 0;
    for (const t of stack.top) stackMax = Math.max(stackMax, t);
    if (!(countMax > 0)) countMax = 1;
    if (!(stackMax > 0)) stackMax = 1;
  }
  /** The largest single-variant count, which sets the head size scale. */
  function maxCount(): number {
    return countMax;
  }
  /** The tallest stem, which sets the y scale. */
  function maxStack(): number {
    return stackMax;
  }
  /** A variant whose count is missing (null from R, NaN from Python). */
  function missing(i: number): boolean {
    return !Number.isFinite(counts()[i] as number);
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
      countOf(counts()[i]),
      mc,
      opts.minHeadRadius,
      opts.maxHeadRadius,
    );
  }

  function textWidth(s: string, size: number): number {
    return measureText(s, size, theme.fontFamily);
  }
  /**
   * The layout for the current size, data and text sizes, with `legendRows`
   * rows of legend. Call {@link restack} first.
   */
  function frame(legendRows: number): LollipopLayout {
    const tickWidth = Math.max(
      textWidth("0", sizes.label),
      textWidth(String(maxStack()), sizes.label),
    );
    return layoutLollipop(
      width,
      height,
      opts,
      legendRows,
      sizes,
      tickWidth,
      textWidth(String(plen()), sizes.label),
    );
  }
  /**
   * Each shown legend entry's x and row, and a "+N more" note when the
   * entries need more rows than the legend may take (a fifth of the height).
   */
  function legendLayout(): {
    items: { x: number; row: number }[];
    note: { x: number; row: number; text: string } | null;
  } {
    const widths = classes().map((c) => 12 + textWidth(c, sizes.label));
    const f = frame(0);
    const maxW = Math.max(1, width - f.left - f.right);
    const rowH = lollipopText(sizes).legendRowH;
    const maxRows = Math.max(1, Math.floor((height * 0.2) / rowH));
    const all = wrapRows(widths, maxW);
    const items = all.filter((it) => it.row < maxRows);
    if (items.length === all.length) return { items, note: null };
    const last = maxRows - 1;
    for (;;) {
      const text = `+${all.length - items.length} more`;
      const tail = items[items.length - 1];
      const i = items.length - 1;
      const x = tail && tail.row === last ? tail.x + (widths[i] ?? 0) + 14 : 0;
      if (
        x + textWidth(text, sizes.label) <= maxW ||
        !tail ||
        tail.row !== last
      ) {
        return { items, note: { x, row: last, text } };
      }
      items.pop();
    }
  }
  function legendRows(): number {
    const { items, note } = legendLayout();
    if (note) return note.row + 1;
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

    // The head drawn on top wins: of the heads under the cursor, the last in
    // drawing order. Near a head but on none, the nearest within 2 px.
    const pos = positions();
    const cnt = counts();
    const mc = maxCount();
    let best = -1;
    let near = -1;
    let nearD = Infinity;
    for (const i of stack.order) {
      if (missing(i)) continue;
      const x = px(pos[i] as number);
      const y = py(stack.top[i] as number);
      const d = Math.hypot(mx - x, my - y);
      const r = radius(i, mc);
      if (d <= r) best = i;
      else if (d <= r + 2 && d < nearD) {
        nearD = d;
        near = i;
      }
    }
    if (best < 0) best = near;
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
    layout = frame(legendRows());
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const L = plen();
    if (L <= 1) {
      renderOverlay();
      return;
    }

    // Backbone.
    const bandH = layout.backboneBottom - layout.backboneTop;
    const midY = layout.backboneTop + bandH / 2;
    ctx.fillStyle = opts.backboneColor;
    ctx.fillRect(layout.left, midY - 4, layout.innerW, 8);

    // Domain rectangles.
    if (opts.showDomains) {
      const dcols = domainColors();
      domains().forEach((d, i) => {
        const x0 = px(d.start);
        const x1 = px(d.end);
        ctx.fillStyle = dcols[i % dcols.length] as string;
        ctx.fillRect(x0, layout.backboneTop, Math.max(1, x1 - x0), bandH);
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
      if (missing(i)) continue;
      const x = px(pos[i] as number);
      ctx.moveTo(x, py(stack.base[i] as number));
      ctx.lineTo(x, py(stack.top[i] as number));
    }
    ctx.stroke();

    // Bottom head first, so a stacked head is drawn over the one below.
    for (const i of stack.order) {
      if (missing(i)) continue;
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
    const tx = lollipopText(sizes);
    const mid = midline(sizes.label);

    // y axis: a tick at 0 and at the tallest stem.
    const top = maxStack();
    svg.appendChild(
      text(
        layout.left - 8,
        layout.baseline + mid,
        "0",
        theme.muted,
        "end",
        sizes.label,
      ),
    );
    svg.appendChild(
      text(
        layout.left - 8,
        py(top) + mid,
        String(top),
        theme.muted,
        "end",
        sizes.label,
      ),
    );
    svg.appendChild(
      rotatedText(
        tx.titleX,
        layout.top + layout.stemH / 2,
        opts.yLabel,
        theme.muted,
        sizes.axisTitle,
      ),
    );

    // Domain names, centred, dropped when the rectangle is too narrow to hold
    // the text rather than overflowing into its neighbours.
    if (opts.showDomains) {
      const bandH = layout.backboneBottom - layout.backboneTop;
      const midY = layout.backboneTop + bandH / 2 + midline(sizes.small);
      domains().forEach((d) => {
        const x0 = px(d.start);
        const x1 = px(d.end);
        const w = x1 - x0;
        const label = shortDomain(d.name);
        if (w > textWidth(label, sizes.small) + 6) {
          svg.appendChild(
            text((x0 + x1) / 2, midY, label, "#FBF7EF", "middle", sizes.small),
          );
        }
      });
    }

    // Variant labels for the stems the caller selected, most recurrent
    // first. The head on top of a stem is labelled just above itself, then
    // beside itself, then up to three rows higher with a leader line. A head
    // lower in a stack is labelled only beside itself, since a label above
    // it would sit over another variant's head. A label with no free spot is
    // dropped.
    const pos = positions();
    const cnt = counts();
    const labs = labels();
    const idx = labelIndex().filter(
      (i) => i >= 0 && i < pos.length && (labs[i] ?? "") !== "" && !missing(i),
    );
    if (idx.length) {
      const mc = maxCount();
      idx.sort(
        (a, b) =>
          countOf(cnt[b]) - countOf(cnt[a]) ||
          (pos[a] as number) - (pos[b] as number),
      );
      const heads: Box[] = [];
      const stemTop = new Map<number, number>();
      for (let i = 0; i < pos.length; i += 1) {
        if (missing(i)) continue;
        const x = px(pos[i] as number);
        const y = py(stack.top[i] as number);
        const r = radius(i, mc);
        heads.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
        const p = pos[i] as number;
        stemTop.set(p, Math.max(stemTop.get(p) ?? 0, stack.top[i] as number));
      }
      const candidates: LabelCandidate[] = idx.map((i) => {
        const hx = px(pos[i] as number);
        const hy = py(stack.top[i] as number);
        const r = radius(i, mc);
        const headTop = hy - r;
        const beside: LabelSpot[] = [
          { x: hx + r + 3, y: hy + mid, anchor: "start" },
          { x: hx - r - 3, y: hy + mid, anchor: "end" },
        ];
        const onTop =
          (stack.top[i] as number) >= (stemTop.get(pos[i] as number) ?? 0);
        const above: LabelSpot[] = [];
        for (let row = 0; row < LABEL_MAX_ROWS; row += 1) {
          above.push({
            x: hx,
            y: headTop - 4 - row * tx.labelH,
            anchor: "middle",
            leader: row > 0 ? { x: hx, y: headTop - 1 } : undefined,
          });
        }
        return {
          width: textWidth(labs[i] ?? "", sizes.label) + 4,
          spots: onTop
            ? [above[0] as LabelSpot, ...beside, ...above.slice(1)]
            : beside,
        };
      });
      // A label box starts five sixths of a row above its baseline, and
      // the font box of the text reaches a little higher.
      const spots = placeLabels(
        candidates,
        heads,
        {
          left: layout.left,
          right: width - layout.right,
          top: Math.max(
            2,
            Math.ceil(ASCENT * sizes.label - (tx.labelH * 5) / 6),
          ),
        },
        tx.labelH,
      );
      idx.forEach((i, k) => {
        const spot = spots[k];
        if (!spot) return;
        if (spot.leader) {
          svg.appendChild(
            line(spot.leader.x, spot.leader.y, spot.x, spot.y + 2, theme.muted),
          );
        }
        svg.appendChild(
          text(
            spot.x,
            spot.y,
            labs[i] ?? "",
            theme.foreground,
            spot.anchor,
            sizes.label,
          ),
        );
      });
    }

    // Residue axis: about one tick per 80 px, and a tick whose label would
    // touch its neighbour's is left out, so narrow plots stay readable.
    const count = Math.max(2, Math.min(8, Math.floor(layout.innerW / 80)));
    const residues = spaceTicks(residueTicks(L, count), px, (t) =>
      textWidth(String(t), sizes.label),
    );
    for (const t of residues) {
      const x = px(t);
      svg.appendChild(line(x, layout.axisY, x, layout.axisY + 4, theme.axis));
      svg.appendChild(
        text(
          x,
          layout.axisY + tx.tick,
          String(t),
          theme.muted,
          "middle",
          sizes.label,
        ),
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
        layout.axisY + tx.title,
        title,
        theme.muted,
        "middle",
        sizes.axisTitle,
      ),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const cls = classes();
    if (!cls.length) return;
    const cols = classColors();
    const { items, note } = legendLayout();
    const tx = lollipopText(sizes);
    // Rows start under the axis title.
    const firstY = layout.axisY + tx.legend;
    if (note) {
      svg.appendChild(
        text(
          layout.left + note.x,
          firstY + note.row * tx.legendRowH,
          note.text,
          theme.muted,
          "start",
          sizes.label,
        ),
      );
    }
    items.forEach(({ x: dx, row }, i) => {
      const x = layout.left + dx;
      const y = firstY + row * tx.legendRowH;
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x + 4));
      dot.setAttribute("cy", String(y - midline(sizes.label)));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", cols[i] ?? theme.foreground);
      svg.appendChild(dot);
      svg.appendChild(
        text(x + 12, y, cls[i] ?? "", theme.foreground, "start", sizes.label),
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
    size: number,
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
      sizes = textSizes(theme);
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
