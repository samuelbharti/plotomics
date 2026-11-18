import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import type { PlotomicsFactory } from "../../src/core/index.js";
import { makeAnywidget } from "../../src/lib/anywidget.js";
import { registerComponent } from "../../src/lib/umd.js";

// The R (htmlwidgets) and Python (anywidget) bindings. A new payload that
// leaves out an option sent before must not keep the old value.

interface Binding {
  factory(
    el: HTMLElement,
    w: number,
    h: number,
  ): {
    renderValue(x: unknown): void;
    resize(w: number, h: number): void;
  };
}

function container() {
  const el = document.createElement("div");
  el.style.cssText = "width:600px;height:400px;";
  document.body.appendChild(el);
  return el;
}

/** Text of the SVG labels, which include the colour bar ends. */
const labels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")).map((t) => t.textContent);

const data = {
  columns: { values: [0, 0.5, 1, 1.5] },
  meta: { nrows: 2, ncols: 2 },
};

/** Counts builds and option merges of a stand-in component. */
function countingFactory() {
  const log = { created: 0, destroyed: 0, merges: 0 };
  const factory: PlotomicsFactory<Record<string, unknown>> = () => {
    log.created += 1;
    return {
      setData() {},
      setOptions() {
        log.merges += 1;
      },
      resize() {},
      destroy() {
        log.destroyed += 1;
      },
    };
  };
  return { factory, log };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("htmlwidgets binding", () => {
  it("drops an option that R stopped sending", () => {
    registerComponent("heatmap", createHeatmap);
    const binding = (
      window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
    ).plotomics.htmlwidget("heatmap");
    const el = container();
    const widget = binding.factory(el, 600, 400);

    widget.renderValue({
      data,
      options: { colormap: "viridis", vmin: -2, vmax: 2 },
    });
    expect(labels(el)).toContain("-2");

    // bioheatmap(m) after bioheatmap(m, vmin = -2, vmax = 2): no clamps sent.
    widget.renderValue({ data, options: { colormap: "viridis" } });
    expect(labels(el)).not.toContain("-2");
    expect(labels(el)).toContain("1.5");
  });

  it("keeps the instance when only values change", () => {
    const { factory, log } = countingFactory();
    registerComponent("counting", factory);
    const binding = (
      window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
    ).plotomics.htmlwidget("counting");
    const widget = binding.factory(container(), 600, 400);

    widget.renderValue({
      data,
      options: { a: 1, theme: { background: "#000" } },
    });
    widget.renderValue({
      data,
      options: { a: 2, theme: { background: "#111" } },
    });
    expect(log).toEqual({ created: 1, destroyed: 0, merges: 1 });

    widget.renderValue({ data, options: { a: 2 } });
    expect(log).toEqual({ created: 2, destroyed: 1, merges: 1 });
  });
});

describe("anywidget binding", () => {
  it("builds the component again when a key leaves the options dict", () => {
    const { factory, log } = countingFactory();
    const traits: Record<string, unknown> = {
      data,
      buffer: null,
      schema: null,
      options: { a: 1, b: 2 },
      _height: 300,
    };
    const handlers: Record<string, () => void> = {};
    const model = {
      get: (k: string) => traits[k],
      set: (k: string, v: unknown) => {
        traits[k] = v;
      },
      save_changes() {},
      on: (event: string, cb: () => void) => {
        handlers[event] = cb;
      },
      off() {},
    };
    const cleanup = makeAnywidget(factory).render({ model, el: container() });

    traits.options = { a: 5, b: 2 };
    handlers["change:options"]?.();
    expect(log).toEqual({ created: 1, destroyed: 0, merges: 1 });

    traits.options = { a: 5 };
    handlers["change:options"]?.();
    expect(log).toEqual({ created: 2, destroyed: 1, merges: 1 });

    cleanup();
    expect(log.destroyed).toBe(2);
  });
});
