/**
 * Profile — a grouped categorical bar profile with coloured header blocks.
 *
 * Built for the 96-context mutational signature plot, where the bars are the 96
 * trinucleotide contexts and the six header blocks are the substitution classes
 * (C>A, C>G, C>T, T>A, T>C, T>G). That layout is a fixed convention: anyone who
 * reads signature figures recognises the six-block banner and reads the shape
 * underneath it without a legend. It generalises to any ordered categorical
 * profile that groups into runs, which is why it is not called "sbs96".
 *
 * Bars are canvas-drawn and the header, axis and labels are an SVG overlay. At
 * 96 bars canvas is not strictly required, but keeping the data layer on canvas
 * means a caller can hand it a few thousand bins (a copy-number profile, a
 * binned coverage track) without the component falling over.
 *
 * Groups must arrive as contiguous runs, which is what makes the header blocks
 * meaningful. The component does not sort: reordering the bars is the caller's
 * decision, and for SBS96 the canonical order is part of the convention.
 *
 * ## Data contract
 * - `columns.value`  `number[]`  bar height (required)
 * - `columns.group`  `string[]`  group per bar; contiguous runs become blocks
 * - `columns.label`  `string[]`  per-bar tick label, e.g. the trinucleotide
 * - `meta.groups`       `string[]`  group order; defaults to order of appearance
 * - `meta.groupColors`  `string[]`  one colour per group
 * - `meta.title`        `string`    drawn above the header band
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
  compositePNG,
  zeroTicks,
  fitZeroTicks,
  formatTick,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth as measureText,
  fitText,
  categoricalColors,
} from "../core/index.js";

export interface ProfileOptions {
  /** Fraction of each slot the bar occupies, in (0, 1]. */
  barWidth: number;
  /** Draw the coloured group blocks above the bars. */
  showHeader: boolean;
  /** Draw the per-bar tick labels under the axis. */
  showBarLabels: boolean;
  /** Show values as a share of the total rather than raw counts. */
  asFraction: boolean;
  yLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultProfileOptions: ProfileOptions = {
  barWidth: 0.62,
  showHeader: true,
  showBarLabels: true,
  asFraction: false,
  yLabel: "mutations",
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Tallest the band of rotated bar labels may get, in multiples of their size. */
const MAX_BAR_LABEL_EM = 60 / 9;
/** Smallest height of the coloured group banner. */
const HEADER_H = 18;
/** Gap between the banner and the tallest bar. */
const HEADER_GAP = 6;
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
 * Where the text around the bars goes for the given text sizes, and the size
 * of the parts that hold text. Bar labels use the small size: there is one
 * under every bar.
 */
function profileText(s: TextSizes) {
  const titleBaseline = Math.ceil(ASCENT * s.title) + 1;
  return {
    /** x of the rotated y title, far enough right for its letters. */
    titleX: Math.ceil(1.1 * s.axisTitle),
    titleBaseline,
    /** Height of the title row; the descent reaches into the gap below. */
    titleH: titleBaseline + 1,
    /** Height of the coloured group banner, which holds the group names. */
    headerH: Math.max(HEADER_H, Math.ceil(s.label + 7)),
    /** Room above the plot for the top tick label when nothing is above. */
    plotPad: Math.max(10, Math.ceil((ASCENT - 0.35) * s.label) + 1),
    /** Tallest the band of rotated bar labels may get. */
    maxBarLabelH: Math.round(MAX_BAR_LABEL_EM * s.small),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/profile.test.ts)
// ---------------------------------------------------------------------------

export interface GroupRun {
  group: string;
  /** First bar index in the run. */
  start: number;
  /** Last bar index in the run, inclusive. */
  end: number;
}

/**
 * Collapse a per-bar group column into contiguous runs. A group that appears in
 * two separate stretches yields two runs rather than one spanning block, which
 * is the honest rendering: a banner spanning a gap would claim bars it does not
 * cover.
 */
export function groupRuns(groups: string[]): GroupRun[] {
  const out: GroupRun[] = [];
  if (!groups.length) return out;
  let start = 0;
  for (let i = 1; i <= groups.length; i += 1) {
    if (i === groups.length || groups[i] !== groups[start]) {
      out.push({ group: groups[start] as string, start, end: i - 1 });
      start = i;
    }
  }
  return out;
}

/** The largest finite value, or 0. */
export function finiteMax(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

export interface ProfileLayout {
  left: number;
  right: number;
  headerTop: number;
  plotTop: number;
  baseline: number;
  axisY: number;
  innerW: number;
  plotH: number;
  slot: number;
}

export function layoutProfile(
  width: number,
  height: number,
  nBars: number,
  opts: Pick<ProfileOptions, "showHeader" | "showBarLabels">,
  /** Whether a title is drawn; it gets its own row above the strip. */
  hasTitle = false,
  /** Width in px of the longest bar label, which runs down the bottom. */
  barLabelW = 24,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
  /** Width in px of the widest y tick label. */
  tickWidth = 0,
): ProfileLayout {
  const t = profileText(sizes);
  // The y tick labels sit between the rotated y title and the bars.
  const left = Math.max(
    56,
    Math.ceil(t.titleX + DESCENT * sizes.axisTitle + 3 + tickWidth + 8),
  );
  const right = 14;
  const titleH = hasTitle ? t.titleH : 0;
  const headerTop = titleH + (opts.showHeader ? 6 : 0);
  const plotTop = opts.showHeader
    ? headerTop + t.headerH + HEADER_GAP
    : titleH + t.plotPad;
  const labelH = opts.showBarLabels
    ? Math.min(t.maxBarLabelH, Math.ceil(barLabelW) + 10)
    : 10;
  const axisY = height - labelH - 14;
  return {
    left,
    right,
    headerTop,
    plotTop,
    baseline: axisY,
    axisY,
    innerW: Math.max(1, width - left - right),
    plotH: Math.max(1, axisY - plotTop),
    slot: Math.max(1, width - left - right) / Math.max(1, nBars),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createProfile: PlotomicsFactory<ProfileOptions> = (
  el,
  initial,
) => {
  let opts: ProfileOptions = mergeOptions(
    defaultProfileOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutProfile(0, 0, 1, opts);

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
  const values = () => (data.columns.value as ArrayLike<number>) ?? [];
  const groupCol = () => (data.columns.group as string[]) ?? [];
  const barLabels = () => (data.columns.label as string[]) ?? [];
  function groups(): string[] {
    const given = data.meta?.groups as string[] | undefined;
    if (given && given.length) return given;
    const seen: string[] = [];
    for (const g of groupCol()) if (!seen.includes(g)) seen.push(g);
    return seen;
  }
  function groupColors(): string[] {
    const given = data.meta?.groupColors as string[] | undefined;
    if (given && given.length) return given;
    return categoricalColors(theme.categorical, groups().length);
  }
  function textWidth(s: string, size: number): number {
    return measureText(s, size, theme.fontFamily);
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(s: string, maxW: number, size: number): string {
    return fitText(s, maxW, size, theme.fontFamily);
  }
  /** Width of the longest bar label at its font size, in px. */
  function longestBarLabel(): number {
    let w = 0;
    for (const lab of barLabels()) {
      w = Math.max(w, textWidth(lab ?? "", sizes.small));
    }
    return w;
  }
  /** The label of the y tick at `val`. */
  function tickText(val: number, step: number): string {
    return formatTick(val, step, { percent: opts.asFraction });
  }
  function plotted(): number[] {
    const v = values();
    const out = new Array<number>(v.length);
    let total = 0;
    for (let i = 0; i < v.length; i += 1) total += v[i] as number;
    const denom = opts.asFraction && total > 0 ? total : 1;
    for (let i = 0; i < v.length; i += 1) out[i] = (v[i] as number) / denom;
    return out;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = values();
    if (my < layout.plotTop || my > layout.baseline || mx < layout.left) {
      tooltip.hide();
      return;
    }
    const i = Math.floor((mx - layout.left) / layout.slot);
    if (i < 0 || i >= v.length) {
      tooltip.hide();
      return;
    }
    const lab = barLabels()[i] ?? String(i);
    const g = groupCol()[i] ?? "";
    let total = 0;
    for (let k = 0; k < v.length; k += 1) total += v[k] as number;
    const pct = total > 0 ? (100 * (v[i] as number)) / total : 0;
    tooltip.show(
      `<b>${esc(lab)}</b> ${esc(g)}<br/>${fmtInt(v[i] as number)} (${pct.toFixed(1)}%)`,
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
    const v = plotted();
    const frame = (tickWidth: number) =>
      layoutProfile(
        width,
        height,
        v.length,
        opts,
        Boolean(data.meta?.title),
        longestBarLabel(),
        sizes,
        tickWidth,
      );
    // As many round ticks as the plot height holds without crowding. The
    // height does not depend on the left gutter, so the gutter can then grow
    // to fit the tick labels without changing the ticks.
    layout = frame(0);
    const axis = v.length
      ? fitZeroTicks(finiteMax(v), layout.plotH, {
          minGapPx: sizes.label + 5,
        })
      : zeroTicks(1, 4);
    let tickWidth = 0;
    for (const val of axis.ticks) {
      tickWidth = Math.max(
        tickWidth,
        textWidth(tickText(val, axis.step), sizes.label),
      );
    }
    layout = frame(tickWidth);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    if (!v.length) {
      renderOverlay(axis);
      return;
    }

    const max = axis.top;
    const gcol = groupCol();
    const glist = groups();
    const gcols = groupColors();
    const bw = Math.max(1, layout.slot * opts.barWidth);

    // Bars.
    for (let i = 0; i < v.length; i += 1) {
      // A missing group (null) is a group of its own, as in R's unique(), so
      // its bars take the colour of its block in the banner.
      const gi = glist.indexOf(gcol[i] as string);
      ctx.fillStyle = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
      const h = ((v[i] as number) / max) * layout.plotH;
      const x = layout.left + i * layout.slot + (layout.slot - bw) / 2;
      ctx.fillRect(x, layout.baseline - h, bw, h);
    }

    // Group banner.
    if (opts.showHeader) {
      for (const run of groupRuns(gcol)) {
        const gi = glist.indexOf(run.group);
        ctx.fillStyle = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
        const x0 = layout.left + run.start * layout.slot;
        const x1 = layout.left + (run.end + 1) * layout.slot;
        ctx.fillRect(
          x0,
          layout.headerTop,
          Math.max(1, x1 - x0 - 2),
          profileText(sizes).headerH,
        );
      }
    }

    renderOverlay(axis);
  }

  function renderOverlay(axis: { ticks: number[]; top: number; step: number }) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const gcol = groupCol();
    const glist = groups();
    const gcols = groupColors();
    const tx = profileText(sizes);

    // y gridlines and ticks, on round steps, each label stating its value.
    for (const val of axis.ticks) {
      const y = layout.baseline - (val / axis.top) * layout.plotH;
      svg.appendChild(
        line(layout.left, y, width - layout.right, y, theme.grid),
      );
      svg.appendChild(
        text(
          layout.left - 8,
          y + midline(sizes.label),
          tickText(val, axis.step),
          theme.muted,
          "end",
          sizes.label,
        ),
      );
    }
    // The y title is centred on the bars and may reach the element's edges.
    const yTitleCy = layout.plotTop + layout.plotH / 2;
    svg.appendChild(
      rotatedText(
        tx.titleX,
        yTitleCy,
        fit(
          opts.yLabel,
          2 * Math.min(yTitleCy - 2, height - 2 - yTitleCy),
          sizes.axisTitle,
        ),
        theme.muted,
        sizes.axisTitle,
      ),
    );

    // Group names on the banner, in a colour that reads on the block.
    if (opts.showHeader) {
      for (const run of groupRuns(gcol)) {
        const x0 = layout.left + run.start * layout.slot;
        const x1 = layout.left + (run.end + 1) * layout.slot;
        const gi = glist.indexOf(run.group);
        const bg = gi >= 0 ? (gcols[gi] as string) : theme.foreground;
        if (
          run.group != null &&
          x1 - x0 > textWidth(run.group, sizes.label) + 8
        ) {
          svg.appendChild(
            text(
              (x0 + x1) / 2,
              layout.headerTop + tx.headerH / 2 + midline(sizes.label),
              run.group,
              readableOn(bg),
              "middle",
              sizes.label,
            ),
          );
        }
      }
    }

    // Per-bar labels, rotated, thinned when they would collide.
    if (opts.showBarLabels) {
      const labs = barLabels();
      const every = Math.max(1, Math.ceil((sizes.small + 1) / layout.slot));
      // A label longer than the band under the axis is cut to fit.
      const room = Math.max(8, height - layout.axisY - 8);
      for (let i = 0; i < labs.length; i += every) {
        const x = layout.left + i * layout.slot + layout.slot / 2;
        const t = text(
          x,
          layout.axisY + 6,
          fit(labs[i] ?? "", room, sizes.small),
          theme.muted,
          "end",
          sizes.small,
        );
        t.setAttribute("transform", `rotate(-90 ${x} ${layout.axisY + 6})`);
        svg.appendChild(t);
      }
    }

    const title = data.meta?.title as string | undefined;
    if (title) {
      // In its own row above the strip, with room for capitals and descenders.
      svg.appendChild(
        text(
          layout.left,
          tx.titleBaseline,
          fit(title, width - layout.left - layout.right, sizes.title),
          theme.foreground,
          "start",
          sizes.title,
        ),
      );
    }
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

  const instance: PlotomicsInstance<ProfileOptions> = {
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
      // The canvas with the axes, labels and legend over it.
      return compositePNG({
        width,
        height,
        scale,
        background: theme.background,
        layers: [{ canvas, x: 0, y: 0, width, height }],
        overlay: svg,
      });
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
/** Black or white, whichever reads better on the given background. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#FFFFFF";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Rec. 601 luma; the SBS palette spans near-black to pale pink, so a fixed
  // colour would be unreadable on one end or the other.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#233038" : "#FFFFFF";
}
function fmtInt(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
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
  base: ProfileOptions,
  next?: Partial<ProfileOptions>,
): ProfileOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
