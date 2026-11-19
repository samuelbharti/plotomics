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
