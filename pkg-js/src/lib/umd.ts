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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFactory = PlotomicsFactory<any>;

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
            // Whether Shiny holds a non-empty selection from this widget.
            let hasSelection = false;
            return {
              renderValue(x: RenderPayload) {
                const factory = g.components[name];
                if (!factory)
                  throw new Error(
                    `plotomics: component "${name}" not registered`,
                  );
                const sent = x.options ?? {};
                const options = withShinySelection(el, sent, (n) => {
                  hasSelection = n > 0;
                });
                // R leaves out NULL arguments. If an option sent last time is
                // missing now, build the component again so its default
                // applies; merging would keep the old value.
                if (inst && dropsOptionKeys(lastOptions, sent)) {
                  inst.destroy();
                  inst = null;
                  // The new instance starts with nothing selected.
                  if (hasSelection) {
                    sendShinySelection(el, []);
                    hasSelection = false;
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
                inst?.resize(width, h);
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
 * component's lasso selection to `input$<outputId>_selected`. Outside Shiny this
 * is a no-op, and components without selection ignore the extra option key.
 */
function withShinySelection(
  el: HTMLElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: Record<string, any>,
  onReport?: (count: number) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  if (shinyMode(el)) {
    return {
      ...options,
      onSelect: (indices: number[]) => {
        onReport?.(indices.length);
        sendShinySelection(el, indices);
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
function sendShinySelection(el: HTMLElement, indices: number[]): void {
  if (!shinyMode(el)) return;
  (window as unknown as ShinyWindow).Shiny?.setInputValue?.(
    `${el.id}_selected`,
    indices,
    { priority: "event" },
  );
}

export function registerComponent(name: string, factory: AnyFactory): void {
  ensureGlobal().register(name, factory);
}
