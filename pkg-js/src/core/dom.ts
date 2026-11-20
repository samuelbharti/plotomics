/** Small DOM helpers shared by components (tooltip, sizing, element reset). */

import {
  type PlotPadding,
  type PlotomicsTheme,
  themePadding,
} from "./theme.js";

export function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export interface Tooltip {
  show(html: string, clientX: number, clientY: number): void;
  hide(): void;
  destroy(): void;
}

/** Space in px between the pointer and its tooltip. */
const TIP_OFFSET = 12;
/** The widest a tooltip grows, in px. Longer text wraps. */
const TIP_MAX_WIDTH = 320;

/**
 * Where a tooltip `size` px long starts along one side of a widget `room`
 * px long, for the pointer at `at`: `TIP_OFFSET` px past the pointer,
 * or as far before it when it would run past the end. When neither side has
 * the room, it is kept inside the widget, against its end, and a tooltip
 * longer than the widget starts at 0.
 */
export function tipStart(at: number, size: number, room: number): number {
  const after = at + TIP_OFFSET;
  if (after + size <= room) return after;
  const before = at - TIP_OFFSET - size;
  if (before >= 0) return before;
  return Math.max(0, room - size);
}

/**
 * Where a tooltip `w` x `h` px goes in a widget `roomW` x `roomH` px, for
 * the pointer at (`x`, `y`): along each side as {@link tipStart} places it.
 * That covers the pointer only when the tooltip fits on neither side of it
 * along either axis. It then moves below or above the pointer, whichever
 * runs less past the widget (below on a tie), and stays inside the widget
 * across. A move to the right or the left would run past the widget there
 * too, and past the right of the page it would give the page a horizontal
 * scroll.
 */
export function tipPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  roomW: number,
  roomH: number,
): { left: number; top: number } {
  const left = tipStart(x, w, roomW);
  const top = tipStart(y, h, roomH);
  const covers = left <= x && x <= left + w && top <= y && y <= top + h;
  if (!covers) return { left, top };
  const below = y + TIP_OFFSET;
  const above = y - TIP_OFFSET - h;
  return { left, top: -above < below + h - roomH ? above : below };
}

/**
 * A lightweight absolutely-positioned tooltip anchored to a container. It
 * sits right of and below the pointer, and flips to the left or above it
 * near the right or bottom edge, so it stays inside the container and off
 * the pointer. Text wider than 320 px, or than the container, wraps.
 */
export function createTooltip(
  container: HTMLElement,
  theme: PlotomicsTheme,
): Tooltip {
  const tip = document.createElement("div");
  Object.assign(tip.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "10",
    padding: "6px 8px",
    borderRadius: "4px",
    font: `${theme.fontSize}px ${theme.fontFamily}`,
    background: "rgba(17,24,39,0.92)",
    color: "#fff",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    opacity: "0",
    transition: "opacity 80ms ease",
    left: "0px",
    top: "0px",
    boxSizing: "border-box",
    maxWidth: `${TIP_MAX_WIDTH}px`,
    whiteSpace: "normal",
    overflowWrap: "break-word",
  } satisfies Partial<CSSStyleDeclaration>);
  // The container must be a positioning context.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  // The tip goes first, before the frame of the plot (see createPlotBox),
  // so it stays the first div in the container.
  container.insertBefore(tip, container.firstChild);

  return {
    show(html, clientX, clientY) {
      tip.innerHTML = html;
      // Measured at the top left corner, where it has the whole width of
      // the container, so its text wraps only past the widest it may be.
      const roomW = container.clientWidth;
      const roomH = container.clientHeight;
      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.style.width = "";
      const widest = roomW > 0 ? Math.min(TIP_MAX_WIDTH, roomW) : TIP_MAX_WIDTH;
      tip.style.maxWidth = `${widest}px`;
      // The width it takes there is fixed, rounded up to a whole px, so its
      // text wraps the same wherever it goes. offsetWidth rounds to the
      // nearest px, and a tip placed against the right edge a fraction
      // narrower than its text wrapped one more line, after it was placed.
      const w = Math.ceil(boxSize(tip, "width"));
      tip.style.width = `${w}px`;
      const h = Math.ceil(boxSize(tip, "height"));
      // The pointer from the padding box of the container, where the tip is
      // placed, inside any border.
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left - container.clientLeft;
      const y = clientY - rect.top - container.clientTop;
      let at = tipPosition(x, y, w, h, roomW, roomH);
      tip.style.left = `${at.left}px`;
      tip.style.top = `${at.top}px`;
      // Placed again if its height changed after all.
      const placedH = Math.ceil(boxSize(tip, "height"));
      if (placedH !== h) {
        at = tipPosition(x, y, w, placedH, roomW, roomH);
        tip.style.left = `${at.left}px`;
        tip.style.top = `${at.top}px`;
      }
      tip.style.opacity = "1";
    },
    hide() {
      tip.style.opacity = "0";
    },
    destroy() {
      tip.remove();
    },
  };
}

/**
 * The width or height of `el` in CSS px, with its fraction, from its
 * computed style: unlike getBoundingClientRect, it is not scaled by a CSS
 * transform on the page. With no number there, offsetWidth or offsetHeight.
 */
function boxSize(el: HTMLElement, side: "width" | "height"): number {
  const v = Number.parseFloat(getComputedStyle(el)[side]);
  if (Number.isFinite(v)) return v;
  return side === "width" ? el.offsetWidth : el.offsetHeight;
}

/**
 * The frame of a plot and the box in it that holds the plot's layers.
 *
 * The frame fills the element's padding box and takes the theme
 * background. The box sits the theme padding in from each side of the
 * frame, so every layer in it, and every coordinate a layer draws at,
 * starts inside the padding.
 */
export interface PlotBox {
  /** The element the plot's layers go in. */
  readonly box: HTMLDivElement;
  /** The padding in px, from the last {@link PlotBox.fit}. */
  readonly padding: PlotPadding;
  /**
   * Place the box in an element `width` x `height` px, with the padding and
   * the background of `theme`. Returns the size of the box: the size of the
   * element less the padding, never below 0.
   */
  fit(
    width: number,
    height: number,
    theme: Pick<PlotomicsTheme, "padding" | "background">,
  ): { width: number; height: number };
  /**
   * The point `clientX`, `clientY` in px from the top left corner of the
   * box. It is read from the box itself, so it lines up with the layers in
   * an element with a CSS border too.
   */
  pointer(clientX: number, clientY: number): { x: number; y: number };
  /** Remove the frame and the layers in it. */
  remove(): void;
}

/**
 * Add the frame of a plot to `el`, with the box for its layers inside
 * (see {@link PlotBox}). Call `fit` with the size of the element and the
 * theme before the first draw, and again on each resize and new theme.
 */
export function createPlotBox(el: HTMLElement): PlotBox {
  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;inset:0;";
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;left:0;top:0;";
  frame.appendChild(box);
  el.appendChild(frame);
  let padding: PlotPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    box,
    get padding() {
      return padding;
    },
    fit(width, height, theme) {
      padding = themePadding(theme);
      frame.style.background = theme.background;
      const w = Math.max(0, width - padding.left - padding.right);
      const h = Math.max(0, height - padding.top - padding.bottom);
      box.style.left = `${padding.left}px`;
      box.style.top = `${padding.top}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      return { width: w, height: h };
    },
    pointer(clientX, clientY) {
      const r = box.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    },
    remove() {
      frame.remove();
    },
  };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Width in px of `text` set at `size` px in `fontFamily`, measured on a
 * shared canvas. `style` is what goes before the size in a CSS font, such
 * as "italic" or "600". Without a canvas (outside a browser) it estimates
 * 0.58 em per character.
 */
export function textWidth(
  text: string,
  size: number,
  fontFamily: string,
  style = "",
): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * size * 0.58;
  const prefix = style ? `${style} ` : "";
  // The canvas ignores a font it cannot parse, such as a family name with an
  // unquoted number in it, and keeps the font of the call before. A generic
  // family first sets the size, so such a family still measures at `size`.
  measureCtx.font = `${prefix}${size}px sans-serif`;
  measureCtx.font = `${prefix}${size}px ${fontFamily}`;
  return measureCtx.measureText(text).width;
}

/**
 * `text` cut with an ellipsis to at most `maxWidth` px, measured as
 * {@link textWidth} does. Text that fits comes back whole, and when not
 * even the ellipsis fits the result is empty.
 */
export function fitText(
  text: string,
  maxWidth: number,
  size: number,
  fontFamily: string,
  style = "",
): string {
  const width = (s: string) => textWidth(s, size, fontFamily, style);
  if (width(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(`${text.slice(0, mid).trimEnd()}\u2026`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const out = `${text.slice(0, lo).trimEnd()}\u2026`;
  return width(out) <= maxWidth ? out : "";
}

/**
 * Measure a container: the size of its padding box, inside any border,
 * which is the box its absolutely placed layers fill, and the size
 * {@link autoResize} reports too. A container with no box, hidden or not
 * in the page, measures as `fallback`.
 *
 * A plot drawn at the fallback height into a container with no height
 * would cover the content below it, so two kinds of container are also
 * given the fallback height, through a CSS rule that every page rule wins
 * over: one laid out in the page with no content height, such as a plain
 * div with no CSS height, and one not in the page yet, which is often
 * added to the page after the plot is drawn. Such a container is watched
 * from then on, so the fallback follows it into a shadow root and is
 * dropped when the page gives it a height. A container hidden at creation,
 * as in a tab not shown, gets no fallback: its size is not known until it
 * is shown, and {@link autoResize} handles it then. Each component's
 * `destroy()` undoes this through {@link releaseContainer}.
 */
export function measure(
  el: HTMLElement,
  fallback: { width: number; height: number } = { width: 640, height: 480 },
): { width: number; height: number } {
  let box = boxSizes(el);
  if (!el.style.height) {
    if (!el.isConnected) {
      applyFallbackHeight(el, fallback.height);
    } else if (box.laidOut && box.contentHeight <= 0) {
      applyFallbackHeight(el, fallback.height);
      box = boxSizes(el);
    }
  }
  return {
    width: box.width > 0 ? box.width : fallback.width,
    height: box.height > 0 ? box.height : fallback.height,
  };
}

/** A CSS length in px as a number; 0 for anything else. */
const px = (v: string) => Number.parseFloat(v) || 0;

/**
 * The padding box of `el` in CSS px, and the height of its content box,
 * which is 0 when nothing gives the element a height. `laidOut` is false
 * for an element with no box: hidden or not in the page.
 */
function boxSizes(el: Element): {
  width: number;
  height: number;
  contentHeight: number;
  laidOut: boolean;
} {
  if (!el.isConnected || el.getClientRects().length === 0) {
    return { width: 0, height: 0, contentHeight: 0, laidOut: false };
  }
  const cs = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  // From the border box, which has no rounding, so a padding of 8.3 px
  // with no content still reads as no content.
  const contentHeight =
    el.getBoundingClientRect().height -
    px(cs.paddingTop) -
    px(cs.paddingBottom) -
    px(cs.borderTopWidth) -
    px(cs.borderBottomWidth);
  return {
    width: el.clientWidth,
    height: el.clientHeight,
    contentHeight: Math.max(0, contentHeight),
    laidOut: true,
  };
}

/** Marks an element that takes the fallback height. */
const FALLBACK_ATTR = "data-plotomics-fallback";
/** The custom property that holds the fallback height. */
const FALLBACK_VAR = "--plotomics-fallback-height";
/** Marks the style element that holds the fallback rule. */
const RULES_ATTR = "data-plotomics-rules";
/**
 * The fallback rule. It sits in a cascade layer of its own, declared before
 * any other, which gives it the lowest priority: every page rule wins over
 * it, unlayered or in a layer (as Tailwind's utilities are), whatever its
 * specificity. `:where()` keeps its own specificity at zero too.
 */
const RULES = `@layer plotomics{:where([${FALLBACK_ATTR}]){height:var(${FALLBACK_VAR},480px)}}`;

/**
 * Give `el` a height of `height` px that every page rule wins over, and
 * watch it from then on (see {@link watch}).
 *
 * The element gets only an attribute and a custom property, never an
 * inline height, which would win over every rule.
 */
function applyFallbackHeight(el: HTMLElement, height: number): void {
  el.setAttribute(FALLBACK_ATTR, "");
  el.style.setProperty(FALLBACK_VAR, `${height}px`);
  addRules(el);
  watch(el);
}

/**
 * Undo what {@link measure} set on `el`: the fallback height and the watch.
 * Every component calls this in `destroy()`, so a container used again
 * does not keep the height of a plot that is gone.
 */
export function releaseContainer(el: HTMLElement): void {
  watchers.get(el)?.disconnect();
  watchers.delete(el);
  el.removeAttribute(FALLBACK_ATTR);
  el.style.removeProperty(FALLBACK_VAR);
  if (!el.getAttribute("style")) el.removeAttribute("style");
}

/** A shadow root, also one from another window such as an iframe. */
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && "host" in node;
}

/**
 * Add the fallback rule to the document or shadow root that holds `el`
 * now, once.
 *
 * A document rule does not reach inside a shadow root, so a shadow root
 * gets its own. The rule goes in a style element placed first, so its
 * layer comes before every other. A Content-Security-Policy with no
 * 'unsafe-inline' for styles blocks that element; the rule then goes in a
 * stylesheet built through the CSSOM, which the policy allows.
 */
function addRules(el: Element): void {
  const doc = el.ownerDocument;
  const root = el.getRootNode();
  const shadow = isShadowRoot(root) ? root : null;
  const holder: ParentNode | null = shadow ?? doc.head ?? doc.documentElement;
  if (!holder) return;
  const scope: DocumentOrShadowRoot = shadow ?? doc;
  if (holder.querySelector(`style[${RULES_ATTR}]`) || hasAdoptedRules(scope)) {
    return;
  }
  const style = doc.createElement("style");
  style.setAttribute(RULES_ATTR, "");
  style.textContent = RULES;
  holder.insertBefore(style, holder.firstChild);
  // A blocked style element has no stylesheet.
  if (style.sheet) return;
  style.remove();
  adoptRules(scope, doc);
}

/** Whether `scope` has adopted a stylesheet that holds the fallback rule. */
function hasAdoptedRules(scope: DocumentOrShadowRoot): boolean {
  const sheets = scope.adoptedStyleSheets ?? [];
  return sheets.some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some((r) =>
        r.cssText.includes(FALLBACK_ATTR),
      );
    } catch {
      return false;
    }
  });
}

/**
 * Add the fallback rule to `scope` as an adopted stylesheet. An adopted
 * sheet comes after the page's own, so a page height in a cascade layer
 * loses to it there; unlayered page rules still win.
 */
function adoptRules(scope: DocumentOrShadowRoot, doc: Document): void {
  const Sheet = (doc.defaultView as (Window & typeof globalThis) | null)
    ?.CSSStyleSheet;
  if (!Sheet || !scope.adoptedStyleSheets) return;
  try {
    const sheet = new Sheet();
    sheet.replaceSync(RULES);
    scope.adoptedStyleSheets = [sheet, ...scope.adoptedStyleSheets];
  } catch {
    // No constructed stylesheets in this browser: no fallback height.
  }
}

/** The containers given a fallback height; see {@link watch}. */
const watchers = new WeakMap<Element, ResizeObserver>();

/**
 * Watch a container given the fallback height until its plot is
 * destroyed. Each time its size changes while it is laid out, its fallback
 * is fitted where it is now: added to the shadow root it went into, as a
 * document rule does not reach inside one, and dropped when the page gives
 * it a height of its own, as a grid row does. This also covers a container
 * drawn before it is added to the page. It does not resize the plot;
 * {@link autoResize} does.
 */
function watch(el: HTMLElement): void {
  if (typeof ResizeObserver === "undefined" || watchers.has(el)) return;
  let frame = 0;
  const ro = new ResizeObserver(() => {
    if (frame) return;
    // A size set inside the observer's own callback would be reported in
    // the same frame, which the browser flags as a loop.
    frame = requestAnimationFrame(() => {
      frame = 0;
      fitFallback(el);
    });
  });
  ro.observe(el);
  watchers.set(el, ro);
}

/**
 * Give a laid-out element the fallback height exactly when nothing else
 * gives it a content height: added when it has none, as after a tab with
 * no CSS height is shown, and dropped when the page gives it a height
 * without it, as a grid row does once an element made outside the page is
 * added to one. An element that is hidden, or has an inline height, is
 * left as it is.
 */
function fitFallback(el: Element): void {
  if (!("style" in el)) return;
  const html = el as HTMLElement;
  if (html.style.height || !boxSizes(html).laidOut) return;
  if (html.hasAttribute(FALLBACK_ATTR)) {
    html.removeAttribute(FALLBACK_ATTR);
    if (boxSizes(html).contentHeight > 0) return;
  } else if (boxSizes(html).contentHeight > 0) {
    return;
  }
  const given = Number.parseFloat(html.style.getPropertyValue(FALLBACK_VAR));
  applyFallbackHeight(html, given > 0 ? given : 480);
}

/**
 * Follow the size of `el`. Each time its padding box changes,
 * `target.resize` gets its new width and height in CSS px, the size
 * {@link measure} gives. A size of 0, as in a hidden tab, is skipped.
 * Returns a function that stops following.
 *
 * It also keeps the fallback height of {@link measure} right as the page
 * changes: an element shown with no content height gets it, and an
 * element the page gives a height of its own drops it.
 *
 * The R and Python wrappers do this for every plot. In plain JavaScript,
 * call it once the plot is made, and call the function it returns before
 * `destroy()`:
 *
 * ```js
 * const plot = createVolcano(el, { data });
 * const stop = autoResize(el, plot);
 * // later
 * stop();
 * plot.destroy();
 * ```
 */
export function autoResize(
  el: Element,
  target: { resize(width: number, height: number): void },
): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let frame = 0;
  // A size set inside the observer's own callback would be reported in the
  // same frame, which the browser flags as a loop, so the fallback height
  // is fitted in the next frame.
  const fit = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fitFallback(el);
    });
  };
  const ro = new ResizeObserver(() => {
    const box = boxSizes(el);
    if (!box.laidOut || box.width <= 0) return;
    if (box.contentHeight > 0) {
      target.resize(box.width, box.height);
      if (el.hasAttribute(FALLBACK_ATTR)) fit();
    } else {
      fit();
    }
  });
  // The border box, unlike the content box, changes with the padding, so
  // a new padding around a content box of the same size is seen too.
  ro.observe(el, { box: "border-box" });
  return () => {
    ro.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
}

/** Device pixel ratio, clamped to keep GPU memory sane on retina displays. */
export function dpr(max = 2): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, max);
}

let idSeq = 0;

/**
 * An id for an SVG element (such as a gradient) that no other plot on the
 * page shares. `url(#id)` resolves to the first match in the whole document,
 * so two plots with one id would paint with the first one's gradient. A
 * counter alone is not enough: anywidget loads the bundle again for each
 * widget, which starts the counter again, so a random part is added.
 */
export function uniqueId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${idSeq}`;
}
