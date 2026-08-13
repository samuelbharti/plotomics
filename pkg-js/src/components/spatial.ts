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
  createTooltip,
  type Tooltip,
  measure,
  dpr,
  serializeSVG,
  canvasToPNG,
  ramp,
  OKABE_ITO,
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
export function spotRadius(diameter: number, scale: number, spotScale: number): number {
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

/** Whether a color column should be read as categorical. */
export function isCategorical(
  col: unknown[] | undefined,
  mode: SpatialColorMode,
): boolean {
  if (mode === "categorical") return true;
  if (mode === "continuous") return false;
  if (!col || col.length === 0) return false;
  return typeof col[0] === "string";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSpatial: PlotomicsFactory<SpatialOptions> = (el, initial) => {
  let opts: SpatialOptions = mergeOptions(defaultSpatialOptions, initial.options);
  let theme = resolveTheme(opts.theme);
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
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
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
    const given = data.meta?.levels as string[] | undefined;
    if (given && given.length) return given;
    const col = (colorCol() as string[] | undefined) ?? [];
    const seen: string[] = [];
    for (const v of col) if (!seen.includes(v)) seen.push(v);
    return seen.sort();
  }
  function levelColors(n: number): string[] {
    const given = data.meta?.colors as string[] | undefined;
    if (given && given.length) return given;
    const pal = theme.categorical?.length ? theme.categorical : OKABE_ITO;
    return Array.from({ length: n }, (_, i) => pal[i % pal.length] as string);
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
    const im = new Image();
    im.onload = () => {
      // A late load must not paint onto a stale dataset.
      if (imageUrl === url) {
        image = im;
        render();
      }
    };
    im.onerror = () => {
      if (imageUrl === url) render();
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
    const y = ys();
    const r = spotRadius(spotD(), fit.scale, opts.spotScale);
    const hitR = Math.max(r, 3);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < x.length; i += 1) {
      const px = fit.offsetX + (x[i] as number) * fit.scale;
      const py = fit.offsetY + (y[i] as number) * fit.scale;
      const d = Math.hypot(mx - px, my - py);
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
    const body =
      cv === undefined
        ? ""
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
    ctx.globalAlpha = opts.spotOpacity;
    if (cat && col) {
      const levs = levels();
      const cols = levelColors(levs.length);
      const idx = new Map<string, number>();
      levs.forEach((lv, i) => {
        idx.set(lv, i);
      });
      for (let i = 0; i < x.length; i += 1) {
        const li = idx.get(col[i] as string);
        ctx.fillStyle = li === undefined ? theme.muted : (cols[li] as string);
        ctx.beginPath();
        ctx.arc(
          fit.offsetX + (x[i] as number) * fit.scale,
          fit.offsetY + (y[i] as number) * fit.scale,
          r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      legendState = { kind: "categorical", levels: levs, colors: cols };
    } else if (col && typeof (col as ArrayLike<unknown>)[0] === "number") {
      // The type guard matters because the option and the data arrive
      // separately: a caller switching to "continuous" gets the new option one
      // render before the numeric column replaces the categorical one, and
      // doing arithmetic on those strings yields NaN and took the panel down.
      const nums = col as unknown as ArrayLike<number>;
      const [lo, hi] = numericExtent(nums);
      const fn = ramp(opts.colormap);
      const span = hi - lo || 1;
      for (let i = 0; i < x.length; i += 1) {
        ctx.fillStyle = fn(((nums[i] as number) - lo) / span);
        ctx.beginPath();
        ctx.arc(
          fit.offsetX + (x[i] as number) * fit.scale,
          fit.offsetY + (y[i] as number) * fit.scale,
          r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      legendState = { kind: "continuous", lo, hi };
    } else {
      ctx.fillStyle = theme.foreground;
      for (let i = 0; i < x.length; i += 1) {
        ctx.beginPath();
        ctx.arc(
          fit.offsetX + (x[i] as number) * fit.scale,
          fit.offsetY + (y[i] as number) * fit.scale,
          r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    renderOverlay(legendState);
  }

  type LegendState =
    | { kind: "categorical"; levels: string[]; colors: string[] }
    | { kind: "continuous"; lo: number; hi: number }
    | null;

  function renderOverlay(legend: LegendState) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!width || !height || !opts.showLegend || !legend) return;

    if (legend.kind === "categorical") {
      const shown = legend.levels.slice(0, LEGEND_MAX);
      let y = 16;
      for (let i = 0; i < shown.length; i += 1) {
        const sw = document.createElementNS(SVG_NS, "rect");
        sw.setAttribute("x", String(width - 128));
        sw.setAttribute("y", String(y - 8));
        sw.setAttribute("width", "9");
        sw.setAttribute("height", "9");
        sw.setAttribute("rx", "2");
        sw.setAttribute("fill", legend.colors[i] ?? theme.foreground);
        svg.appendChild(sw);
        svg.appendChild(
          text(width - 114, y, shown[i] ?? "", theme.foreground, "start", 10),
        );
        y += 14;
      }
      if (legend.levels.length > shown.length) {
        svg.appendChild(
          text(width - 114, y, `+${legend.levels.length - shown.length} more`,
            theme.muted, "start", 10),
        );
      }
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
      svg.appendChild(text(x0 - 4, y0 + 8, fmt(legend.hi), theme.muted, "end", 9));
      svg.appendChild(text(x0 - 4, y0 + barH, fmt(legend.lo), theme.muted, "end", 9));
    }
  }

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
      image = null;
      canvas.remove();
      svg.remove();
    },
  };

  return instance;
};

let gradSeq = 0;

// ---- small utilities ----
function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000 || (a < 0.01 && a > 0)) return v.toExponential(1);
  return Number(v.toFixed(2)).toString();
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function mergeOptions(base: SpatialOptions, next?: Partial<SpatialOptions>): SpatialOptions {
  if (!next) return { ...base };
  return { ...base, ...next, theme: { ...base.theme, ...(next.theme ?? {}) } };
}
