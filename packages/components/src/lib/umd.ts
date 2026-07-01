import type { BiovizData, BiovizFactory, BiovizInstance } from "@bioviz/core";

/**
 * Runtime shared by the htmlwidgets (R) path. Each component's IIFE bundle
 * imports this and calls `registerComponent("name", createX)`, which both
 * registers the factory and exposes `window.bioviz.htmlwidget("name")` — the
 * object an htmlwidgets binding passes to `HTMLWidgets.widget(...)`.
 *
 * R delivers data as JSON, so `x` already matches {@link BiovizData}; no binary
 * decode is needed on this path.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFactory = BiovizFactory<any>;

interface RenderPayload {
  data: BiovizData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: Record<string, any>;
}

interface BiovizGlobal {
  components: Record<string, AnyFactory>;
  register(name: string, factory: AnyFactory): void;
  htmlwidget(name: string): unknown;
}

function ensureGlobal(): BiovizGlobal {
  const w = window as unknown as { bioviz?: BiovizGlobal };
  if (!w.bioviz) {
    const g: BiovizGlobal = {
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
            let inst: BiovizInstance<any> | null = null;
            return {
              renderValue(x: RenderPayload) {
                const factory = g.components[name];
                if (!factory) throw new Error(`bioviz: component "${name}" not registered`);
                if (!inst) {
                  inst = factory(el, { data: x.data, options: x.options ?? {} });
                } else {
                  inst.setData(x.data);
                  inst.setOptions(x.options ?? {});
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
    w.bioviz = g;
  }
  return w.bioviz;
}

export function registerComponent(name: string, factory: AnyFactory): void {
  ensureGlobal().register(name, factory);
}
