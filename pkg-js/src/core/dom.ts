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

/** Measure a container, falling back to sensible defaults for headless/0-size. */
export function measure(
  el: HTMLElement,
  fallback: { width: number; height: number } = { width: 640, height: 480 },
): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : fallback.width,
    height: rect.height > 0 ? rect.height : fallback.height,
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
