/**
 * Publication export helpers. A component's PNG holds its canvases and the
 * SVG overlay (axes, labels, legends) drawn over them, as on screen, with an
 * optional SVG underlay (gridlines) under them (`compositePNG`). Its SVG
 * keeps the overlay as vector and stitches each rasterized canvas in as an
 * <image>.
 */

import { dpr } from "./dom.js";
import { plainColour, resolveColour, setCanvasColour } from "./paint.js";
import type { PlotPadding } from "./theme.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Serialize an <svg> element to a standalone, namespaced SVG string. */
export function serializeSVG(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** Rasterize a canvas to a PNG Blob at an optional pixel-scale multiplier. */
export function canvasToPNG(
  canvas: HTMLCanvasElement,
  scale = 1,
): Promise<Blob | null> {
  if (scale === 1) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  const off = document.createElement("canvas");
  off.width = Math.round(canvas.width * scale);
  off.height = Math.round(canvas.height * scale);
  const ctx = off.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, off.width, off.height);
  return new Promise((resolve) => off.toBlob(resolve, "image/png"));
}

/** A canvas to draw into a composite PNG, at its place in the widget. */
export interface PNGLayer {
  canvas: HTMLCanvasElement;
  /** Left edge in the widget, in CSS px. */
  x: number;
  /** Top edge in the widget, in CSS px. */
  y: number;
  /** Width in the widget, in CSS px. */
  width: number;
  /** Height in the widget, in CSS px. */
  height: number;
  /** The part of the canvas to draw, in canvas px. All of it by default. */
  source?: { x: number; y: number; width: number; height: number };
}

/** What {@link compositePNG} draws. */
export interface CompositeOptions {
  /** Widget width in CSS px. */
  width: number;
  /** Widget height in CSS px. */
  height: number;
  /**
   * Fill under every layer: the theme background. A background that paints
   * nothing, such as "none" or "transparent", leaves the image clear there.
   */
  background: string;
  /**
   * The plot's element. A background given as var() or currentColor takes
   * the colour it has there, as on screen.
   */
  element?: Element;
  /** Canvases, bottom first. */
  layers: PNGLayer[];
  /**
   * An SVG under the canvases, such as gridlines that sit under the marks.
   * The canvases over it need a transparent background to show it.
   */
  underlay?: SVGSVGElement | null;
  /** The SVG over the canvases: axes, labels, legends. */
  overlay: SVGSVGElement | null;
  /** Multiplier on top of the device pixel ratio. Default 1. */
  scale?: number;
  /**
   * Space around the widget in CSS px, filled with the background. The
   * image grows by it, and the layers and SVGs move in by the left and top
   * padding. None by default.
   */
  padding?: PlotPadding;
}

/**
 * The widget as one PNG: the background, the SVG underlay when there is
 * one, each canvas at its place, and the SVG overlay on top, as the screen
 * shows them, with the padding around them. The image is `width` plus the
 * left and right padding, times `dpr()` times `scale`, px wide.
 * Resolves to null without a 2D context. Rejects when a layer holds a
 * cross-origin image served without CORS headers, since the browser then
 * refuses to encode the canvas.
 *
 * The overlay is drawn as an SVG image, and an SVG image cannot use a font
 * the page loaded with `@font-face`: with such a font in the theme, the
 * PNG's text falls back to the next font in the family list.
 */
export async function compositePNG(
  opts: CompositeOptions,
): Promise<Blob | null> {
  const k = dpr() * (opts.scale ?? 1);
  const pad = opts.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  // The SVGs are drawn over the whole image, the padding too, so a mark
  // that runs past the widget shows as it does on screen.
  const view = {
    x: -pad.left,
    y: -pad.top,
    width: opts.width + pad.left + pad.right,
    height: opts.height + pad.top + pad.bottom,
  };
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(view.width * k));
  out.height = Math.max(1, Math.round(view.height * k));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  // A canvas cannot read var(), and keeps black for it.
  if (setCanvasColour(ctx, "fillStyle", opts.background, opts.element)) {
    ctx.fillRect(0, 0, out.width, out.height);
  }
  // Copy the canvases before the first await: a WebGL canvas may hold its
  // frame only until the browser next paints. An underlay takes an await to
  // draw, so with one the canvases are first copied to a canvas of their
  // own. Cells and points are scaled up as they are, without smoothing.
  let marks: HTMLCanvasElement | null = null;
  let mctx = ctx;
  if (opts.underlay) {
    marks = document.createElement("canvas");
    marks.width = out.width;
    marks.height = out.height;
    const c = marks.getContext("2d");
    if (!c) return null;
    mctx = c;
  }
  mctx.imageSmoothingEnabled = false;
  for (const layer of opts.layers) {
    const { canvas } = layer;
    if (canvas.width === 0 || canvas.height === 0) continue;
    if (layer.width <= 0 || layer.height <= 0) continue;
    const s = layer.source ?? {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    };
    mctx.drawImage(
      canvas,
      s.x,
      s.y,
      s.width,
      s.height,
      (layer.x + pad.left) * k,
      (layer.y + pad.top) * k,
      layer.width * k,
      layer.height * k,
    );
  }
  if (marks && opts.underlay) {
    const image = await svgImage(
      opts.underlay,
      view,
      out.width,
      out.height,
      opts.element,
    );
    if (image) ctx.drawImage(image, 0, 0, out.width, out.height);
    ctx.drawImage(marks, 0, 0);
  }
  if (opts.overlay) {
    const image = await svgImage(
      opts.overlay,
      view,
      out.width,
      out.height,
      opts.element,
    );
    if (image) ctx.drawImage(image, 0, 0, out.width, out.height);
  }
  return new Promise((resolve, reject) => {
    try {
      out.toBlob(resolve, "image/png");
    } catch (err) {
      reject(err);
    }
  });
}

/** Half of a UTF-16 surrogate pair with no other half next to it. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The attributes of an SVG element that hold a colour. */
const COLOUR_ATTRS = ["fill", "stroke", "stop-color", "flood-color"];

/**
 * Write each colour in `svg` that depends on the page, var() and
 * currentColor, as the colour it has inside `el`, so a copy of the SVG
 * drawn away from the page, as an image or as a file, shows the colours of
 * the screen. Returns `svg`.
 */
function resolvePageColours(svg: SVGSVGElement, el: Element): SVGSVGElement {
  const seen = new Map<string, string>();
  for (const node of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const name of COLOUR_ATTRS) {
      const value = node.getAttribute(name);
      if (!value || !/var\(|currentcolor/i.test(value)) continue;
      let colour = seen.get(value);
      if (colour === undefined) {
        colour = resolveColour(value, el);
        seen.set(value, colour);
      }
      node.setAttribute(name, colour);
    }
  }
  return svg;
}

/**
 * The part `view` of an SVG element as an image `outW` x `outH` px. The
 * vector overlay is drawn at the output size, so its text stays sharp at
 * any scale. With `el`, the colours that depend on the page are read
 * there first (see {@link resolvePageColours}).
 */
async function svgImage(
  svg: SVGSVGElement,
  view: { x: number; y: number; width: number; height: number },
  outW: number,
  outH: number,
  el?: Element,
): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (el) resolvePageColours(clone, el);
  clone.setAttribute(
    "viewBox",
    `${view.x} ${view.y} ${view.width} ${view.height}`,
  );
  clone.setAttribute("preserveAspectRatio", "none");
  clone.setAttribute("width", String(outW));
  clone.setAttribute("height", String(outH));
  const image = new Image();
  try {
    // A label cut inside an emoji can end in half of a surrogate pair, which
    // encodeURIComponent refuses; it becomes U+FFFD, as in a Blob.
    const xml = serializeSVG(clone).replace(LONE_SURROGATE, "\uFFFD");
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await image.decode();
    return image;
  } catch {
    console.warn(
      "plotomics: the PNG leaves out the axes and labels, which the browser could not draw",
    );
    return null;
  }
}

/**
 * Give an exported SVG the padding of the plot. The SVG grows by the
 * padding on each side, through its size and a view box that starts at
 * minus the left and top padding, so the content keeps its coordinates. A
 * rectangle in `background` goes first and fills the whole SVG, the
 * padding too, as in the PNG. `width` and `height` are the size of the
 * content. With `el`, the plot's element, a background given as var() or
 * currentColor is written as the colour it has there, since the file is
 * read away from the page, and so is every other such colour in `svg`
 * (see {@link resolvePageColours}). Returns `svg`.
 */
export function padSVG(
  svg: SVGSVGElement,
  width: number,
  height: number,
  pad: PlotPadding,
  background: string,
  el?: Element,
): SVGSVGElement {
  const w = width + pad.left + pad.right;
  const h = height + pad.top + pad.bottom;
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `${-pad.left} ${-pad.top} ${w} ${h}`);
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(-pad.left));
  rect.setAttribute("y", String(-pad.top));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  if (el) resolvePageColours(svg, el);
  rect.setAttribute("fill", plainColour(background, el) ?? "none");
  svg.insertBefore(rect, svg.firstChild);
  return svg;
}

/** Trigger a browser download of a Blob (no-op outside a browser). */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Embed a canvas as a base64 <image> inside an SVG fragment string. */
export function canvasToSVGImage(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const href = canvas.toDataURL("image/png");
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" xlink:href="${href}" />`;
}
