/**
 * Oncoplot (OncoPrint) — the cohort alteration landscape.
 *
 * A gene x sample grid of categorical alteration classes, with a per-sample
 * mutation-burden barplot above, a per-gene frequency barplot to the right, and
 * any number of clinical annotation strips below. This is the most recognisable
 * figure in cancer genomics and the one shape the heatmap component cannot
 * cover, because heatmaps map a *continuous* value through a ramp whereas an
 * oncoplot paints discrete classes and needs the marginal panels to read.
 *
 * The whole data layer is one canvas: a 40 x 1000 grid is 40,000 cells, and at
 * cohort scale (hundreds of genes) it is hundreds of thousands, so per-cell
 * DOM nodes are not an option. SVG carries only gene labels, axis text and the
 * legend, per the library's rendering rules.
 *
 * The component is a renderer, not an analysis: it draws `meta.genes` and
 * `meta.samples` in exactly the order it is given, and uses the `tmb` and
 * `freq` columns as supplied rather than re-deriving them. Ordering an oncoplot
 * (memo sort, burden sort, clinical sort) is a decision the caller owns, and
 * re-deriving it here would let two renderings of the same data disagree.
 *
 * ## Data contract
 * - `columns.codes`  `number[]`  row-major gene x sample, 0 = unaltered,
 *                                1..K index into `meta.classes` (required)
 * - `columns.tmb`    `number[]`  per-sample burden for the top barplot
 * - `columns.freq`   `number[]`  per-gene percent altered for the right barplot
 * - `meta.nrows` / `meta.ncols`  grid dimensions (required)
 * - `meta.genes` / `meta.samples`  row / column labels, in display order
 * - `meta.classes`      `string[]`  legend levels; code k maps to classes[k-1]
 * - `meta.classColors`  `string[]`  one hex per class
 * - `meta.annotations`  `{ name, levels, codes, colors }[]`  clinical strips
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type Column,
  resolveTheme,
  createTooltip,
  createPlotBox,
  type Tooltip,
  measure,
  releaseContainer,
  dpr,
  serializeSVG,
  padSVG,
  compositePNG,
  defaultTheme,
  type TextSizes,
  textSizes,
  textWidth,
  fitText,
  categoricalColors,
  PALETTE_20,
} from "../core/index.js";
import { setCanvasColour } from "../core/paint.js";

export interface OncoplotOptions {
  /** Fraction of a cell's width left blank between columns, in [0, 0.5). */
  cellGapX: number;
  /** Fraction of a cell's height left blank between rows, in [0, 0.5). */
  cellGapY: number;
  /** Draw the per-sample burden barplot above the grid. */
  showBurden: boolean;
  /** Draw the per-gene frequency barplot to the right of the grid. */
  showFrequency: boolean;
  /** Draw the clinical annotation strips below the grid. */
  showAnnotations: boolean;
  /** Draw the alteration-class legend. */
  showLegend: boolean;
  /** Fill for a gene x sample cell with no alteration. */
  emptyColor: string;
  burdenColor: string;
  frequencyColor: string;
  /** Axis label under the grid. */
  xLabel: string;
  /** Label for the burden axis. */
  burdenLabel: string;
  theme: Partial<PlotomicsTheme>;
}

export const defaultOncoplotOptions: OncoplotOptions = {
  cellGapX: 0.12,
  cellGapY: 0.16,
  showBurden: true,
  showFrequency: true,
  showAnnotations: true,
  showLegend: true,
  emptyColor: "#EFE9DC",
  burdenColor: "#0E7175",
  frequencyColor: "#ED773C",
  xLabel: "samples",
  burdenLabel: "alterations",
  theme: {},
};

export interface OncoplotAnnotation {
  name: string;
  levels: string[];
  /** 0-based level code per sample; negative or out-of-range renders as blank. */
  codes: ArrayLike<number>;
  colors?: string[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Smallest height of one clinical annotation strip, in CSS pixels. */
const ANN_ROW_H = 13;
/** Gap between the grid and the annotation strips. */
const ANN_GAP = 6;
/** Smallest width of the gene label column. */
const GENE_LABEL_W = 96;
/**
 * Room a line of text takes above and below its baseline, as a share of its
 * size. This covers the font box of the common system fonts.
 */
const ASCENT = 1.08;
const DESCENT = 0.26;
/** Text sizes of the default theme, for a layout computed without a theme. */
const DEFAULT_SIZES = textSizes(defaultTheme);

/** Swatch size and the gaps around a legend entry. */
const SWATCH = 9;
const SWATCH_GAP = 4;
const ENTRY_GAP = 14;
/** The class for a gene and sample altered in two or more different ways. */
const MULTI_HIT = "Multi-hit";
const MULTI_HIT_COLOR = "#3A3A3A";
/**
 * Default colors for annotation strips: ColorBrewer Set2, then the pale half
 * of PALETTE_20, 17 light colors in all. They are lighter than the class
 * colors, so a strip does not read as an alteration.
 */
const ANNOTATION_PALETTE = [
  "#66C2A5",
  "#FC8D62",
  "#8DA0CB",
  "#E78AC3",
  "#A6D854",
  "#FFD92F",
  "#E5C494",
  "#B3B3B3",
  ...PALETTE_20.slice(9, 18),
];

/** How far below a line a text's baseline goes to centre the text on it. */
function midline(size: number): number {
  return size * 0.35;
}

/**
 * Where the text around the grid goes for the given text sizes, and the size
 * of the parts that hold text.
 */
function oncoText(s: TextSizes) {
  const burdenMax = Math.ceil(ASCENT * s.label);
  const countY = Math.ceil(ASCENT * s.axisTitle) + 1;
  return {
    /** Baseline of the maximum of the burden axis, from the top. */
    burdenMax,
    /**
     * Smallest burden panel: the maximum, then the axis title, whose
     * baseline sits 8 px above the grid.
     */
    minBurdenH:
      burdenMax + Math.ceil(DESCENT * s.label + ASCENT * s.axisTitle) + 9,
    /** Height of one annotation strip, which holds its name. */
    annRowH: Math.max(ANN_ROW_H, Math.ceil(s.label + 2)),
    /** Baseline of the sample count, below the grid and the strips. */
    countY,
    /** Room under the grid and the strips for the sample count. */
    bottomAxis: Math.ceil(countY + DESCENT * s.axisTitle) + 2,
    /** Height of one legend row. */
    legendRowH: Math.round(s.label + 4),
    /** Gap from the bottom of the element to the last legend baseline. */
    legendFoot: Math.ceil(DESCENT * s.label) + 3,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/oncoplot.test.ts)
// ---------------------------------------------------------------------------

export interface OncoplotLayout {
  /** Left edge of the grid (gene labels live to the left of it). */
  left: number;
  /** Top edge of the grid (the burden barplot sits above it). */
  top: number;
  /** Grid width and height in CSS pixels. */
  gridW: number;
  gridH: number;
  /** Width reserved for the right-hand frequency barplot (0 when hidden). */
  freqW: number;
  /** Height reserved for the top burden barplot (0 when hidden). */
  burdenH: number;
  /** Vertical extent of the annotation strips (0 when hidden or absent). */
  annH: number;
  /** Height of one annotation strip. */
  annRowH: number;
  cellW: number;
  cellH: number;
}

/**
 * Split the container into the five oncoplot regions. Pure arithmetic so the
 * geometry can be asserted without a canvas.
 */
export function layoutOncoplot(
  width: number,
  height: number,
  nrows: number,
  ncols: number,
  nAnnotations: number,
  opts: Pick<
    OncoplotOptions,
    "showBurden" | "showFrequency" | "showAnnotations" | "showLegend"
  >,
  geneLabelW = GENE_LABEL_W,
  /** Rows of legend entries; the legend wraps, so it can need several. */
  legendRows = 1,
  /** Text sizes; those of the default theme when omitted. */
  sizes: TextSizes = DEFAULT_SIZES,
): OncoplotLayout {
  const t = oncoText(sizes);
  const burdenH = opts.showBurden
    ? Math.min(
        Math.max(72, t.minBurdenH),
        Math.max(t.minBurdenH, height * 0.14),
      )
    : 0;
  const freqW = opts.showFrequency ? 96 : 0;
  const annCount = opts.showAnnotations ? nAnnotations : 0;
  const annH = annCount > 0 ? ANN_GAP + annCount * t.annRowH : 0;
  const legendH = opts.showLegend
    ? 16 + Math.max(1, legendRows) * t.legendRowH
    : 0;
  const bottomAxis = t.bottomAxis;

  const left = geneLabelW;
  const top = burdenH;
  const gridW = Math.max(1, width - left - freqW - 8);
  const gridH = Math.max(1, height - top - annH - legendH - bottomAxis);

  return {
    left,
    top,
    gridW,
    gridH,
    freqW,
    burdenH,
    annH,
    annRowH: t.annRowH,
    cellW: gridW / Math.max(1, ncols),
    cellH: gridH / Math.max(1, nrows),
  };
}

/**
 * Largest value in a numeric column, floored at 1 so bar scales never divide by
 * zero on an all-zero column.
 */
export function columnMax(col: Column | undefined): number {
  if (!col || col.length === 0) return 1;
  let m = 0;
  for (let i = 0; i < col.length; i += 1) {
    const v = (col as ArrayLike<number>)[i] as number;
    if (v > m) m = v;
  }
  return m > 0 ? m : 1;
}

/**
 * Pick which row labels to draw. When rows are at least `minSpacing` px tall
 * every gene is labelled; when they are shorter, every k-th row is, with k
 * chosen so labelled rows keep a `minSpacing` gap. The tooltip names every
 * gene. Returning an explicit set keeps the decision testable.
 */
export function visibleRowLabels(
  nrows: number,
  cellH: number,
  minSpacing = 9,
): Set<number> {
  const out = new Set<number>();
  if (!(cellH > 0)) return out;
  const every = Math.max(1, Math.ceil(minSpacing / cellH));
  for (let r = 0; r < nrows; r += every) out.add(r);
  return out;
}

/** One legend entry: a swatch and its text, or a heading with no swatch. */
export interface LegendEntry {
  label: string;
  color: string | null;
}

/**
 * Lay legend entries out in rows no wider than `maxWidth`. A group of entries
 * (the alteration classes, or one annotation's levels) starts a new row.
 * Returns each entry's x and its row number; `width` measures a label.
 */
export function wrapLegend(
  groups: LegendEntry[][],
  maxWidth: number,
  width: (s: string) => number,
  /**
   * Most rows to use. Entries past the last row are left out, and a
   * "+N more" note ends the last row, so a strip with hundreds of levels
   * cannot push the grid out of the element.
   */
  maxRows = Number.POSITIVE_INFINITY,
): { entry: LegendEntry; x: number; row: number }[] {
  const out: { entry: LegendEntry; x: number; row: number }[] = [];
  const entryW = (e: LegendEntry) =>
    (e.color ? SWATCH + SWATCH_GAP : 0) + width(e.label);
  let row = -1;
  let total = 0;
  for (const group of groups) total += group.length;
  for (const group of groups) {
    if (!group.length) continue;
    row += 1;
    let x = 0;
    for (const entry of group) {
      const w = entryW(entry);
      if (x > 0 && x + w > maxWidth) {
        row += 1;
        x = 0;
      }
      if (row >= maxRows) break;
      out.push({ entry, x, row });
      x += w + ENTRY_GAP;
    }
    if (row >= maxRows) break;
  }
  if (out.length < total) {
    // Make room on the last row for the note, dropping entries from its end.
    const last = Math.min(row, maxRows - 1);
    const note = (n: number): LegendEntry => ({
      label: `+${n} more`,
      color: null,
    });
    for (;;) {
      const tail = out[out.length - 1];
      const end = tail && tail.row === last ? tail.x + entryW(tail.entry) : 0;
      const x = end > 0 ? end + ENTRY_GAP : 0;
      const n = total - out.length;
      if (x + entryW(note(n)) <= maxWidth || !tail || tail.row !== last) {
        out.push({ entry: note(n), x, row: last });
        break;
      }
      out.pop();
    }
  }
  return out;
}

/** Map a grid pixel back to a (row, col) cell, or null when outside the grid. */
export function hitTest(
  px: number,
  py: number,
  layout: OncoplotLayout,
  nrows: number,
  ncols: number,
): { row: number; col: number } | null {
  const cx = px - layout.left;
  const cy = py - layout.top;
  if (cx < 0 || cy < 0 || cx >= layout.gridW || cy >= layout.gridH) return null;
  const col = Math.floor(cx / layout.cellW);
  const row = Math.floor(cy / layout.cellH);
  if (row < 0 || row >= nrows || col < 0 || col >= ncols) return null;
  return { row, col };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createOncoplot: PlotomicsFactory<OncoplotOptions> = (
  el,
  initial,
) => {
  let opts: OncoplotOptions = mergeOptions(
    defaultOncoplotOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  let layout = layoutOncoplot(0, 0, 1, 1, 0, opts);

  el.style.position = el.style.position || "relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:visible;";
  // The size of the element, and the plot box inside its padding: `width`
  // and `height` are the box, which every layer and coordinate is in.
  const plot = createPlotBox(el);
  let outerW = 0;
  let outerH = 0;
  /** Fit the plot box to an element `w` x `h` px and take its size. */
  function fitBox(w = outerW, h = outerH) {
    outerW = w;
    outerH = h;
    ({ width, height } = plot.fit(w, h, theme));
  }
  plot.box.append(canvas, svg);
  const tooltip: Tooltip = createTooltip(el, theme);

  // ---- data accessors ----
  const nrows = () => (data.meta?.nrows as number) ?? 0;
  const ncols = () => (data.meta?.ncols as number) ?? 0;
  const genes = () => (data.meta?.genes as string[]) ?? [];
  const samples = () => (data.meta?.samples as string[]) ?? [];
  const classes = () => (data.meta?.classes as string[]) ?? [];
  const annotations = () =>
    (data.meta?.annotations as OncoplotAnnotation[]) ?? [];
  function classColors(): string[] {
    const given = data.meta?.classColors as string[] | undefined;
    if (given?.length) return given;
    // "Multi-hit" is dark grey, and the other classes take the palette in
    // turn, so it never borrows the colour of a real class.
    const cls = classes();
    const pal = categoricalColors(
      theme.categorical,
      cls.filter((c) => c !== MULTI_HIT).length,
    );
    let k = 0;
    return cls.map((c) =>
      c === MULTI_HIT ? MULTI_HIT_COLOR : (pal[k++] as string),
    );
  }
  /**
   * Colors for each annotation strip. Without given colors, the strips use a
   * lighter palette than the alteration classes, and each strip continues it
   * after the strips before. Strips with 17 levels or fewer in total
   * therefore share no color; past 17, the palette starts again.
   */
  function annPalettes(): string[][] {
    let next = 0;
    return annotations().map((a) => {
      if (a.colors?.length) return a.colors;
      const cols = a.levels.map(
        (_, i) =>
          ANNOTATION_PALETTE[(next + i) % ANNOTATION_PALETTE.length] as string,
      );
      next += a.levels.length;
      return cols;
    });
  }

  /** The legend: the classes, then each shown annotation with its levels. */
  function legendGroups(): LegendEntry[][] {
    const cols = classColors();
    const groups: LegendEntry[][] = [
      classes().map((c, i) => ({
        label: c,
        color: cols[i] ?? theme.foreground,
      })),
    ];
    if (opts.showAnnotations) {
      const palettes = annPalettes();
      annotations().forEach((a, k) => {
        const pal = palettes[k] as string[];
        groups.push([
          { label: `${a.name}:`, color: null },
          ...a.levels.map((lv, i) => ({
            label: lv,
            color: pal[i % pal.length] as string,
          })),
        ]);
      });
    }
    return groups;
  }

  function labelWidth(s: string): number {
    return textWidth(s, sizes.label, theme.fontFamily);
  }
  /** `s` cut with an ellipsis to fit `maxW` px at `size`. */
  function fit(
    s: string,
    maxW: number,
    size = sizes.label,
    style = "",
  ): string {
    return fitText(s, maxW, size, theme.fontFamily, style);
  }
  /**
   * Width of the gene label column: wide enough for the gene names, the
   * strip names and the burden axis text, and at least 96 px.
   */
  function geneLabelWidth(): number {
    let w = 0;
    for (const g of genes()) {
      w = Math.max(
        w,
        textWidth(g ?? "", sizes.label, theme.fontFamily, "italic"),
      );
    }
    if (opts.showAnnotations) {
      for (const a of annotations()) w = Math.max(w, labelWidth(a.name));
    }
    const tmb = data.columns.tmb as ArrayLike<number> | undefined;
    if (opts.showBurden && tmb) {
      w = Math.max(
        w,
        labelWidth(fmtCount(columnMax(tmb))),
        textWidth(opts.burdenLabel, sizes.axisTitle, theme.fontFamily),
      );
    }
    return Math.max(
      GENE_LABEL_W,
      Math.min(Math.ceil(w) + 12, Math.floor(width * 0.4)),
    );
  }
  /**
   * Length of the longest frequency bar, leaving room after it for its
   * value.
   */
  function freqUsable(freq: ArrayLike<number>): number {
    const room = labelWidth(`${fmtPct(columnMax(freq))}%`) + 10;
    return layout.freqW - Math.max(44, Math.ceil(room));
  }
  function legendLayout() {
    // The legend gets at most a fifth of the height.
    const rowH = oncoText(sizes).legendRowH;
    const maxRows = Math.max(1, Math.floor((height * 0.2) / rowH));
    const maxW = Math.max(1, width - geneLabelWidth() - 8);
    // An entry wider than a whole row is cut to fit it.
    const groups = legendGroups().map((group) =>
      group.map((e) => ({
        ...e,
        label: fit(e.label, e.color ? maxW - SWATCH - SWATCH_GAP : maxW),
      })),
    );
    return wrapLegend(groups, maxW, labelWidth, maxRows);
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: px, y: py } = plot.pointer(e.clientX, e.clientY);
    const hit = hitTest(px, py, layout, nrows(), ncols());
    if (!hit) {
      // An annotation strip: name the sample and its value there.
      const ann = annotationAt(px, py);
      if (ann) {
        tooltip.show(
          `<b>${esc(ann.sample)}</b><br/>${esc(ann.name)}: ${esc(ann.value)}`,
          lastPointer.x,
          lastPointer.y,
        );
      } else {
        tooltip.hide();
      }
      return;
    }
    const codes = data.columns.codes as ArrayLike<number> | undefined;
    const code = codes ? (codes[hit.row * ncols() + hit.col] as number) : 0;
    const cls = code > 0 ? (classes()[code - 1] ?? "altered") : "no alteration";
    const g = genes()[hit.row] ?? `row ${hit.row}`;
    const s = samples()[hit.col] ?? `col ${hit.col}`;
    tooltip.show(
      `<b>${esc(g)}</b><br/>${esc(s)}<br/>${esc(cls)}`,
      lastPointer.x,
      lastPointer.y,
    );
  }
  /** The annotation cell under a point, if any. */
  function annotationAt(
    px: number,
    py: number,
  ): { name: string; sample: string; value: string } | null {
    if (!opts.showAnnotations || layout.annH === 0) return null;
    const cx = px - layout.left;
    const cy = py - (layout.top + layout.gridH + ANN_GAP);
    if (cx < 0 || cx >= layout.gridW || cy < 0) return null;
    const k = Math.floor(cy / layout.annRowH);
    const a = annotations()[k];
    const col = Math.floor(cx / layout.cellW);
    if (!a || col < 0 || col >= ncols()) return null;
    const code = a.codes[col] as number;
    const value =
      code == null || code < 0 || code >= a.levels.length
        ? "NA"
        : (a.levels[code] as string);
    return { name: a.name, sample: samples()[col] ?? `col ${col}`, value };
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
    ctx.clearRect(0, 0, width, height);
    if (setCanvasColour(ctx, "fillStyle", theme.background, el)) {
      ctx.fillRect(0, 0, width, height);
    }

    const R = nrows();
    const C = ncols();
    const legend = opts.showLegend ? legendLayout() : [];
    const legendRows = legend.length
      ? (legend[legend.length - 1]?.row ?? 0) + 1
      : 1;
    layout = layoutOncoplot(
      width,
      height,
      R,
      C,
      annotations().length,
      opts,
      geneLabelWidth(),
      legendRows,
      sizes,
    );
    if (R === 0 || C === 0) {
      renderOverlay();
      return;
    }

    const codes = data.columns.codes as ArrayLike<number> | undefined;
    const cols = classColors();
    const { left, top, cellW, cellH } = layout;
    const gapX = cellW * opts.cellGapX;
    const gapY = cellH * opts.cellGapY;
    // Sub-pixel cells still need to be visible, so never draw thinner than 1px.
    const w = Math.max(1, cellW - gapX);
    const h = Math.max(1, cellH - gapY);

    // Grid. Painting every cell's background first and overpainting the altered
    // ones keeps the common case (a mostly-empty matrix) to one fill style.
    ctx.fillStyle = opts.emptyColor;
    for (let r = 0; r < R; r += 1) {
      const y = top + r * cellH + gapY / 2;
      for (let c = 0; c < C; c += 1) {
        ctx.fillRect(left + c * cellW + gapX / 2, y, w, h);
      }
    }
    if (codes) {
      for (let r = 0; r < R; r += 1) {
        const y = top + r * cellH + gapY / 2;
        for (let c = 0; c < C; c += 1) {
          const code = codes[r * C + c] as number;
          if (!code) continue;
          ctx.fillStyle = cols[code - 1] ?? theme.foreground;
          ctx.fillRect(left + c * cellW + gapX / 2, y, w, h);
        }
      }
    }

    // Top burden barplot, one bar per sample column.
    if (opts.showBurden && layout.burdenH > 0) {
      const tmb = data.columns.tmb as ArrayLike<number> | undefined;
      if (tmb) {
        const max = columnMax(tmb);
        const usable = layout.burdenH - 10;
        ctx.fillStyle = opts.burdenColor;
        for (let c = 0; c < C; c += 1) {
          const v = (tmb[c] as number) ?? 0;
          const bh = (v / max) * usable;
          ctx.fillRect(left + c * cellW + gapX / 2, top - 6 - bh, w, bh);
        }
      }
    }

    // Right frequency barplot, one bar per gene row.
    if (opts.showFrequency && layout.freqW > 0) {
      const freq = data.columns.freq as ArrayLike<number> | undefined;
      if (freq) {
        const max = columnMax(freq);
        const x0 = left + layout.gridW + 6;
        const usable = freqUsable(freq);
        ctx.fillStyle = opts.frequencyColor;
        for (let r = 0; r < R; r += 1) {
          const v = (freq[r] as number) ?? 0;
          ctx.fillRect(x0, top + r * cellH + gapY / 2, (v / max) * usable, h);
        }
      }
    }

    // Clinical annotation strips.
    if (opts.showAnnotations && layout.annH > 0) {
      const anns = annotations();
      const palettes = annPalettes();
      let y = top + layout.gridH + ANN_GAP;
      for (const [k, a] of anns.entries()) {
        const palette = palettes[k] as string[];
        for (let c = 0; c < C; c += 1) {
          const code = (a.codes[c] as number) ?? -1;
          if (code < 0 || code >= a.levels.length) {
            ctx.fillStyle = opts.emptyColor;
          } else {
            ctx.fillStyle = palette[code % palette.length] as string;
          }
          ctx.fillRect(left + c * cellW + gapX / 2, y, w, layout.annRowH - 2);
        }
        y += layout.annRowH;
      }
    }

    renderOverlay();
  }

  function renderOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height) return;
    const R = nrows();
    const C = ncols();
    const { left, top, cellH } = layout;
    const tx = oncoText(sizes);
    const mid = midline(sizes.label);

    // Gene labels, right-aligned against the grid. The column stops at a
    // share of the width, and longer names are shortened.
    const room = left - 10;
    const showRow = visibleRowLabels(R, cellH, sizes.label);
    const g = genes();
    for (let r = 0; r < R; r += 1) {
      if (!showRow.has(r)) continue;
      const y = top + r * cellH + cellH / 2 + mid;
      svg.appendChild(
        text(
          left - 8,
          y,
          fit(g[r] ?? "", room, sizes.label, "italic"),
          theme.foreground,
          "end",
          sizes.label,
          "italic",
        ),
      );
    }

    // Frequency values, printed past the end of each bar.
    if (opts.showFrequency && layout.freqW > 0) {
      const freq = data.columns.freq as ArrayLike<number> | undefined;
      if (freq) {
        const max = columnMax(freq);
        const x0 = left + layout.gridW + 6;
        const usable = freqUsable(freq);
        for (let r = 0; r < R; r += 1) {
          if (!showRow.has(r)) continue;
          const v = (freq[r] as number) ?? 0;
          const y = top + r * cellH + cellH / 2 + mid;
          svg.appendChild(
            text(
              x0 + (v / max) * usable + 4,
              y,
              `${fmtPct(v)}%`,
              theme.muted,
              "start",
              sizes.label,
            ),
          );
        }
      }
    }

    // Burden axis: just the maximum, which is all the scale a reader needs.
    if (opts.showBurden && layout.burdenH > 0) {
      const tmb = data.columns.tmb as ArrayLike<number> | undefined;
      if (tmb) {
        svg.appendChild(
          text(
            left - 8,
            tx.burdenMax,
            fit(fmtCount(columnMax(tmb)), room),
            theme.muted,
            "end",
            sizes.label,
          ),
        );
        svg.appendChild(
          text(
            left - 8,
            layout.burdenH - 8,
            fit(opts.burdenLabel, room, sizes.axisTitle),
            theme.muted,
            "end",
            sizes.axisTitle,
          ),
        );
      }
    }

    // Annotation strip names.
    if (opts.showAnnotations && layout.annH > 0) {
      let y = top + layout.gridH + ANN_GAP;
      // Each name is centred on its strip, which is 2 px short of the row.
      const nameY = (layout.annRowH - 2) / 2 + mid;
      for (const a of annotations()) {
        svg.appendChild(
          text(
            left - 8,
            y + nameY,
            fit(a.name, room),
            theme.muted,
            "end",
            sizes.label,
          ),
        );
        y += layout.annRowH;
      }
    }

    // Sample count under the grid.
    const countCx = left + layout.gridW / 2;
    svg.appendChild(
      text(
        countCx,
        top + layout.gridH + layout.annH + tx.countY,
        fit(
          `${C.toLocaleString()} ${opts.xLabel}`,
          2 * Math.min(countCx, width - countCx) - 4,
          sizes.axisTitle,
        ),
        theme.muted,
        "middle",
        sizes.axisTitle,
      ),
    );

    if (opts.showLegend) renderLegend();
  }

  function renderLegend() {
    const items = legendLayout();
    if (!items.length) return;
    const rows = (items[items.length - 1]?.row ?? 0) + 1;
    const tx = oncoText(sizes);
    for (const { entry, x: dx, row } of items) {
      const x = layout.left + dx;
      const y = height - tx.legendFoot - (rows - 1 - row) * tx.legendRowH;
      if (entry.color) {
        const sw = document.createElementNS(SVG_NS, "rect");
        sw.setAttribute("x", String(x));
        sw.setAttribute("y", String(y - SWATCH));
        sw.setAttribute("width", String(SWATCH));
        sw.setAttribute("height", String(SWATCH));
        sw.setAttribute("fill", entry.color);
        svg.appendChild(sw);
        svg.appendChild(
          text(
            x + SWATCH + SWATCH_GAP,
            y,
            entry.label,
            theme.foreground,
            "start",
            sizes.label,
          ),
        );
      } else {
        // An annotation's name heads its levels.
        const t = text(x, y, entry.label, theme.muted, "start", sizes.label);
        t.setAttribute("font-weight", "600");
        svg.appendChild(t);
      }
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
    style?: string,
  ) {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", fill);
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("font-family", theme.fontFamily);
    t.setAttribute("font-size", String(size));
    if (style) t.setAttribute("font-style", style);
    t.textContent = content;
    return t;
  }

  function doResize(w: number, h: number) {
    fitBox(w, h);
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    doResize(m.width, m.height);
  }

  const instance: PlotomicsInstance<OncoplotOptions> = {
    setData(next) {
      data = next;
      render();
    },
    setOptions(next) {
      opts = mergeOptions(opts, next);
      theme = resolveTheme(opts.theme);
      sizes = textSizes(theme);
      // A new padding changes the plot box.
      doResize(outerW, outerH);
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      // Hybrid figure: the rasterized grid plus vector labels and legend.
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      img.setAttribute("href", canvas.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background, el),
      );
    },
    async exportPNG(scale = 2) {
      // The canvas with the axes, labels and legend over it.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        element: el,
        layers: [{ canvas, x: 0, y: 0, width, height }],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      plot.remove();
    },
  };

  return instance;
};

// ---- small utilities ----
function fmtPct(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
}
/** A count as a whole number, or with up to two decimals (float32 noise). */
/**
 * A count for the burden axis: whole numbers as they are, values of 100 or
 * more rounded, and smaller ones to three significant digits, which drops
 * float32 noise without rounding 0.004 to 0.
 */
function fmtCount(v: number): string {
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 100) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
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
  base: OncoplotOptions,
  next?: Partial<OncoplotOptions>,
): OncoplotOptions {
  if (!next) return { ...base };
  return {
    ...base,
    ...next,
    theme: { ...base.theme, ...(next.theme ?? {}) },
  };
}
