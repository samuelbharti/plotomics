/** Small DOM helpers shared by components (tooltip, sizing, element reset). */

import type { PlotomicsTheme } from "./theme.js";

export function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export interface Tooltip {
  show(html: string, clientX: number, clientY: number): void;
  hide(): void;
  destroy(): void;
}

/** A lightweight absolutely-positioned tooltip anchored to a container. */
export function createTooltip(
  container: HTMLElement,
  theme: PlotomicsTheme,
): Tooltip {
  const tip = document.createElement("div");
  // The tooltip follows the pointer, so it is not moved with the layers.
  tip.setAttribute(TOOLTIP_ATTR, "");
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
    maxWidth: "320px",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  // The container must be a positioning context.
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(tip);

  return {
    show(html, clientX, clientY) {
      const rect = container.getBoundingClientRect();
      tip.innerHTML = html;
      tip.style.opacity = "1";
      const x = clientX - rect.left + 12;
      const y = clientY - rect.top + 12;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    },
    hide() {
      tip.style.opacity = "0";
    },
    destroy() {
      tip.remove();
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
 * Measure a container: the size of its content box, inside any padding and
 * border, which is also the size ResizeObserver gives {@link autoResize}.
 * A container with no box, hidden or not in the page, measures as
 * `fallback`. The plot's layers are placed in that content box too, so a
 * padded container keeps its padding clear (see {@link contentOrigin}).
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
 * `destroy()` undoes all of this through {@link releaseContainer}.
 */
export function measure(
  el: HTMLElement,
  fallback: { width: number; height: number } = { width: 640, height: 480 },
): { width: number; height: number } {
  let box = contentSize(el);
  if (!el.style.height) {
    if (!el.isConnected) {
      applyFallbackHeight(el, fallback.height);
    } else if (box.laidOut && box.height <= 0) {
      applyFallbackHeight(el, fallback.height);
      box = contentSize(el);
    }
  }
  placeLayers(el);
  return {
    width: box.width > 0 ? box.width : fallback.width,
    height: box.height > 0 ? box.height : fallback.height,
  };
}

/** A CSS length in px as a number; 0 for anything else. */
const px = (v: string) => Number.parseFloat(v) || 0;

/** The computed style of `el`, read in its own window. */
function styleOf(el: Element): CSSStyleDeclaration {
  return (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
}

/**
 * The content box of `el` in CSS px: its border box less padding and
 * border. `laidOut` is false for an element with no box, one that is
 * hidden or not in the page.
 */
function contentSize(el: Element): {
  width: number;
  height: number;
  laidOut: boolean;
} {
  if (!el.isConnected || el.getClientRects().length === 0) {
    return { width: 0, height: 0, laidOut: false };
  }
  const rect = el.getBoundingClientRect();
  const cs = styleOf(el);
  const width =
    rect.width -
    px(cs.paddingLeft) -
    px(cs.paddingRight) -
    px(cs.borderLeftWidth) -
    px(cs.borderRightWidth);
  const height =
    rect.height -
    px(cs.paddingTop) -
    px(cs.paddingBottom) -
    px(cs.borderTopWidth) -
    px(cs.borderBottomWidth);
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
    laidOut: true,
  };
}

/** Marks an element that takes the fallback height. */
const FALLBACK_ATTR = "data-plotomics-fallback";
/** The custom property that holds the fallback height. */
const FALLBACK_VAR = "--plotomics-fallback-height";
/** Marks a padded container whose layers are moved into its content box. */
const BOX_ATTR = "data-plotomics-box";
/** The custom properties that hold the left and top padding. */
const PAD_X = "--plotomics-pad-x";
const PAD_Y = "--plotomics-pad-y";
/** Marks the tooltip, which is placed by the pointer, not moved. */
const TOOLTIP_ATTR = "data-plotomics-tooltip";
/** Marks the style element that holds the rules. */
const RULES_ATTR = "data-plotomics-rules";
/**
 * The rules: the fallback height, and the shift of a padded container's
 * layers into its content box. Absolutely placed children start at the
 * padding box, so each layer but the tooltip moves by the left and top
 * padding. The rules sit in a cascade layer of their own, declared before
 * any other, which gives them the lowest priority: every page rule wins
 * over them, unlayered or in a layer (as Tailwind's utilities are),
 * whatever its specificity. `:where()` keeps their own specificity at zero
 * too.
 */
const RULES =
  "@layer plotomics{" +
  `:where([${FALLBACK_ATTR}]){height:var(${FALLBACK_VAR},480px)}` +
  `:where([${BOX_ATTR}])>:where(:not([${TOOLTIP_ATTR}]))` +
  `{translate:var(${PAD_X},0px) var(${PAD_Y},0px)}` +
  "}";

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
 * Move the layers of `el` into its content box: set its left and top
 * padding where the rules read them, or clear them when it has none.
 */
function placeLayers(el: Element): void {
  if (!el.isConnected || !("style" in el)) return;
  const html = el as HTMLElement;
  const cs = styleOf(html);
  const x = px(cs.paddingLeft);
  const y = px(cs.paddingTop);
  if (x > 0 || y > 0) {
    html.setAttribute(BOX_ATTR, "");
    html.style.setProperty(PAD_X, `${x}px`);
    html.style.setProperty(PAD_Y, `${y}px`);
    addRules(html);
  } else if (html.hasAttribute(BOX_ATTR)) {
    html.removeAttribute(BOX_ATTR);
    html.style.removeProperty(PAD_X);
    html.style.removeProperty(PAD_Y);
  }
}

/**
 * Where the layers of `el` start, in client coordinates: the top-left
 * corner of its content box. A component reads pointer positions relative
 * to this point, as its layers start there.
 */
export function contentOrigin(el: Element): { left: number; top: number } {
  const rect = el.getBoundingClientRect();
  let left = rect.left + el.clientLeft;
  let top = rect.top + el.clientTop;
  if (el.hasAttribute(BOX_ATTR) && "style" in el) {
    const style = (el as HTMLElement).style;
    left += px(style.getPropertyValue(PAD_X));
    top += px(style.getPropertyValue(PAD_Y));
  }
  return { left, top };
}

/**
 * Undo what {@link measure} set on `el`: the fallback height, the shift of
 * the layers and the watch. Every component calls this in `destroy()`, so
 * a container used again does not keep the height of a plot that is gone.
 */
export function releaseContainer(el: HTMLElement): void {
  watchers.get(el)?.disconnect();
  watchers.delete(el);
  el.removeAttribute(FALLBACK_ATTR);
  el.removeAttribute(BOX_ATTR);
  for (const name of [FALLBACK_VAR, PAD_X, PAD_Y]) {
    el.style.removeProperty(name);
  }
  if (!el.getAttribute("style")) el.removeAttribute("style");
}

/** A shadow root, also one from another window such as an iframe. */
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && "host" in node;
}

/**
 * Add the rules to the document or shadow root that holds `el` now, once.
 *
 * A document rule does not reach inside a shadow root, so a shadow root
 * gets its own. The rules go in a style element placed first, so their
 * layer comes before every other. A Content-Security-Policy with no
 * 'unsafe-inline' for styles blocks that element; the rules then go in a
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

/** Whether `scope` has adopted a stylesheet that holds the rules. */
function hasAdoptedRules(scope: DocumentOrShadowRoot): boolean {
  const sheets = scope.adoptedStyleSheets ?? [];
  return sheets.some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some((r) =>
        r.cssText.includes(BOX_ATTR),
      );
    } catch {
      return false;
    }
  });
}

/**
 * Add the rules to `scope` as an adopted stylesheet. An adopted sheet
 * comes after the page's own, so a page height in a cascade layer loses to
 * it there; unlayered page rules still win.
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
 * destroyed. Each time its size changes while it is laid out, its layers
 * are placed again and its fallback is fitted where it is now: added to
 * the shadow root it went into, as a document rule does not reach inside
 * one, and dropped when the page gives it a height of its own, as a grid
 * row does. This also covers a container drawn before it is added to the
 * page. It does not resize the plot; {@link autoResize} does.
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
      if (!contentSize(el).laidOut) return;
      placeLayers(el);
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
  if (html.style.height || !contentSize(html).laidOut) return;
  if (html.hasAttribute(FALLBACK_ATTR)) {
    html.removeAttribute(FALLBACK_ATTR);
    if (contentSize(html).height > 0) return;
  } else if (contentSize(html).height > 0) {
    return;
  }
  const given = Number.parseFloat(html.style.getPropertyValue(FALLBACK_VAR));
  applyFallbackHeight(html, given > 0 ? given : 480);
}

/**
 * Follow the size of `el`. Each time its content box changes,
 * `target.resize` gets the new width and height in CSS px. A size of 0,
 * as in a hidden tab, is skipped. Returns a function that stops following.
 *
 * It also keeps the fallback height and the layer placement of
 * {@link measure} right as the page changes: an element shown with no
 * content height gets the fallback, and an element the page gives a
 * height of its own drops it.
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
  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1]?.contentRect;
    if (!r || r.width <= 0) return;
    // A padding that changed moves the layers; their sizes do not change
    // the size observed here.
    placeLayers(el);
    if (r.height > 0) {
      target.resize(r.width, r.height);
      if (el.hasAttribute(FALLBACK_ATTR)) fit();
    } else {
      fit();
    }
  });
  ro.observe(el);
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
