/**
 * Publication export helpers. A component's PNG holds its canvases and the
 * SVG overlay (axes, labels, legends) drawn over them, as on screen
 * (`compositePNG`). Its SVG keeps the overlay as vector and stitches each
 * rasterized canvas in as an <image>.
 */

import { dpr } from "./dom.js";

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
  /** Fill under every layer: the theme background. */
  background: string;
  /** Canvases, bottom first. */
  layers: PNGLayer[];
  /** The SVG over the canvases: axes, labels, legends. */
  overlay: SVGSVGElement | null;
  /** Multiplier on top of the device pixel ratio. Default 1. */
  scale?: number;
}

/**
 * The widget as one PNG: the background, each canvas at its place, and the
 * SVG overlay on top, as the screen shows them. The image is `width` times
 * `dpr()` times `scale` px wide, the size the canvas alone used to give.
 * Resolves to null without a 2D context. Rejects when a layer holds a
 * cross-origin image served without CORS headers, since the browser then
 * refuses to encode the canvas.
 */
export async function compositePNG(
  opts: CompositeOptions,
): Promise<Blob | null> {
  const k = dpr() * (opts.scale ?? 1);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(opts.width * k));
  out.height = Math.max(1, Math.round(opts.height * k));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, out.width, out.height);
  // Copy the canvases before the first await: a WebGL canvas may hold its
  // frame only until the browser next paints. Cells and points are scaled
  // up as they are, without smoothing.
  ctx.imageSmoothingEnabled = false;
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
    ctx.drawImage(
      canvas,
      s.x,
      s.y,
      s.width,
      s.height,
      layer.x * k,
      layer.y * k,
      layer.width * k,
      layer.height * k,
    );
  }
  if (opts.overlay) {
    const image = await svgImage(
      opts.overlay,
      opts.width,
      opts.height,
      out.width,
      out.height,
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

/**
 * An SVG element as an image `outW` x `outH` px. The vector overlay is drawn
 * at the output size, so its text stays sharp at any scale.
 */
async function svgImage(
  svg: SVGSVGElement,
  width: number,
  height: number,
  outW: number,
  outH: number,
): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.setAttribute("preserveAspectRatio", "none");
  clone.setAttribute("width", String(outW));
  clone.setAttribute("height", String(outH));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    serializeSVG(clone),
  )}`;
  try {
    await image.decode();
    return image;
  } catch {
    console.warn(
      "plotomics: the PNG leaves out the axes and labels, which the browser could not draw",
    );
    return null;
  }
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
