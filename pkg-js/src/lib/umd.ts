import type { PlotomicsData, PlotomicsFactory, PlotomicsInstance } from "../core/index.js";

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
            if (height) el.style.height = `${height}px`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let inst: PlotomicsInstance<any> | null = null;
            return {
              renderValue(x: RenderPayload) {
                const factory = g.components[name];
                if (!factory) throw new Error(`plotomics: component "${name}" not registered`);
                const options = withShinySelection(el, x.options ?? {});
                if (!inst) {
                  inst = factory(el, { data: x.data, options });
                } else {
                  inst.setData(x.data);
                  inst.setOptions(options);
                }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const w = window as unknown as {
    HTMLWidgets?: { shinyMode?: boolean };
    Shiny?: { setInputValue?: (id: string, value: unknown, opts?: unknown) => void };
  };
  if (w.HTMLWidgets?.shinyMode && w.Shiny?.setInputValue && el.id) {
    return {
      ...options,
      onSelect: (indices: number[]) =>
        w.Shiny?.setInputValue?.(`${el.id}_selected`, indices, { priority: "event" }),
    };
  }
  return options;
}

export function registerComponent(name: string, factory: AnyFactory): void {
  ensureGlobal().register(name, factory);
}
