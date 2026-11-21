/**
 * The view limits and the reset button that the plots that pan and zoom
 * share: the volcano, the embedding, the network, the heatmap and the Hi-C
 * map.
 *
 * Each plot has a home view, the one that shows all of its data: the view
 * it starts at, and the one a fit after new data or a resize goes back to.
 * Zooming out stops there, a pan keeps the view inside it, and zooming in
 * stops at {@link MIN_VIEW_SHARE} of its range on each axis. The reset
 * button in the top right corner of the plot area takes the view home, and
 * shows only while the view is somewhere else.
 */

import { resolveColour, textFallback } from "./paint.js";
import { type PlotomicsTheme, textSizes } from "./theme.js";

/**
 * The smallest share of the home range on each axis that a zoom shows:
 * zooming in stops at 1/10,000 of the range the home view shows.
 */
export const MIN_VIEW_SHARE = 1e-4;

/** A box in px from the top left corner of the plot box. */
export interface ViewArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room in px between the reset button and the corner of the plot area. */
const RESET_INSET = 4;

/**
 * The side in px of the reset button for `theme`: twice the label size,
 * from 20 to 30 px, so it grows with the text and stays small.
 */
export function resetButtonSize(
  theme: Pick<PlotomicsTheme, "fontSize">,
): number {
  return Math.round(Math.min(30, Math.max(20, 2 * textSizes(theme).label)));
}

/**
 * Where a reset button `side` px across goes in the plot area `area`: in
 * its top right corner, 4 px in from both edges, so it stays clear of the
 * axis labels, legends and colour bars outside the area. Null when the
 * area is too small to hold it.
 */
export function resetButtonBox(area: ViewArea, side: number): ViewArea | null {
  const room = side + 2 * RESET_INSET;
  if (!(area.width >= room && area.height >= room)) return null;
  return {
    left: area.left + area.width - RESET_INSET - side,
    top: area.top + RESET_INSET,
    width: side,
    height: side,
  };
}

/** The reset button of a plot. See {@link createResetButton}. */
export interface ResetButton {
  /** The button element. */
  readonly element: HTMLButtonElement;
  /**
   * The box the button takes in the plot box while it is shown, else
   * null. A plot keeps its own labels out of it.
   */
  readonly box: ViewArea | null;
  /**
   * Show the button when `away` is true, the view being away from home,
   * and hide it when it is false. A plot area too small to hold it keeps
   * it hidden.
   */
  show(away: boolean): void;
  /**
   * Put the button in the top right corner of the plot area `area`, sized
   * and coloured for `theme`.
   */
  place(area: ViewArea, theme: PlotomicsTheme): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Add the reset button of a plot to `parent`, the plot box, and call
 * `onReset` when it is pressed: with the mouse, or with Enter or Space once
 * it has the focus. A wheel over the button goes to `wheelTarget()`, the
 * element the plot zooms on, so it zooms as it would over the plot and
 * the page does not scroll. It is a plain HTML button named "Reset view", so a
 * screen reader names it, and the exports, which draw the canvases and the
 * SVG layers only, never hold it. Its colours come from the theme as the
 * plot reads them inside `el`, the plot's element: the axis colour for the
 * house it shows, the theme background behind it and the grid colour for
 * its edge. It starts hidden; call {@link ResetButton.place} to put it in
 * place. Removing the plot box removes it.
 */
export function createResetButton(
  parent: HTMLElement,
  el: HTMLElement,
  onReset: () => void,
  wheelTarget?: () => Element | null,
): ResetButton {
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Reset view";
  button.setAttribute("aria-label", "Reset view");
  button.style.cssText =
    "position:absolute;z-index:5;display:none;box-sizing:border-box;" +
    "margin:0;border:1px solid;border-radius:4px;cursor:pointer;" +
    "line-height:0;pointer-events:auto;";
  button.hidden = true;
  // A house, for the view of the whole plot.
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.style.cssText = "display:block;width:100%;height:100%;";
  for (const points of [
    "2.5 8 8 3 13.5 8",
    "4 6.8 4 13 12 13 12 6.8",
    "6.8 13 6.8 9.8 9.2 9.8 9.2 13",
  ]) {
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    icon.appendChild(line);
  }
  button.appendChild(icon);
  // A press on the button must not start a pan or a lasso in the plot.
  button.addEventListener("mousedown", (e) => e.stopPropagation());
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    onReset();
  });
  button.addEventListener(
    "wheel",
    (e) => {
      const target = wheelTarget?.();
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      target.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          buttons: e.buttons,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { passive: false },
  );
  parent.appendChild(button);

  let away = false;
  let spot: ViewArea | null = null;
  let painted: PlotomicsTheme | null = null;

  function apply() {
    const on = away && spot !== null;
    button.hidden = !on;
    button.style.display = on ? "block" : "none";
  }

  return {
    element: button,
    get box() {
      return away && spot ? { ...spot } : null;
    },
    show(next) {
      away = next;
      apply();
    },
    place(area, theme) {
      const side = resetButtonSize(theme);
      spot = resetButtonBox(area, side);
      if (spot) {
        button.style.left = `${spot.left}px`;
        button.style.top = `${spot.top}px`;
        button.style.width = `${side}px`;
        button.style.height = `${side}px`;
        button.style.padding = `${Math.round(side * 0.16)}px`;
      }
      // Read the colours once per theme. A colour given as var() stays as
      // given, so it follows the page; one the page cannot read takes the
      // default for its role.
      if (theme !== painted) {
        painted = theme;
        const reads = (c: string) => !!c && resolveColour(c, el) !== "none";
        const fg = reads(theme.axis)
          ? theme.axis
          : textFallback("axis", theme.background, el);
        button.style.color = fg;
        button.style.backgroundColor = reads(theme.background)
          ? theme.background
          : "transparent";
        button.style.borderColor = reads(theme.grid) ? theme.grid : fg;
      }
      apply();
    },
  };
}
