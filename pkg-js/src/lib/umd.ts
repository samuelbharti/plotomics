import type {
  PlotomicsData,
  PlotomicsFactory,
  PlotomicsInstance,
} from "../core/index.js";
import { dropsOptionKeys } from "./rerender.js";

/**
 * Runtime shared by the htmlwidgets (R) path. Each component's IIFE bundle
 * imports this and calls `registerComponent("name", createX)`, which both
 * registers the factory and exposes `window.plotomics.htmlwidget("name")` — the
 * object an htmlwidgets binding passes to `HTMLWidgets.widget(...)`.
 *
 * R delivers data as JSON, so `x` already matches {@link PlotomicsData}; no binary
 * decode is needed on this path.
 */

/** A component factory of any options type, as {@link registerComponent}
 * takes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFactory = PlotomicsFactory<any>;

interface RenderPayload {
  data: PlotomicsData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: Record<string, any>;
}

interface PlotomicsGlobal {
  components: Record<string, AnyFactory>;
  register(name: string, factory: AnyFactory): void;
  htmlwidget(name: string): unknown;
}

function ensureGlobal(): PlotomicsGlobal {
  const w = window as unknown as { plotomics?: PlotomicsGlobal };
  if (!w.plotomics) {
    const g: PlotomicsGlobal = {
      components: {},
      register(name, factory) {
        g.components[name] = factory;
      },
      htmlwidget(name) {
        return {
          name,
          type: "output",
          factory(el: HTMLElement, _width: number, height: number) {
            el.style.position = "relative";
            // A CSS height on the element, inline such as "100vh", "calc(...)"
            // or a percentage, or from a stylesheet, is kept, so the plot
            // still follows the window. Only an element laid out at 0 px
            // high is given the height htmlwidgets passes.
            if (
              height > 0 &&
              !el.style.height &&
              el.getBoundingClientRect().height <= 0
            ) {
              el.style.height = `${height}px`;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let inst: PlotomicsInstance<any> | null = null;
            let lastOptions: Record<string, unknown> = {};
            // What clears the selection Shiny holds from this widget: [] after
            // a lasso selection, null after a click selection, and undefined
            // when it holds none.
            let clearWith: [] | null | undefined;
            return {
              renderValue(x: RenderPayload) {
                const factory = g.components[name];
                if (!factory)
                  throw new Error(
                    `plotomics: component "${name}" not registered`,
                  );
                const sent = x.options ?? {};
                const options = withShinySelection(el, sent, (value) => {
                  clearWith =
                    value === null || (Array.isArray(value) && !value.length)
                      ? undefined
                      : Array.isArray(value)
                        ? []
                        : null;
                });
                // R leaves out NULL arguments. If an option sent last time is
                // missing now, build the component again so its default
                // applies; merging would keep the old value.
                if (inst && dropsOptionKeys(lastOptions, sent)) {
                  inst.destroy();
                  inst = null;
                  // The new instance starts with nothing selected.
                  if (clearWith !== undefined) {
                    sendShinySelection(el, clearWith);
                    clearWith = undefined;
                  }
                }
                if (!inst) {
                  inst = factory(el, { data: x.data, options });
                } else {
                  inst.setData(x.data);
                  inst.setOptions(options);
                }
                lastOptions = sent;
              },
              resize(width: number, h: number) {
                // htmlwidgets passes the border box. The plot fills the
                // padding box, the size measure() and autoResize give, so
                // a border no longer pushes it past the element.
                inst?.resize(
                  el.clientWidth > 0 ? el.clientWidth : width,
                  el.clientHeight > 0 ? el.clientHeight : h,
                );
              },
            };
          },
        };
      },
    };
    w.plotomics = g;
  }
  return w.plotomics;
}

/**
 * In a Shiny app (`HTMLWidgets.shinyMode`), inject an `onSelect` that pushes the
 * component's selection to `input$<outputId>_selected`: the row indices of a
 * lasso selection (embedding), or the id of a clicked node, and null when the
 * click lands on no node (network). Shiny reads null as `NULL`. Outside Shiny
 * this is a no-op, and components without selection ignore the extra option
 * key.
 */
function withShinySelection(
  el: HTMLElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: Record<string, any>,
  onReport?: (value: unknown) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  if (shinyMode(el)) {
    return {
      ...options,
      onSelect: (selection: unknown) => {
        const value = selection === undefined ? null : selection;
        onReport?.(value);
        sendShinySelection(el, value);
      },
    };
  }
  return options;
}

type ShinyWindow = {
  HTMLWidgets?: { shinyMode?: boolean };
  Shiny?: {
    setInputValue?: (id: string, value: unknown, opts?: unknown) => void;
  };
};

function shinyMode(el: HTMLElement): boolean {
  const w = window as unknown as ShinyWindow;
  return Boolean(w.HTMLWidgets?.shinyMode && w.Shiny?.setInputValue && el.id);
}

/** Set `input$<outputId>_selected`, outside Shiny a no-op. */
function sendShinySelection(el: HTMLElement, value: unknown): void {
  if (!shinyMode(el)) return;
  (window as unknown as ShinyWindow).Shiny?.setInputValue?.(
    `${el.id}_selected`,
    value,
    { priority: "event" },
  );
}

export function registerComponent(name: string, factory: AnyFactory): void {
  ensureGlobal().register(name, factory);
}
