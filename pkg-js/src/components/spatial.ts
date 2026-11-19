/**
 * Spatial map — measurements plotted on tissue, over the histology image.
 *
 * The layout of a spatial transcriptomics experiment: capture spots at their
 * real coordinates on the slide, drawn on top of the H&E section they came
 * from. The embedding component can draw the points, but it has no image
 * underlay, and for a spatial assay the tissue *is* the axis. A cluster that
 * traces the edge of an invasive front means something a UMAP cannot say.
 *
 * Image and spots share one transform. The container is almost never the
 * aspect ratio of the slide image, so a "contain" fit is computed once and used
 * for both the `drawImage` call and every spot's centre, which makes it
 * impossible for the histology and the overlay to drift apart on resize, on
 * full-screen, or on a high-DPI display. Two separate elements (an `img` plus a
 * positioned canvas) would need that fit recomputed in two places.
 *
 * `color` may be categorical (strings, discrete legend) or continuous (numbers,
 * sequential ramp with a colourbar), which is what lets one page toggle between
 * colouring spots by cluster and by a gene's expression. The legend sits in a
 * gutter right of the image, so it never covers the tissue.
 *
 * ## Data contract
 * - `columns.x`, `columns.y`  `number[]`  spot centres in IMAGE pixel
 *                                          coordinates (required)
 * - `columns.color`  `string[] | number[]`  strings categorical, numbers continuous
 * - `columns.label`  `string[]`  optional per-spot tooltip label
 * - `meta.image`         `string`  URL of the tissue image
 * - `meta.imgWidth` / `meta.imgHeight`  `number`  its natural size
 * - `meta.spotDiameter`  `number`  spot diameter in image pixels; when absent,
 *                                    the median distance from a spot to its
 *                                    nearest neighbour, so neighbours touch
 * - `meta.levels` / `meta.colors`  `string[]`  fix categorical order and colours
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  type PlotomicsTheme,
  type RampName,
  resolveTheme,
  textSizes,
  createTooltip,
  createPlotBox,
  type Tooltip,
  measure,
  releaseContainer,
  textWidth,
  fitText,
  fitLegend,
  legendCandidates,
  legendLabelsFit,
  dpr,
  serializeSVG,
  padSVG,
  compositePNG,
  ramp,
  categoricalColors,
  domainTicks,
  fitDomainTicks,
  formatTicks,
  isFlatRange,
} from "../core/index.js";
import { setCanvasColour } from "../core/paint.js";
import { uniqueId } from "../core/dom.js";

export type SpatialColorMode = "auto" | "categorical" | "continuous";

export interface SpatialOptions {
  /** How to interpret the `color` column. `"auto"` detects from its type. */
  colorMode: SpatialColorMode;
  /** Sequential ramp used for continuous colouring. */
  colormap: RampName;
  /** Multiplier on the spot diameter; 1 draws spots at their true size. */
  spotScale: number;
  /** Spot fill opacity in [0, 1]. Lower it to read the histology underneath. */
  spotOpacity: number;
  /** Draw the tissue image. */
  showImage: boolean;
  /** Tissue image opacity in [0, 1]. */
  imageOpacity: number;
  /** Draw the discrete legend or the continuous colourbar. */
  showLegend: boolean;
  theme: Partial<PlotomicsTheme>;
}

export const defaultSpatialOptions: SpatialOptions = {
  colorMode: "auto",
  colormap: "viridis",
  spotScale: 1,
  spotOpacity: 0.85,
  showImage: true,
  imageOpacity: 1,
  showLegend: true,
  theme: {},
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Cap on discrete legend rows before collapsing into a "+N more" line. */
const LEGEND_MAX = 14;
/** The largest share of the widget's width that the legend gutter takes. */
const MAX_LEGEND_SHARE = 0.35;
/** Space left and right of the legend, in px. */
const LEGEND_PAD = 8;
/** Width of the colour bar, in px. */
const BAR_W = 10;
/** Top of the colour bar, and its height when the widget has room. */
const BAR_TOP = 18;
const BAR_MAX = 90;
/** The most intervals between the colour bar's ticks. */
const BAR_TICKS = 4;
/**
 * From the bottom of the colour bar down to the baseline of the NA key, at
 * label size `fs`: room for the half of a label centred on the bottom of
 * the bar, and the key's own line.
 */
function naRowHeight(fs: number): number {
  return Math.round(fs * 1.35 + 5);
}
/**
 * Spot diameter in image px when none is given and the spots give no
 * spacing to derive one from: a single spot, or all at one place.
 */
const FALLBACK_SPOT_DIAMETER = 4;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a GPU; see test/spatial.test.ts)
// ---------------------------------------------------------------------------

export interface FitTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * "Contain" fit of an image into a container: the largest uniform scale that
 * keeps the whole image visible, centred. One transform for the image and the
 * overlay is the whole point, so this is the only place the mapping is defined.
 */
export function fitTransform(
  width: number,
  height: number,
  imgWidth: number,
  imgHeight: number,
): FitTransform {
  if (imgWidth <= 0 || imgHeight <= 0 || width <= 0 || height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(width / imgWidth, height / imgHeight);
  return {
    scale,
    offsetX: (width - imgWidth * scale) / 2,
    offsetY: (height - imgHeight * scale) / 2,
  };
}

/** Spot radius in screen pixels, never below 1 so spots stay visible zoomed out. */
export function spotRadius(
  diameter: number,
  scale: number,
  spotScale: number,
): number {
  return Math.max(1, (diameter * scale * spotScale) / 2);
}

/**
 * The median distance from a spot to its nearest neighbour, in the units of
 * the coordinates. Spots with a missing coordinate are left out, and a spot
 * at the same place as another is not its neighbour. Null when fewer than
 * two spots are at different places.
 *
 * The spots go into a grid of cells that hold about two spots each, and the
 * search for a spot's neighbour moves out ring by ring from its own cell,
 * clipped to the grid, until no closer spot can be left. The grid spans the
 * 1st to 99th percentile of each coordinate, so a few spots far off do not
 * crowd the slide into a few cells. Spots at one place are searched for
 * once, and each cell lists one spot per place, so a slide with many spots
 * at a few places stays fast. At most `maxQueries` spots, spread over the
 * input, are measured, which keeps a large slide fast.
 *
 * Also null for coordinates so large that a squared distance overflows, or
 * so small that it underflows to 0: the caller then takes its fallback.
 */
export function medianNeighbourDistance(
  xs: ArrayLike<number | null>,
  ys: ArrayLike<number | null>,
  maxQueries = 2000,
): number | null {
  const px: number[] = [];
  const py: number[] = [];
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    px.push(x);
    py.push(y);
  }
  const n = px.length;
  if (n < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = px[i] as number;
    const y = py[i] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX === minX && maxY === minY) return null;
  // The grid spans the 1st to 99th percentile of each coordinate, and the
  // spots outside go into its edge cells. A spot moved into an edge cell is
  // at least as far off as that cell, so the search stays exact. When most
  // spots share one place, the grid spans them all.
  let [loX, hiX] = coreRange(px);
  let [loY, hiY] = coreRange(py);
  if (loX === hiX && loY === hiY)
    [loX, hiX, loY, hiY] = [minX, maxX, minY, maxY];
  const w = hiX - loX;
  const h = hiY - loY;
  const ext = Math.max(w, h);
  // No ring of the search reaches past twice the extent, so its squared
  // distances stay finite.
  if (!Number.isFinite(4 * ext * ext)) return null;
  let m = 0;
  for (let i = 0; i < n; i += 1) {
    const x = px[i] as number;
    const y = py[i] as number;
    if (x >= loX && x <= hiX && y >= loY && y <= hiY) m += 1;
  }
  m = Math.max(m, 2);
  // About two spots of the span per cell, and no more cells along the long
  // side than spots, so a thin strip of spots does not make a huge grid.
  // Each extent has its own square root, so two tiny ones do not underflow.
  const cell = Math.max(
    Math.sqrt(2 / m) * Math.sqrt(w) * Math.sqrt(h),
    (2 * ext) / m,
  );
  if (!(cell * cell > 0)) return null;
  const gx = Math.floor(w / cell) + 1;
  const gy = Math.floor(h / cell) + 1;
  const cells = gx * gy;
  // The sizing gives at most about 1.5 cells a spot.
  if (!(cells <= 4 * n + 16)) return null;
  const cellOf = new Uint32Array(n);
  // Spots sorted by cell: those of cell k are members[start[k]..start[k+1]).
  const start = new Uint32Array(cells + 1);
  for (let i = 0; i < n; i += 1) {
    const cx = Math.max(
      0,
      Math.min(gx - 1, Math.floor(((px[i] as number) - loX) / cell)),
    );
    const cy = Math.max(
      0,
      Math.min(gy - 1, Math.floor(((py[i] as number) - loY) / cell)),
    );
    const k = cy * gx + cx;
    cellOf[i] = k;
    start[k + 1] = (start[k + 1] as number) + 1;
  }
  for (let k = 0; k < cells; k += 1) {
    start[k + 1] = (start[k + 1] as number) + (start[k] as number);
  }
  const fill = start.slice(0, cells);
  const members = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    const k = cellOf[i] as number;
    members[fill[k] as number] = i;
    fill[k] = (fill[k] as number) + 1;
  }

  // One spot per place: cell k lists places[first[k]..first[k+1]), and
  // placeOf[i] is the spot that stands for the place of spot i.
  const places = new Uint32Array(n);
  const first = new Uint32Array(cells + 1);
  const placeOf = new Uint32Array(n);
  const byPlace = (a: number, b: number) =>
    (px[a] as number) - (px[b] as number) ||
    (py[a] as number) - (py[b] as number);
  let u = 0;
  for (let k = 0; k < cells; k += 1) {
    first[k] = u;
    const s = start[k] as number;
    const e = start[k + 1] as number;
    // A crowded cell is sorted, so a repeat follows the first spot at its
    // place; in a cell of a few spots each place is checked.
    const sorted = e - s > 8;
    if (sorted) members.subarray(s, e).sort(byPlace);
    for (let m = s; m < e; m += 1) {
      const i = members[m] as number;
      let same = -1;
      const from = sorted ? Math.max(first[k] as number, u - 1) : first[k];
      for (let v = from as number; v < u; v += 1) {
        const p = places[v] as number;
        if (px[p] === px[i] && py[p] === py[i]) {
          same = p;
          break;
        }
      }
      if (same >= 0) {
        placeOf[i] = same;
      } else {
        places[u] = i;
        placeOf[i] = i;
        u += 1;
      }
    }
  }
  first[cells] = u;

  /** Distance from the place of spot q to the nearest other place. */
  const nearestTo = (q: number): number => {
    const qx = px[q] as number;
    const qy = py[q] as number;
    const k = cellOf[q] as number;
    const cx = k % gx;
    const cy = (k - cx) / gx;
    // Squared distance to the nearest place found so far.
    let best = Infinity;
    const scan = (x: number, y: number) => {
      const c = y * gx + x;
      for (let v = first[c] as number; v < (first[c + 1] as number); v += 1) {
        const j = places[v] as number;
        const dx = (px[j] as number) - qx;
        const dy = (py[j] as number) - qy;
        const d = dx * dx + dy * dy;
        if (d > 0 && d < best) best = d;
      }
    };
    for (let r = 0; ; r += 1) {
      // Ring r, clipped to the grid: on a long thin grid the rows above and
      // below are not in it, and only the two end cells are walked.
      const x0 = Math.max(0, cx - r);
      const x1 = Math.min(gx - 1, cx + r);
      if (cy - r >= 0) for (let x = x0; x <= x1; x += 1) scan(x, cy - r);
      if (r > 0 && cy + r < gy) {
        for (let x = x0; x <= x1; x += 1) scan(x, cy + r);
      }
      const y0 = Math.max(0, cy - r + 1);
      const y1 = Math.min(gy - 1, cy + r - 1);
      if (r > 0 && cx - r >= 0)
        for (let y = y0; y <= y1; y += 1) scan(cx - r, y);
      if (r > 0 && cx + r < gx)
        for (let y = y0; y <= y1; y += 1) scan(cx + r, y);
      // A spot outside the rings searched is at least r cells away.
      if (best <= (r * cell) ** 2) break;
      if (cx - r <= 0 && cy - r <= 0 && cx + r >= gx - 1 && cy + r >= gy - 1) {
        break;
      }
    }
    return Math.sqrt(best);
  };

  const dists: number[] = [];
  // Distances found so far, by the spot that stands for a place; -1 when not
  // yet searched.
  const known = new Float64Array(n).fill(-1);
  const step = Math.max(1, Math.ceil(n / maxQueries));
  for (let q = 0; q < n; q += step) {
    const p = placeOf[q] as number;
    let d = known[p] as number;
    if (d < 0) {
      d = nearestTo(p);
      known[p] = d;
    }
    if (d < Infinity) dists.push(d);
  }
  if (dists.length === 0) return null;
  dists.sort((a, b) => a - b);
  const mid = dists.length >> 1;
  return dists.length % 2
    ? (dists[mid] as number)
    : ((dists[mid - 1] as number) + (dists[mid] as number)) / 2;
}

/**
 * The 1st and 99th percentile of `values`, from at most 10,000 of them
 * spread over the input.
 */
function coreRange(values: readonly number[]): [number, number] {
  const step = Math.max(1, Math.ceil(values.length / 10_000));
  const sample = new Float64Array(Math.ceil(values.length / step));
  for (let i = 0, k = 0; i < values.length; i += step, k += 1) {
    sample[k] = values[i] as number;
  }
  sample.sort();
  const last = sample.length - 1;
  return [
    sample[Math.floor(0.01 * last)] as number,
    sample[Math.ceil(0.99 * last)] as number,
  ];
}

/**
 * Min/max of a numeric column, ignoring non-finite entries, or null when it
 * has no finite entry.
 */
function finiteExtent(col: ArrayLike<number>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** Min/max of a numeric column, ignoring non-finite entries. */
export function numericExtent(col: ArrayLike<number>): [number, number] {
  const e = finiteExtent(col);
  if (!e) return [0, 1];
  if (e[0] === e[1]) return [e[0], e[0] + 1];
  return e;
}

/** A missing value: null (R's NA), undefined, or NaN. */
export function isMissing(v: unknown): boolean {
  return v == null || (typeof v === "number" && Number.isNaN(v));
}

/**
 * Whether a color column should be read as categorical. The first value that
 * is not missing decides, since R sends a leading NA as null.
 */
export function isCategorical(
  col: unknown[] | undefined,
  mode: SpatialColorMode,
): boolean {
  if (mode === "categorical") return true;
  if (mode === "continuous") return false;
  if (!col) return false;
  for (const v of col) if (!isMissing(v)) return typeof v === "string";
  return false;
}

// One collator for every comparison: building the options per call made a
// sort of 50,000 labels take seconds.
const COLLATOR = new Intl.Collator(undefined, { numeric: true });

/** Compare category names in natural order, so "cluster 2" < "cluster 10". */
export function naturalCompare(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Sort distinct category values: numbers by value (a numeric column forced to
 * categories), text in natural order.
 */
export function sortCategories(values: Iterable<unknown>): string[] {
  const all = [...values];
  if (all.length && all.every((v) => typeof v === "number")) {
    return (all as number[]).sort((a, b) => a - b).map(String);
  }
  return all.map(String).sort(naturalCompare);
}

/**
 * The levels of a categorical colour column: the given ones, else the
 * distinct values in natural order. Missing values are not a level.
 */
export function spatialLevels(
  col: ArrayLike<unknown> | undefined,
  given?: readonly unknown[],
): string[] {
  if (given?.length) return given.map(String);
  const seen = new Map<string, unknown>();
  if (col) {
    for (let i = 0; i < col.length; i += 1) {
      const v = col[i];
      if (!isMissing(v) && !seen.has(String(v))) seen.set(String(v), v);
    }
  }
  return sortCategories(seen.values());
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSpatial: PlotomicsFactory<SpatialOptions> = (
  el,
  initial,
) => {
  let opts: SpatialOptions = mergeOptions(
    defaultSpatialOptions,
    initial.options,
  );
  let theme = resolveTheme(opts.theme);
  let sizes = textSizes(theme);
  let data: PlotomicsData = initial.data ?? { columns: {} };

  let width = 0;
  let height = 0;
  /** Width of the legend gutter right of the image, 0 without a legend. */
  let gutter = 0;
  let fit: FitTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  let image: HTMLImageElement | null = null;
  let imageUrl = "";

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

  // ---- accessors ----
  const xs = () => (data.columns.x as ArrayLike<number>) ?? [];
  const ys = () => (data.columns.y as ArrayLike<number>) ?? [];
  const colorCol = () => data.columns.color as unknown[] | undefined;
  const labels = () => (data.columns.label as string[]) ?? [];
  const imgW = () => (data.meta?.imgWidth as number) ?? 1;
  const imgH = () => (data.meta?.imgHeight as number) ?? 1;
  // The diameter derived from the spacing, kept until new data arrives.
  let derived: { data: PlotomicsData; diameter: number } | null = null;
  /** Spot diameter in image px: the given one, else from the spacing. */
  const spotD = (): number => {
    const given = data.meta?.spotDiameter;
    if (typeof given === "number" && Number.isFinite(given) && given > 0) {
      return given;
    }
    if (!derived || derived.data !== data) {
      derived = {
        data,
        diameter: medianNeighbourDistance(xs(), ys()) ?? FALLBACK_SPOT_DIAMETER,
      };
    }
    return derived.diameter;
  };

  function levels(): string[] {
    return spatialLevels(
      colorCol(),
      data.meta?.levels as unknown[] | undefined,
    );
  }
  /**
   * One colour per level: the given colours first, then the palette for any
   * level past the end of a short list.
   */
  function levelColors(n: number): string[] {
    const given = (data.meta?.colors as string[] | undefined) ?? [];
    const pal = categoricalColors(theme.categorical, n);
    return Array.from({ length: n }, (_, i) => given[i] ?? (pal[i] as string));
  }
  /** A spot's position on screen, or null when a coordinate is missing. */
  function spotAt(i: number): [number, number] | null {
    const x = xs()[i] as number | null;
    const y = ys()[i] as number | null;
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return [fit.offsetX + x * fit.scale, fit.offsetY + y * fit.scale];
  }

  // ---- image loading ----
  function ensureImage() {
    const url = (data.meta?.image as string) ?? "";
    if (url === imageUrl) return;
    imageUrl = url;
    image = null;
    if (!url) {
      render();
      return;
    }
    load(url, true);
  }
  /**
   * Load the tissue image. A cross-origin image is first asked for with CORS,
   * so drawing it keeps the canvas exportable; a server that does not send
   * CORS headers refuses that, and the image is then loaded plainly, which
   * still draws, but the exports leave it out.
   */
  function load(url: string, cors: boolean) {
    const im = new Image();
    if (cors && !url.startsWith("data:")) im.crossOrigin = "anonymous";
    im.onload = () => {
      // A late load must not paint onto a stale dataset.
      if (imageUrl === url) {
        image = im;
        render();
      }
    };
    im.onerror = () => {
      if (imageUrl !== url) return;
      if (im.crossOrigin) load(url, false);
      else render();
    };
    im.src = url;
  }

  // ---- pointer ----
  const lastPointer = { x: 0, y: 0 };
  function onMove(e: MouseEvent) {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    const { x: mx, y: my } = plot.pointer(e.clientX, e.clientY);
    const x = xs();
    const r = spotRadius(spotD(), fit.scale, opts.spotScale);
    const hitR = Math.max(r, 3);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < x.length; i += 1) {
      const at = spotAt(i);
      if (!at) continue;
      const d = Math.hypot(mx - at[0], my - at[1]);
      if (d <= hitR && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      tooltip.hide();
      return;
    }
    const col = colorCol();
    const cv = col ? col[best] : undefined;
    const lab = labels()[best];
    const head = lab ? `<b>${esc(lab)}</b><br/>` : "";
    const body = !col
      ? ""
      : isMissing(cv)
        ? "NA"
        : typeof cv === "string"
          ? esc(cv)
          : `${(cv as number).toFixed(2)}`;
    tooltip.show(head + body, lastPointer.x, lastPointer.y);
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

  /**
   * Draw the image, the spots and the legend. `target` is the canvas drawn on,
   * and `withImage` false leaves the tissue image out, with the neutral panel
   * in its place, as while it loads.
   */
  function render(target = canvas, withImage = true) {
    const ctx = target.getContext("2d");
    if (!ctx || !width || !height) return;
    const x = xs();
    const col = colorCol();
    const cat = isCategorical(col, opts.colorMode);
    const firstValue = col?.find((v) => !isMissing(v));

    // The legend comes first: its gutter decides where the image goes.
    let legendState: LegendState = null;
    if (x.length && cat && col) {
      const levs = levels();
      let missing = false;
      for (let i = 0; i < x.length; i += 1)
        if (isMissing(col[i])) missing = true;
      legendState = {
        kind: "categorical",
        levels: levs,
        colors: levelColors(levs.length),
        missing,
      };
    } else if (x.length && col && typeof firstValue === "number") {
      // The type guard matters because the option and the data arrive
      // separately: a caller switching to "continuous" gets the new option one
      // render before the numeric column replaces the categorical one, and
      // doing arithmetic on those strings yields NaN and took the panel down.
      const nums = col as unknown as ArrayLike<number>;
      // The colour bar states values the spots have: when they all have
      // one value, lo equals hi, and the bar labels that value once.
      const [lo, hi] = finiteExtent(nums) ?? [0, 1];
      let missing = false;
      for (let i = 0; i < x.length; i += 1) {
        const v = nums[i] as number;
        if (isMissing(v) || !Number.isFinite(v)) missing = true;
      }
      legendState = { kind: "continuous", lo, hi, missing };
    }
    const layout = opts.showLegend ? legendLayout(legendState) : null;
    gutter = layout?.gutter ?? 0;
    fit = fitTransform(width - gutter, height, imgW(), imgH());
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const dw = imgW() * fit.scale;
    const dh = imgH() * fit.scale;

    // Tissue underlay. While the image is still loading, a neutral panel keeps
    // the spots from floating on the page background.
    if (opts.showImage) {
      if (image && withImage) {
        ctx.globalAlpha = opts.imageOpacity;
        ctx.drawImage(image, fit.offsetX, fit.offsetY, dw, dh);
        ctx.globalAlpha = 1;
      } else if (setCanvasColour(ctx, "fillStyle", theme.grid, el)) {
        // A grid colour that paints nothing, such as "none", draws no
        // panel; var() and currentColor take the plot element's value.
        ctx.fillRect(fit.offsetX, fit.offsetY, dw, dh);
      }
    }

    if (!x.length) {
      renderOverlay(null);
      return;
    }
    const r = spotRadius(spotD(), fit.scale, opts.spotScale);

    ctx.globalAlpha = opts.spotOpacity;
    // A spot with a missing coordinate is not drawn; one with a missing colour
    // value is drawn grey and keyed "NA".
    const dot = (i: number, fill: string) => {
      const at = spotAt(i);
      if (!at) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (legendState?.kind === "categorical" && col) {
      const cols = legendState.colors;
      // Keyed by text, so numeric cluster ids match levels sent as text.
      const idx = new Map<string, number>();
      legendState.levels.forEach((lv, i) => {
        idx.set(lv, i);
      });
      for (let i = 0; i < x.length; i += 1) {
        const v = col[i];
        if (isMissing(v)) {
          dot(i, MISSING_COLOR);
          continue;
        }
        const li = idx.get(String(v));
        dot(i, li === undefined ? theme.muted : (cols[li] as string));
      }
    } else if (legendState?.kind === "continuous" && col) {
      const nums = col as unknown as ArrayLike<number>;
      const { lo, hi } = legendState;
      const fn = ramp(opts.colormap);
      // Spots of a flat range take the middle of the ramp, where the
      // colour bar labels their value.
      const flat = isFlatRange(lo, hi);
      for (let i = 0; i < x.length; i += 1) {
        const v = nums[i] as number;
        if (isMissing(v) || !Number.isFinite(v)) {
          dot(i, MISSING_COLOR);
          continue;
        }
        dot(i, fn(flat ? 0.5 : (v - lo) / (hi - lo)));
      }
    } else {
      for (let i = 0; i < x.length; i += 1) dot(i, theme.foreground);
    }
    ctx.globalAlpha = 1;

    renderOverlay(layout);
  }

  type CategoricalLegend = {
    kind: "categorical";
    levels: string[];
    colors: string[];
    missing: boolean;
  };
  type LegendState =
    | CategoricalLegend
    | { kind: "continuous"; lo: number; hi: number; missing: boolean }
    | null;

  /** A legend row: a level and its colour, or the "+N more" line (no colour). */
  type LegendRow = { label: string; color: string | null };
  /** What the overlay draws, as {@link legendLayout} fits it. */
  type LegendLayout =
    | { kind: "categorical"; rows: LegendRow[]; gutter: number }
    | {
        kind: "continuous";
        lo: number;
        hi: number;
        barH: number;
        /** Round values inside the range, and their labels. */
        ticks: number[];
        labels: string[];
        /** A flat range: one tick, at the middle of the bar. */
        flat: boolean;
        missing: boolean;
        gutter: number;
      }
    | null;

  /**
   * Fit the legend into the widget, with the width of its gutter right of
   * the image: the legend and the space around it, at most a share of the
   * widget. Null, and no gutter, when it does not fit.
   *
   * A discrete legend lists the rows the height holds (see fitLegend), and
   * cuts a long label to the gutter, but not below a few characters. The
   * colour bar is 90 px tall, or shorter to fit the height with the NA key
   * under it, down to two label heights; then the NA key goes, then the bar.
   * It labels round values inside the range, in one unit, as many as its
   * height holds a line and a half of text from each other. Its numbers are
   * not cut.
   *
   * Whether the gutter is wide enough does not depend on the height: it is
   * checked for every label the legend can show at some height, so a taller
   * widget never loses the legend.
   */
  function legendLayout(legend: LegendState): LegendLayout {
    if (!legend) return null;
    const fs = sizes.label;
    const sw = swatchSize();
    const w = (s: string) => textWidth(s, fs, theme.fontFamily);
    const cap = Math.floor(width * MAX_LEGEND_SHARE);
    if (legend.kind === "categorical") {
      const candidates = legendCandidates(
        legend.levels,
        legend.missing,
        LEGEND_MAX,
      );
      const widest = cap - 2 * LEGEND_PAD - sw - 5;
      if (!legendLabelsFit(candidates, widest, fs, theme.fontFamily)) {
        return null;
      }
      const rowH = Math.round(fs * 1.3);
      const y0 = Math.round(fs + 5);
      // Rows whose baseline is 6 px or more above the bottom, so the text
      // ends inside the widget.
      const fit = fitLegend(
        legend.levels.length,
        legend.missing,
        Math.floor((height - 6 - y0) / rowH) + 1,
        LEGEND_MAX,
      );
      const rows: LegendRow[] = legend.levels
        .slice(0, fit.shown)
        .map((label, i) => ({
          label,
          color: legend.colors[i] ?? theme.foreground,
        }));
      if (fit.more) rows.push({ label: `+${fit.more} more`, color: null });
      if (fit.missing) rows.push({ label: "NA", color: MISSING_COLOR });
      if (rows.length === 0) return null;
      const labels = rows.map((r) => r.label);
      const longest = labels.reduce((mx, s) => Math.max(mx, w(s)), 0);
      const gutter = Math.min(
        LEGEND_PAD + sw + 5 + Math.ceil(longest) + LEGEND_PAD,
        cap,
      );
      return { kind: "categorical", rows, gutter };
    }
    // The last baseline is 6 px or more above the bottom, as for the rows;
    // a label centred on the bottom of the bar has its baseline a third of
    // a label below it.
    const avail = height - 6 - BAR_TOP - Math.round(fs * 0.35);
    const naRow = naRowHeight(fs);
    const least = Math.round(fs * 2);
    const missing = legend.missing && avail - naRow >= least;
    const barH = Math.min(BAR_MAX, avail - (missing ? naRow : 0));
    const minGapPx = 1.6 * fs;
    // The gutter holds the NA key whether or not the height leaves it room.
    const gutterFor = (labelW: number) =>
      LEGEND_PAD +
      Math.ceil(
        Math.max(BAR_W + 5 + labelW, legend.missing ? sw + 5 + w("NA") : 0),
      ) +
      LEGEND_PAD;
    const widest = (labels: string[]) =>
      labels.reduce((mx, s) => Math.max(mx, w(s)), 0);
    // The gutter fits the labels of every tick count the bar can show at
    // some height up to its tallest, so a taller widget, with more ticks,
    // never loses the legend. A count whose labels the gutter cannot hold
    // is left to wider widgets: a coarser step prints shorter labels, such
    // as "0.5000" where a finer one prints "0.50005".
    const span = Math.abs(legend.hi - legend.lo);
    let labelW = 0;
    let maxCount = 1;
    for (let count = 1; count <= BAR_TICKS; count += 1) {
      const t = domainTicks(legend.lo, legend.hi, count);
      if (count > 1 && (t.step / span) * BAR_MAX < minGapPx) break;
      const tw = widest(formatTicks(t.ticks, t.step));
      if (count > 1 && gutterFor(Math.max(labelW, tw)) > cap) break;
      labelW = Math.max(labelW, tw);
      maxCount = count;
    }
    const { ticks, step } = fitDomainTicks(legend.lo, legend.hi, barH, {
      maxCount,
      minGapPx,
      endGapPx: fs + 2,
    });
    const labels = formatTicks(ticks, step);
    const gutter = gutterFor(Math.max(labelW, widest(labels)));
    if (gutter > cap || barH < least) return null;
    return {
      kind: "continuous",
      lo: legend.lo,
      hi: legend.hi,
      barH,
      ticks,
      labels,
      // A flat range has one tick and no step.
      flat: !(step > 0),
      missing,
      gutter,
    };
  }

  function renderOverlay(layout: LegendLayout) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height || !layout) return;
    const fs = sizes.label;
    const sw = swatchSize();
    // The left edge of the legend, in the gutter right of the image.
    const x0 = width - layout.gutter + LEGEND_PAD;

    if (layout.kind === "categorical") {
      const rowH = Math.round(fs * 1.3);
      const room = layout.gutter - 2 * LEGEND_PAD - sw - 5;
      let y = Math.round(fs + 5);
      for (const row of layout.rows) {
        if (row.color) swatch(x0, y, row.color);
        svg.appendChild(
          text(
            x0 + sw + 5,
            y,
            fitText(row.label, room, fs, theme.fontFamily),
            row.color ? theme.foreground : theme.muted,
            "start",
            fs,
          ),
        );
        y += rowH;
      }
    } else {
      // Colourbar: a gradient strip with round values labelled on its
      // right, each centred on its place by a short tick.
      const { barH, lo, hi } = layout;
      const y0 = BAR_TOP;
      const id = uniqueId("plotomics-spatial-grad");
      const defs = document.createElementNS(SVG_NS, "defs");
      const grad = document.createElementNS(SVG_NS, "linearGradient");
      grad.setAttribute("id", id);
      grad.setAttribute("x1", "0");
      grad.setAttribute("y1", "1");
      grad.setAttribute("x2", "0");
      grad.setAttribute("y2", "0");
      const fn = ramp(opts.colormap);
      for (let s = 0; s <= 10; s += 1) {
        const stop = document.createElementNS(SVG_NS, "stop");
        stop.setAttribute("offset", `${s * 10}%`);
        stop.setAttribute("stop-color", fn(s / 10));
        grad.appendChild(stop);
      }
      defs.appendChild(grad);
      svg.appendChild(defs);
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(x0));
      rect.setAttribute("y", String(y0));
      rect.setAttribute("width", String(BAR_W));
      rect.setAttribute("height", String(barH));
      rect.setAttribute("fill", `url(#${id})`);
      svg.appendChild(rect);
      layout.ticks.forEach((v, i) => {
        // The top of the bar is hi; the one tick of a flat range sits in
        // the middle.
        const y = y0 + (layout.flat ? 0.5 : (hi - v) / (hi - lo)) * barH;
        const mark = document.createElementNS(SVG_NS, "rect");
        mark.setAttribute("x", String(x0 + BAR_W));
        mark.setAttribute("y", String(y - 0.5));
        mark.setAttribute("width", "3");
        mark.setAttribute("height", "1");
        mark.setAttribute("fill", theme.axis);
        svg.appendChild(mark);
        svg.appendChild(
          text(
            x0 + BAR_W + 5,
            y + Math.round(fs * 0.35),
            layout.labels[i] ?? "",
            theme.muted,
            "start",
            fs,
          ),
        );
      });
      if (layout.missing) missingKey(x0, y0 + barH + naRowHeight(fs));
    }
  }

  /** Side of a legend swatch: 9 px next to the default 11 px labels. */
  function swatchSize(): number {
    return Math.round((sizes.label * 9) / 11);
  }

  /** A legend swatch beside the label whose baseline is at `y`. */
  function swatch(x: number, y: number, fill: string) {
    const sw = swatchSize();
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y - Math.round(sizes.label * 0.35 + sw / 2)));
    r.setAttribute("width", String(sw));
    r.setAttribute("height", String(sw));
    r.setAttribute("rx", "2");
    r.setAttribute("fill", fill);
    svg.appendChild(r);
  }

  /** A grey swatch and "NA", for spots whose colour value is missing. */
  function missingKey(x: number, y: number) {
    swatch(x, y, MISSING_COLOR);
    svg.appendChild(
      text(x + swatchSize() + 5, y, "NA", theme.foreground, "start"),
    );
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
    fitBox(w, h);
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    fitBox(m.width, m.height);
    layoutCanvas();
    ensureImage();
    render();
  }

  /**
   * The canvas to export. A tissue image from another origin without CORS
   * headers taints the canvas, and the browser then refuses to read it back,
   * so the spots are drawn again on a canvas of their own without the image.
   */
  function exportCanvas(): HTMLCanvasElement {
    try {
      canvas.getContext("2d")?.getImageData(0, 0, 1, 1);
      return canvas;
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== "SecurityError") {
        return canvas;
      }
      console.warn(TAINTED);
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ratio = canvas.width / Math.max(1, width);
      copy.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      render(copy, false);
      return copy;
    }
  }

  const instance: PlotomicsInstance<SpatialOptions> = {
    setData(next) {
      data = next;
      ensureImage();
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
      const source = exportCanvas();
      const out = svg.cloneNode(true) as SVGSVGElement;
      const img = document.createElementNS(SVG_NS, "image");
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(width));
      img.setAttribute("height", String(height));
      img.setAttribute("href", source.toDataURL("image/png"));
      out.insertBefore(img, out.firstChild);
      return serializeSVG(
        padSVG(out, width, height, plot.padding, theme.background),
      );
    },
    async exportPNG(scale = 2) {
      // The canvas with the legend over it.
      return compositePNG({
        width,
        height,
        scale,
        padding: plot.padding,
        background: theme.background,
        layers: [{ canvas: exportCanvas(), x: 0, y: 0, width, height }],
        overlay: svg,
      });
    },
    destroy() {
      releaseContainer(el);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      image = null;
      plot.remove();
    },
  };

  return instance;
};

/** Colour of a spot whose colour value is missing. */
const MISSING_COLOR = "#BDBDBD";
const TAINTED =
  "plotomics spatial: the tissue image comes from another origin without " +
  "CORS headers, so the browser blocks exporting it; the export shows the " +
  "spots and legend without the image.";

// ---- small utilities ----
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
  base: SpatialOptions,
  next?: Partial<SpatialOptions>,
): SpatialOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
