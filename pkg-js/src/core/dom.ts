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
 * Measure a container, falling back to sensible defaults for headless/0-size.
 *
 * A plot drawn at the fallback height into a container with no height would
 * cover the content below it, so two kinds of container get the fallback
 * height as well, through a CSS rule of zero specificity: one laid out in
 * the page at 0 px high, such as a plain div with no CSS height, and one not
 * in the page yet, which is often added to the page after the plot is
 * drawn. Any CSS height the page gives the container wins over it. A container hidden
 * at creation, as in a tab not shown, gets no fallback: its size is not
 * known until it is shown, and {@link autoResize} handles it then.
 */
export function measure(
  el: HTMLElement,
  fallback: { width: number; height: number } = { width: 640, height: 480 },
): { width: number; height: number } {
  let rect = el.getBoundingClientRect();
  if (!el.style.height) {
    const laidOut = el.isConnected && el.getClientRects().length > 0;
    if ((laidOut && rect.height <= 0) || !el.isConnected) {
      applyFallbackHeight(el, fallback.height);
      if (laidOut) rect = el.getBoundingClientRect();
    }
  }
  return {
    width: rect.width > 0 ? rect.width : fallback.width,
    height: rect.height > 0 ? rect.height : fallback.height,
  };
}

/** Marks an element that takes the fallback height. */
const FALLBACK_ATTR = "data-plotomics-fallback";
/** The custom property that holds the fallback height. */
const FALLBACK_VAR = "--plotomics-fallback-height";

/**
 * Give `el` a height of `height` px that any CSS height wins over.
 *
 * The height comes from the rule `:where([data-plotomics-fallback])`, which
 * has zero specificity and is placed first in the document, or in the
 * shadow root that holds `el`. An inline height, a stylesheet rule or a
 * class added later all win over it. The element itself gets only the
 * attribute and a custom property, never an inline height.
 */
function applyFallbackHeight(el: HTMLElement, height: number): void {
  el.setAttribute(FALLBACK_ATTR, "");
  el.style.setProperty(FALLBACK_VAR, `${height}px`);
  addFallbackRule(el);
}

/** Add the fallback rule to the document or shadow root of `el`, once. */
function addFallbackRule(el: Element): void {
  const doc = el.ownerDocument;
  const root = el.getRootNode();
  const holder: ParentNode | null =
    typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot
      ? root
      : (doc.head ?? doc.documentElement);
  if (!holder || holder.querySelector("style[data-plotomics-fallback-rule]")) {
    return;
  }
  const style = doc.createElement("style");
  style.setAttribute("data-plotomics-fallback-rule", "");
  style.textContent = `:where([${FALLBACK_ATTR}]){height:var(${FALLBACK_VAR},480px)}`;
  holder.insertBefore(style, holder.firstChild);
}

/**
 * Give a laid-out element the fallback height exactly when nothing else
 * gives it a height: added when it is 0 px high, as after a tab with no
 * CSS height is shown, and dropped when the page gives it a height without
 * it, as a grid row does once an element made outside the page is added
 * to one. An element that is hidden, or has an inline height, is left as
 * it is.
 */
function fitFallback(el: Element): void {
  if (!(el instanceof HTMLElement) || el.style.height) return;
  if (!el.isConnected || el.getClientRects().length === 0) return;
  if (el.hasAttribute(FALLBACK_ATTR)) {
    el.removeAttribute(FALLBACK_ATTR);
    if (el.getBoundingClientRect().height > 0) return;
  } else if (el.getBoundingClientRect().height > 0) {
    return;
  }
  const given = Number.parseFloat(el.style.getPropertyValue(FALLBACK_VAR));
  applyFallbackHeight(el, given > 0 ? given : 480);
}

/**
 * Follow the size of `el`. Each time it changes, `target.resize` gets the
 * new width and height in CSS px. A size of 0, as in a hidden tab, is
 * skipped. Returns a function that stops following.
 *
 * It also keeps the fallback height of {@link measure} right as the page
 * changes: an element shown at 0 px high gets it, and an element the page
 * gives a height of its own drops it.
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
