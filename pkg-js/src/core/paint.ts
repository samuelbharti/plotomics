/**
 * Canvas colours from theme values that may paint nothing, or that depend on
 * the page.
 *
 * An SVG draws nothing for a stroke of "none", an empty string or a colour it
 * cannot read. A 2D canvas ignores such a value and keeps its last stroke or
 * fill style, so a line meant to be hidden takes the colour of whatever was
 * drawn before it. A canvas also cannot read var(), and it draws
 * currentColor in black, where an SVG takes the custom property and the text
 * colour of the page.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const CLEAR = "rgba(0, 0, 0, 0)";

/**
 * A colour as an SVG stroke inside `el` reads it: var() takes the custom
 * property of `el` or of the page above it, and currentColor the text colour
 * of `el`. A value the SVG draws nothing with reads "none". With `el` out of
 * the document, where nothing resolves, the colour comes back as given.
 */
export function resolveColour(colour: string, el: Element): string {
  const probe = document.createElementNS(SVG_NS, "svg");
  probe.setAttribute("width", "0");
  probe.setAttribute("height", "0");
  probe.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("stroke", colour);
  probe.appendChild(line);
  el.appendChild(probe);
  try {
    if (!line.isConnected) return colour;
    return getComputedStyle(line).stroke || colour;
  } finally {
    probe.remove();
  }
}

/**
 * The alpha of a colour as a canvas or a computed style prints it: the
 * number after the slash, as in `oklch(0.7 0.1 200 / 0)`, or the fourth
 * number of `rgba()` and `hsla()`. 1 when the colour has none.
 */
export function colourAlpha(colour: string): number {
  const c = colour.trim().toLowerCase();
  const num = "([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)(%?)";
  const m =
    new RegExp(`/\\s*${num}\\s*\\)$`).exec(c) ??
    new RegExp(`^(?:rgba|hsla)\\((?:[^,]*,){3}\\s*${num}\\s*\\)$`).exec(c);
  if (!m) return 1;
  const a = Number(m[1]);
  return m[2] ? a / 100 : a;
}

/**
 * Set `colour` as the `style` of a 2D canvas, and say whether it paints
 * anything. With `el`, the plot's element, the colour is first read as an
 * SVG stroke inside it, so var() and currentColor draw as they do in SVG.
 * "none", an empty string, a colour that cannot be read and a fully
 * transparent colour paint nothing: the style is then set to a clear
 * colour, so no mark takes an older one, and the caller can skip the marks.
 */
export function setCanvasColour(
  ctx: CanvasRenderingContext2D,
  style: "strokeStyle" | "fillStyle",
  colour: string | null | undefined,
  el?: Element,
): boolean {
  let value = (colour ?? "").trim();
  if (value && el) value = resolveColour(value, el).trim();
  if (!value || value.toLowerCase() === "none") {
    ctx[style] = CLEAR;
    return false;
  }
  // A colour the canvas cannot read leaves the style as it was. Reading it
  // back after two different starting styles separates such a colour from
  // one that equals a starting style.
  ctx[style] = "#000000";
  ctx[style] = value;
  const first = ctx[style];
  ctx[style] = "#ffffff";
  ctx[style] = value;
  const read = ctx[style];
  if (
    typeof read !== "string" ||
    read !== first ||
    colourAlpha(value) === 0 ||
    colourAlpha(read) === 0
  ) {
    ctx[style] = CLEAR;
    return false;
  }
  return true;
}

let pixelCtx: CanvasRenderingContext2D | null | undefined;

/** A 1 x 1 canvas to paint a colour on and read it back. */
function pixelContext(): CanvasRenderingContext2D | null {
  if (pixelCtx === undefined) {
    const canvas =
      typeof document === "undefined" ? null : document.createElement("canvas");
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    pixelCtx = canvas?.getContext("2d", { willReadFrequently: true }) ?? null;
  }
  return pixelCtx;
}

/**
 * The red, green, blue and alpha of `colour`, each 0 to 255, as a 2D canvas
 * paints it, after var() and currentColor are read inside `el` as
 * {@link setCanvasColour} reads them. Null for a colour that paints nothing,
 * and outside a browser.
 */
export function colourBytes(
  colour: string | null | undefined,
  el?: Element,
): [number, number, number, number] | null {
  const ctx = pixelContext();
  if (!ctx || !setCanvasColour(ctx, "fillStyle", colour, el)) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  const a = d[3] as number;
  return a === 0 ? null : [d[0] as number, d[1] as number, d[2] as number, a];
}

/** Bytes from {@link colourBytes} as a hex colour, or rgba() with an alpha. */
export function bytesToColour(rgba: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 255] = rgba;
  if (a >= 255) {
    const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

/**
 * `colour` as a hex colour, or as rgba() when it is translucent, with
 * var() and currentColor read inside `el`. Every reader takes these two
 * forms: a canvas, a WebGL library such as sigma, which reads no other,
 * and an SVG file opened away from the page, where var() means nothing.
 * Null for a colour that paints nothing. Outside a browser the colour
 * comes back as given.
 */
export function plainColour(
  colour: string | null | undefined,
  el?: Element,
): string | null {
  if (!pixelContext()) {
    const given = (colour ?? "").trim();
    return given && given.toLowerCase() !== "none" ? given : null;
  }
  const rgba = colourBytes(colour, el);
  return rgba ? bytesToColour(rgba) : null;
}
