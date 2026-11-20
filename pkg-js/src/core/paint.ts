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
 *
 * A colour the page cannot read at all, such as an undefined custom property
 * or a name CSS lacks (R's "grey50"), paints nothing on a canvas, and an SVG
 * draws it black. Such a colour paints nothing in either, and a console
 * warning names it once, so a missing group can be traced to its colour.
 */

import { type PlotomicsTheme, darkTheme, defaultTheme } from "./theme.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CLEAR = "rgba(0, 0, 0, 0)";
/**
 * The stroke of the probe's parent. A colour the SVG cannot read leaves the
 * probe line to inherit it, which separates such a colour from "none".
 */
const UNREAD = "rgba(1, 2, 3, 0.012)";

/**
 * A colour as an SVG stroke inside `el` reads it, as the computed stroke:
 * "none" for a colour that paints nothing, null for one the SVG cannot
 * read, and undefined with `el` out of the document, where nothing
 * resolves.
 */
function readColour(colour: string, el: Element): string | null | undefined {
  const probe = document.createElementNS(SVG_NS, "svg");
  probe.setAttribute("width", "0");
  probe.setAttribute("height", "0");
  probe.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;" +
    `pointer-events:none;stroke:${UNREAD};`;
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("stroke", colour);
  probe.appendChild(line);
  el.appendChild(probe);
  try {
    if (!line.isConnected) return undefined;
    const stroke = getComputedStyle(line).stroke;
    if (!stroke) return undefined;
    return stroke === getComputedStyle(probe).stroke ? null : stroke;
  } finally {
    probe.remove();
  }
}

/**
 * A colour as an SVG stroke inside `el` reads it: var() takes the custom
 * property of `el` or of the page above it, and currentColor the text colour
 * of `el`. A value the SVG draws nothing with, or cannot read, reads
 * "none". With `el` out of the document, where nothing resolves, the colour
 * comes back as given.
 */
export function resolveColour(colour: string, el: Element): string {
  const read = readColour(colour, el);
  return read === undefined ? colour : (read ?? "none");
}

/** Colours already named in a warning, so each is named once. */
const warned = new Set<string>();

/**
 * Warn once, naming `colour`, that the page cannot read it. "none",
 * "transparent" and a clear colour are not warned about: they paint nothing
 * on purpose.
 */
function warnUnreadable(colour: string): void {
  if (warned.has(colour)) return;
  warned.add(colour);
  console.warn(
    `plotomics: the page cannot read the colour ${JSON.stringify(colour)} ` +
      "(an undefined custom property, or a colour name CSS does not have), " +
      "so the marks, keys and labels in it are left out.",
  );
}

/** The attributes of an SVG element that hold a colour. */
const COLOUR_ATTRS = ["fill", "stroke", "stop-color", "flood-color"];
/** Colours every page reads as they are, with nothing to check. */
const PLAIN =
  /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([^)]*\)|none|transparent|currentcolor|url\(.*\))$/i;

/** The role a text colour has in a theme. */
export type TextRole = "foreground" | "muted" | "axis";

/**
 * The colour text of `role` takes when its own colour cannot be read: that
 * of the default theme, or of the dark default on a dark `background`, so
 * the text stays readable on the plot. A background that paints nothing
 * counts as light.
 */
export function textFallback(
  role: TextRole,
  background: string,
  el?: Element,
): string {
  const bg = colourBytes(background, el);
  const dark = !!bg && bg[3] === 255 && luminance(bg) < 0.18;
  return (dark ? darkTheme : defaultTheme)[role];
}

/**
 * Give every colour in the SVG `layers` that the page cannot read inside
 * `el` another value, and warn once, naming it. A mark, a key or a fill
 * takes "none", as the canvas leaves out the marks in such a colour, so a
 * key never stands for marks that were not drawn. Text never disappears:
 * its fill takes the colour of the default theme for its role (see
 * {@link textFallback}), the muted or the axis colour when the colour is
 * the theme's, else the foreground. An SVG drew such a colour black on
 * screen, and the exports wrote "none"; now the screen and the exports
 * agree. Colours that read, var() among them, stay as given.
 */
export function hideUnreadableColours(
  el: Element,
  theme: Pick<PlotomicsTheme, "background" | "muted" | "axis">,
  ...layers: (Element | null | undefined)[]
): void {
  if (!el.isConnected) return;
  const readable = new Map<string, boolean>();
  const fallbacks = new Map<string, string>();
  const textColour = (value: string) => {
    let colour = fallbacks.get(value);
    if (colour === undefined) {
      const role: TextRole =
        value === theme.muted?.trim()
          ? "muted"
          : value === theme.axis?.trim()
            ? "axis"
            : "foreground";
      colour = textFallback(role, theme.background, el);
      fallbacks.set(value, colour);
    }
    return colour;
  };
  for (const layer of layers) {
    if (!layer) continue;
    for (const node of [layer, ...Array.from(layer.querySelectorAll("*"))]) {
      for (const name of COLOUR_ATTRS) {
        const value = node.getAttribute(name)?.trim();
        if (!value || PLAIN.test(value)) continue;
        let ok = readable.get(value);
        if (ok === undefined) {
          ok = readColour(value, el) !== null;
          readable.set(value, ok);
          if (!ok) warnUnreadable(value);
        }
        if (ok) continue;
        const text = /^(text|tspan)$/i.test(node.tagName) && name === "fill";
        node.setAttribute(name, text ? textColour(value) : "none");
      }
    }
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
 * A colour that cannot be read is named in a console warning, once.
 */
export function setCanvasColour(
  ctx: CanvasRenderingContext2D,
  style: "strokeStyle" | "fillStyle",
  colour: string | null | undefined,
  el?: Element,
): boolean {
  const given = (colour ?? "").trim();
  let value = given;
  if (value && el) {
    const read = readColour(value, el);
    if (read === null) {
      ctx[style] = CLEAR;
      warnUnreadable(given);
      return false;
    }
    if (read !== undefined) value = read.trim();
  }
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
  if (typeof read !== "string" || read !== first) {
    ctx[style] = CLEAR;
    // var() out of the page has nothing to read yet; the page may give it
    // a value once the plot is in it.
    if (!/var\(/i.test(given) || el?.isConnected) warnUnreadable(given);
    return false;
  }
  if (colourAlpha(value) === 0 || colourAlpha(read) === 0) {
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

/** A hex colour, which needs no reading inside the page. */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `colour` as a 2D canvas reads it, with var() and currentColor read inside
 * `el` as {@link setCanvasColour} reads them: a fill or stroke style to set
 * as it is, or null for a colour that paints nothing, whose marks the
 * caller leaves out. Outside a browser the colour comes back as given.
 */
export function canvasColour(
  colour: string | null | undefined,
  el?: Element,
): string | null {
  const ctx = pixelContext();
  const given = (colour ?? "").trim();
  if (!ctx) return given && given.toLowerCase() !== "none" ? given : null;
  const where = HEX.test(given) ? undefined : el;
  return setCanvasColour(ctx, "fillStyle", given, where)
    ? String(ctx.fillStyle)
    : null;
}

/**
 * A reader of colours for one draw: {@link canvasColour} of each colour,
 * read once and kept, so a colour that many marks share reads the page
 * once. Take a new reader for each draw, as a page can change a custom
 * property between draws.
 */
export function canvasColours(
  el?: Element,
): (colour: string | null | undefined) => string | null {
  const seen = new Map<string, string | null>();
  return (colour) => {
    const key = colour ?? "";
    let value = seen.get(key);
    if (value === undefined) {
      value = canvasColour(colour, el);
      seen.set(key, value);
    }
    return value;
  };
}

/**
 * Relative luminance of a colour given as bytes, from 0 for black to 1 for
 * white (WCAG 2).
 */
export function luminance(rgb: readonly number[]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * lin(rgb[0] ?? 0) +
    0.7152 * lin(rgb[1] ?? 0) +
    0.0722 * lin(rgb[2] ?? 0)
  );
}

/**
 * The theme background for regl-scatterplot: red, green, blue and alpha,
 * each from 0 to 1, a form it reads for any colour, where it reads only hex
 * in a string. var() and currentColor are read inside `el`.
 * regl-scatterplot styles its lasso for a light or a dark plot from this
 * colour. A background that paints nothing, such as "transparent", shows
 * the page, so it gives white when the theme foreground is dark, as on a
 * light page, and black when the foreground is light.
 */
export function scatterBackground(
  theme: { background: string; foreground: string },
  el?: Element,
): [number, number, number, number] {
  const rgba = colourBytes(theme.background, el);
  if (rgba) {
    return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
  }
  const fg = colourBytes(theme.foreground, el);
  // White and black read equally well on a luminance of about 0.18.
  return fg && luminance(fg) >= 0.18 ? [0, 0, 0, 1] : [1, 1, 1, 1];
}

/**
 * A point colour for regl-scatterplot: red, green, blue and alpha, each from
 * 0 to 1, after var() and currentColor are read inside `el`.
 * regl-scatterplot reads hex and such arrays only, and paints any other
 * colour, var() among them, white. A colour that paints nothing gives a
 * clear colour.
 */
export function scatterColour(
  colour: string | null | undefined,
  el?: Element,
): [number, number, number, number] {
  const rgba = colourBytes(
    colour,
    HEX.test((colour ?? "").trim()) ? undefined : el,
  );
  return rgba
    ? [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255]
    : [0, 0, 0, 0];
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
