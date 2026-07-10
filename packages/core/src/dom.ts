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
export function createTooltip(container: HTMLElement, theme: PlotomicsTheme): Tooltip {
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
