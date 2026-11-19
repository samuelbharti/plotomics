/**
 * Canvas colours from theme values that may paint nothing.
 *
 * An SVG draws nothing for a stroke of "none", an empty string or a colour it
 * cannot read. A 2D canvas ignores such a value and keeps its last stroke or
 * fill style, so a line meant to be hidden takes the colour of whatever was
 * drawn before it.
 */

const CLEAR = "rgba(0, 0, 0, 0)";

/**
 * Set `colour` as the `style` of a 2D canvas, and say whether it paints
 * anything. "none", an empty string, a colour the canvas cannot read and a
 * fully transparent colour paint nothing: the style is then set to a clear
 * colour, so no mark takes an older one, and the caller can skip the marks.
 */
export function setCanvasColour(
  ctx: CanvasRenderingContext2D,
  style: "strokeStyle" | "fillStyle",
  colour: string | null | undefined,
): boolean {
  const value = (colour ?? "").trim();
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
  // The canvas prints a colour with an alpha below 1 as rgba(r, g, b, a).
  const alpha =
    typeof read === "string" ? /,\s*([\d.e-]+)\s*\)$/.exec(read) : null;
  if (
    typeof read !== "string" ||
    read !== first ||
    (alpha !== null && Number(alpha[1]) === 0)
  ) {
    ctx[style] = CLEAR;
    return false;
  }
  return true;
}
