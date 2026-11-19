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
 * colouring spots by cluster and by a gene's expression.
 *
 * ## Data contract
 * - `columns.x`, `columns.y`  `number[]`  spot centres in IMAGE pixel
 *                                          coordinates (required)
 * - `columns.color`  `string[] | number[]`  strings categorical, numbers continuous
 * - `columns.label`  `string[]`  optional per-spot tooltip label
 * - `meta.image`         `string`  URL of the tissue image
 * - `meta.imgWidth` / `meta.imgHeight`  `number`  its natural size
 * - `meta.spotDiameter`  `number`  spot diameter in image pixels
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
  type Tooltip,
  measure,
  releaseContainer,
  textWidth,
  dpr,
  serializeSVG,
  compositePNG,
  ramp,
  categoricalColors,
} from "../core/index.js";

export type SpatialColorMode = "auto" | "categorical" | "continuous";

export interface SpatialOptions {
  /** How to interpret the `color` column. `"auto"` detects from its type. */
  colorMode: SpatialColorMode;
  /** Sequential ramp used for continuous colouring. */
  colormap: RampName;
  /** Multiplier on `meta.spotDiameter`; 1 draws spots at their true size. */
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

/** Min/max of a numeric column, ignoring non-finite entries. */
export function numericExtent(col: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo, lo + 1];
  return [lo, hi];
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
  let fit: FitTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  let image: HTMLImageElement | null = null;
  let imageUrl = "";

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
  const xs = () => (data.columns.x as ArrayLike<number>) ?? [];
  const ys = () => (data.columns.y as ArrayLike<number>) ?? [];
  const colorCol = () => data.columns.color as unknown[] | undefined;
  const labels = () => (data.columns.label as string[]) ?? [];
  const imgW = () => (data.meta?.imgWidth as number) ?? 1;
  const imgH = () => (data.meta?.imgHeight as number) ?? 1;
  const spotD = () => (data.meta?.spotDiameter as number) ?? 4;

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
   * still draws but blocks export.
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
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
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

  function render() {
    const ctx = canvas.getContext("2d");
    if (!ctx || !width || !height) return;
    fit = fitTransform(width, height, imgW(), imgH());
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    const dw = imgW() * fit.scale;
    const dh = imgH() * fit.scale;

    // Tissue underlay. While the image is still loading, a neutral panel keeps
    // the spots from floating on the page background.
    if (opts.showImage) {
      if (image) {
        ctx.globalAlpha = opts.imageOpacity;
        ctx.drawImage(image, fit.offsetX, fit.offsetY, dw, dh);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = theme.grid;
        ctx.fillRect(fit.offsetX, fit.offsetY, dw, dh);
      }
    }

    const x = xs();
    const y = ys();
    if (!x.length) {
      renderOverlay(null);
      return;
    }
    const col = colorCol();
    const cat = isCategorical(col, opts.colorMode);
    const r = spotRadius(spotD(), fit.scale, opts.spotScale);

    let legendState: LegendState = null;
    let anyMissing = false;
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
    const firstValue = col?.find((v) => !isMissing(v));
    if (cat && col) {
      const levs = levels();
      const cols = levelColors(levs.length);
      // Keyed by text, so numeric cluster ids match levels sent as text.
      const idx = new Map<string, number>();
      levs.forEach((lv, i) => {
        idx.set(lv, i);
      });
      for (let i = 0; i < x.length; i += 1) {
        const v = col[i];
        if (isMissing(v)) {
          anyMissing = true;
          dot(i, MISSING_COLOR);
          continue;
        }
        const li = idx.get(String(v));
        dot(i, li === undefined ? theme.muted : (cols[li] as string));
      }
      legendState = { kind: "categorical", levels: levs, colors: cols };
    } else if (col && typeof firstValue === "number") {
      // The type guard matters because the option and the data arrive
      // separately: a caller switching to "continuous" gets the new option one
      // render before the numeric column replaces the categorical one, and
      // doing arithmetic on those strings yields NaN and took the panel down.
      const nums = col as unknown as ArrayLike<number>;
      const [lo, hi] = numericExtent(nums);
      const fn = ramp(opts.colormap);
      const span = hi - lo || 1;
      for (let i = 0; i < x.length; i += 1) {
        const v = nums[i] as number;
        if (isMissing(v) || !Number.isFinite(v)) {
          anyMissing = true;
          dot(i, MISSING_COLOR);
          continue;
        }
        dot(i, fn((v - lo) / span));
      }
      legendState = { kind: "continuous", lo, hi };
    } else {
      for (let i = 0; i < x.length; i += 1) dot(i, theme.foreground);
    }
    ctx.globalAlpha = 1;
    if (legendState) legendState.missing = anyMissing;

    renderOverlay(legendState);
  }

  type LegendState =
    | {
        kind: "categorical";
        levels: string[];
        colors: string[];
        missing?: boolean;
      }
    | { kind: "continuous"; lo: number; hi: number; missing?: boolean }
    | null;

  function renderOverlay(legend: LegendState) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height || !opts.showLegend || !legend) return;
    const fs = sizes.label;
    const sw = swatchSize();

    if (legend.kind === "categorical") {
      const rowH = Math.round(fs * 1.3);
      const y0 = Math.round(fs + 5);
      // Rows the height holds. When the list would run past it, fewer levels
      // are listed and the rest go into the "+N more" line.
      const n = legend.levels.length;
      const fit = Math.max(1, Math.floor((height - 6 - y0) / rowH) + 1);
      const extra = legend.missing ? 1 : 0;
      const rowsFor = (cap: number) =>
        Math.min(n, cap) + (n > cap ? 1 : 0) + extra;
      let cap = LEGEND_MAX;
      if (rowsFor(cap) > fit) cap = Math.max(1, fit - 1 - extra);
      const shown = legend.levels.slice(0, cap);
      const more = n > shown.length ? `+${n - shown.length} more` : "";
      // The legend starts 128 px from the right edge, or further left when
      // its longest entry needs the room.
      const longest = [...shown, more, legend.missing ? "NA" : ""].reduce(
        (mx, s) => Math.max(mx, textWidth(s, fs, theme.fontFamily)),
        0,
      );
      const x0 = width - Math.max(128, sw + 5 + Math.ceil(longest) + 8);
      let y = y0;
      for (let i = 0; i < shown.length; i += 1) {
        swatch(x0, y, legend.colors[i] ?? theme.foreground);
        svg.appendChild(
          text(x0 + sw + 5, y, shown[i] ?? "", theme.foreground, "start", fs),
        );
        y += rowH;
      }
      if (more) {
        svg.appendChild(text(x0 + sw + 5, y, more, theme.muted, "start", fs));
        y += rowH;
      }
      if (legend.missing) missingKey(x0, y);
    } else {
      // Colourbar: a gradient strip with its two ends labelled.
      const barH = 90;
      const x0 = width - 40;
      const y0 = 18;
      const id = `plotomics-spatial-grad-${gradSeq++}`;
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
      rect.setAttribute("width", "10");
      rect.setAttribute("height", String(barH));
      rect.setAttribute("fill", `url(#${id})`);
      svg.appendChild(rect);
      // The top label's cap height lines up with the top of the bar.
      svg.appendChild(
        text(
          x0 - 4,
          y0 + Math.round(fs * 0.75),
          fmt(legend.hi),
          theme.muted,
          "end",
          fs,
        ),
      );
      svg.appendChild(
        text(x0 - 4, y0 + barH, fmt(legend.lo), theme.muted, "end", fs),
      );
      if (legend.missing) {
        // Under the bar, moved left when "NA" would pass the right edge.
        const keyW = sw + 5 + textWidth("NA", fs, theme.fontFamily);
        missingKey(
          Math.min(x0, Math.floor(width - 6 - keyW)),
          y0 + barH + Math.round(fs + 7),
        );
      }
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
    width = w;
    height = h;
    layoutCanvas();
    render();
  }

  {
    const m = measure(el);
    width = m.width;
    height = m.height;
    layoutCanvas();
    ensureImage();
    render();
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
      render();
    },
    resize(w, h) {
      doResize(w, h);
    },
    exportSVG() {
      const out = svg.cloneNode(true) as SVGSVGElement;
      let href = "";
      try {
        href = canvas.toDataURL("image/png");
      } catch {
        // A cross-origin image without CORS headers taints the canvas.
        console.warn(TAINTED);
      }
      if (href) {
        const img = document.createElementNS(SVG_NS, "image");
        img.setAttribute("x", "0");
        img.setAttribute("y", "0");
        img.setAttribute("width", String(width));
        img.setAttribute("height", String(height));
        img.setAttribute("href", href);
        out.insertBefore(img, out.firstChild);
      }
      return serializeSVG(out);
    },
    async exportPNG(scale = 2) {
      try {
        // The canvas with the legend over it.
        return await compositePNG({
          width,
          height,
          scale,
          background: theme.background,
          layers: [{ canvas, x: 0, y: 0, width, height }],
          overlay: svg,
        });
      } catch {
        console.warn(TAINTED);
        return null;
      }
    },
    destroy() {
      releaseContainer(el);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      tooltip.destroy();
      image = null;
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

let gradSeq = 0;

/** Colour of a spot whose colour value is missing. */
const MISSING_COLOR = "#BDBDBD";
const TAINTED =
  "plotomics spatial: the tissue image comes from another origin without " +
  "CORS headers, so the browser blocks exporting the canvas; the export " +
  "leaves out the image and spots.";

// ---- small utilities ----
function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000 || (a < 0.01 && a > 0)) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
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
  base: SpatialOptions,
  next?: Partial<SpatialOptions>,
): SpatialOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
