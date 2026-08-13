/**
 * Publication export helpers. WebGL/canvas components export PNG from their
 * canvas; SVG-overlay components (axes, labels, legends) export real vector
 * SVG. Composite components can stitch a rasterized canvas into an SVG
 * <image> for a single high-DPI figure.
 */

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
