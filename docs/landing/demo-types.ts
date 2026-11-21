import type {
  PlotomicsInstance,
  PlotomicsTheme,
} from "../../pkg-js/src/core/index.js";

/** What the page hands a demo when it mounts it. */
export interface DemoContext {
  /** Theme overrides, so the plot uses the font of the page. */
  theme: Partial<PlotomicsTheme>;
  /**
   * Put a message in the status line under the demo, such as what a lasso
   * selected, or put the caption of the tab back with null.
   */
  say(text: string | null): void;
}

/** Mounts one live demo into `el` and returns the plot. */
export type DemoMount = (
  el: HTMLElement,
  ctx: DemoContext,
) => PlotomicsInstance<unknown>;
