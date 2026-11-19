import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createNetwork } from "../../src/components/network.js";
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

describe("htmlwidgets sizing", () => {
  it("keeps a CSS height such as 100vh, calc() or a percentage", () => {
    const { factory } = countingFactory();
    registerComponent("counting", factory);
    const binding = (
      window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
    ).plotomics.htmlwidget("counting");
    for (const css of ["100vh", "calc(100vh - 40px)", "50%"]) {
      const el = document.createElement("div");
      // htmlwidgets writes the height given in R on the element itself.
      el.style.cssText = `width:600px;height:${css};`;
      document.body.appendChild(el);
      // As the browser writes it: calc() comes back reordered.
      const given = el.style.height;
      binding.factory(el, 600, el.offsetHeight).renderValue({ data });
      expect(el.style.height).toBe(given);
      expect(el.style.height).not.toMatch(/^\d+px$/);
    }
  });

  it("keeps a height that a stylesheet gives the element", () => {
    // volcanoOutput("v", height = NULL) with #vv { height: 50vh } in the page.
    const style = document.createElement("style");
    style.textContent = "#vv { height: 50vh; }";
    document.head.appendChild(style);
    try {
      const { factory } = countingFactory();
      registerComponent("counting", factory);
      const binding = (
        window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
      ).plotomics.htmlwidget("counting");
      const el = document.createElement("div");
      el.id = "vv";
      document.body.appendChild(el);
      binding.factory(el, el.offsetWidth, el.offsetHeight);
      expect(el.style.height).toBe("");
    } finally {
      style.remove();
    }
  });

  it("fixes the height in px when the element has none of its own", () => {
    const { factory } = countingFactory();
    registerComponent("counting", factory);
    const binding = (
      window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
    ).plotomics.htmlwidget("counting");
    const el = document.createElement("div");
    document.body.appendChild(el);
    binding.factory(el, 600, 400);
    expect(el.style.height).toBe("400px");
  });
});

/** A stand-in anywidget model whose traits a test sets by hand. */
function fakeModel(traits: Record<string, unknown>) {
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
  /** Set traits, then fire their change events in that order. */
  const change = (next: Record<string, unknown>) => {
    Object.assign(traits, next);
    for (const k of Object.keys(next)) handlers[`change:${k}`]?.();
  };
  return { model, change };
}

/** A float32 column `x` packed the way Python's pack_columns packs it. */
function packed(values: number[]) {
  const arr = new Float32Array(values);
  return {
    buffer: new DataView(arr.buffer),
    schema: {
      columns: [
        { name: "x", dtype: "float32", length: values.length, byteOffset: 0 },
      ],
    },
  };
}

/** Records the data each setData call is given. */
function recordingFactory() {
  const seen: number[][] = [];
  const factory: PlotomicsFactory<Record<string, unknown>> = () => ({
    setData(d) {
      seen.push(Array.from(d.columns.x as ArrayLike<number>));
    },
    setOptions() {},
    resize() {},
    destroy() {},
  });
  return { factory, seen };
}

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("anywidget data traits", () => {
  it("decodes a buffer again when its schema arrives after it", async () => {
    const { factory, seen } = recordingFactory();
    const first = packed([1, 2, 3]);
    const { model, change } = fakeModel({
      data: { columns: {}, meta: {} },
      ...first,
      options: {},
      _height: 300,
    });
    makeAnywidget(factory).render({ model, el: container() });

    // `w.buffer = ...` then `w.schema = ...` in Python, without hold_sync:
    // two messages, the buffer first.
    const next = packed([4, 5, 6, 7]);
    change({ buffer: next.buffer });
    await tick();
    change({ schema: next.schema });
    await tick();
    expect(seen.at(-1)).toEqual([4, 5, 6, 7]);
  });

  it("draws once when buffer, schema and data change in one message", async () => {
    const { factory, seen } = recordingFactory();
    const { model, change } = fakeModel({
      data: { columns: {}, meta: {} },
      ...packed([1, 2, 3]),
      options: {},
      _height: 300,
    });
    makeAnywidget(factory).render({ model, el: container() });
    change({ ...packed([8, 9]), data: { columns: {}, meta: { a: 1 } } });
    await tick();
    expect(seen).toEqual([[8, 9]]);
  });

  it("does not draw after the view is closed", async () => {
    const { factory, seen } = recordingFactory();
    const { model, change } = fakeModel({
      data: { columns: {}, meta: {} },
      ...packed([1]),
      options: {},
      _height: 300,
    });
    const cleanup = makeAnywidget(factory).render({ model, el: container() });
    change(packed([2]));
    cleanup();
    await tick();
    expect(seen).toEqual([]);
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

describe("rebuilding", () => {
  it("releases the WebGL context of a widget it builds again", async () => {
    registerComponent("heatmap", createHeatmap);
    const binding = (
      window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
    ).plotomics.htmlwidget("heatmap");
    const elA = container();
    binding
      .factory(elA, 600, 400)
      .renderValue({ data, options: { colormap: "viridis" } });
    const b = binding.factory(container(), 600, 400);
    // A Shiny checkbox that sets vmin and then clears it, 20 times over.
    for (let k = 0; k < 20; k += 1) {
      b.renderValue({ data, options: { colormap: "viridis", vmin: -2 } });
      b.renderValue({ data, options: { colormap: "viridis" } });
    }
    await new Promise((r) => setTimeout(r, 100));
    const glA = (elA.querySelector("canvas") as HTMLCanvasElement).getContext(
      "webgl",
    );
    expect(glA?.isContextLost()).toBe(false);
  });

  it("tells Shiny the selection is empty after a rebuild", () => {
    const calls: [string, unknown][] = [];
    const w = window as unknown as Record<string, unknown>;
    w.HTMLWidgets = { shinyMode: true };
    w.Shiny = {
      setInputValue: (id: string, v: unknown) => calls.push([id, v]),
    };
    try {
      // A component that reports a selection as soon as it is built.
      const selecting: PlotomicsFactory<{
        onSelect?: (i: number[]) => void;
      }> = (_el, init) => {
        init.options?.onSelect?.([0, 1]);
        return { setData() {}, setOptions() {}, resize() {}, destroy() {} };
      };
      registerComponent("selecting", selecting);
      const el = container();
      el.id = "emb";
      const widget = (
        window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
      ).plotomics
        .htmlwidget("selecting")
        .factory(el, 600, 400);
      widget.renderValue({ data, options: { a: 1 } });
      expect(calls).toEqual([["emb_selected", [0, 1]]]);
      widget.renderValue({ data, options: {} });
      // Cleared first, then the new instance reports its own selection.
      expect(calls.slice(1)).toEqual([
        ["emb_selected", []],
        ["emb_selected", [0, 1]],
      ]);
    } finally {
      delete w.HTMLWidgets;
      delete w.Shiny;
    }
  });

  it("clears the Python selected trait after a rebuild", () => {
    const { factory } = countingFactory();
    const traits: Record<string, unknown> = {
      data,
      buffer: null,
      schema: null,
      options: { a: 1 },
      selected: [3, 4],
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
    makeAnywidget(factory).render({ model, el: container() });
    traits.options = {};
    handlers["change:options"]?.();
    expect(traits.selected).toEqual([]);
  });
});

/** A stand-in for Shiny that records every input value set. */
function fakeShiny() {
  const calls: [string, unknown][] = [];
  const w = window as unknown as Record<string, unknown>;
  w.HTMLWidgets = { shinyMode: true };
  w.Shiny = {
    setInputValue: (id: string, v: unknown) => calls.push([id, v]),
  };
  return {
    calls,
    restore() {
      delete w.HTMLWidgets;
      delete w.Shiny;
    },
  };
}

/** A component whose selection the test reports through `report`. */
function reportingWidget(id: string) {
  const state: { report?: (value: unknown) => void } = {};
  const factory: PlotomicsFactory<{ onSelect?: (value: unknown) => void }> = (
    _el,
    init,
  ) => {
    state.report = init.options?.onSelect;
    return {
      setData() {},
      setOptions(next) {
        if (next.onSelect) state.report = next.onSelect;
      },
      resize() {},
      destroy() {},
    };
  };
  registerComponent("reporting", factory);
  const el = container();
  el.id = id;
  const widget = (
    window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
  ).plotomics
    .htmlwidget("reporting")
    .factory(el, 600, 400);
  return { widget, state };
}

describe("Shiny selection", () => {
  it("sends every kind of selection a component reports", () => {
    const shiny = fakeShiny();
    try {
      const { widget, state } = reportingWidget("w");
      widget.renderValue({ data, options: { a: 1 } });
      // Embedding reports row indices, and [] when the lasso is cleared;
      // network reports a node id, and null for a click on no node.
      for (const value of [[0, 2], [], "TP53", null]) state.report?.(value);
      expect(shiny.calls).toEqual([
        ["w_selected", [0, 2]],
        ["w_selected", []],
        ["w_selected", "TP53"],
        ["w_selected", null],
      ]);
    } finally {
      shiny.restore();
    }
  });

  it("clears a clicked node to NULL when the widget is built again", () => {
    const shiny = fakeShiny();
    try {
      const { widget, state } = reportingWidget("w");
      widget.renderValue({ data, options: { a: 1 } });
      state.report?.("TP53");
      widget.renderValue({ data, options: {} });
      expect(shiny.calls).toEqual([
        ["w_selected", "TP53"],
        ["w_selected", null],
      ]);

      // Nothing is selected now, so a second rebuild sends nothing.
      widget.renderValue({ data, options: { a: 1 } });
      widget.renderValue({ data, options: {} });
      expect(shiny.calls).toHaveLength(2);
    } finally {
      shiny.restore();
    }
  });

  it("sets input$<id>_selected to NULL when a network click hits no node", async () => {
    const shiny = fakeShiny();
    try {
      registerComponent("network", createNetwork);
      const el = container();
      el.id = "net";
      const widget = (
        window as unknown as { plotomics: { htmlwidget(n: string): Binding } }
      ).plotomics
        .htmlwidget("network")
        .factory(el, 600, 400);
      const genes = ["TP53", "MDM2", "CDKN1A", "ATM"];
      widget.renderValue({
        data: {
          columns: { id: genes, x: [10, 0, -10, 0], y: [0, 10, 0, -10] },
          meta: { edges: [["TP53", "MDM2"]] },
        },
        options: {},
      });
      await expect
        .poll(() => el.querySelector("canvas.sigma-mouse"), {
          timeout: 10_000,
          interval: 50,
        })
        .toBeTruthy();
      const mouse = el.querySelector("canvas.sigma-mouse") as HTMLElement;
      // The centre of the ring holds no node.
      const r = mouse.getBoundingClientRect();
      mouse.dispatchEvent(
        new MouseEvent("click", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          bubbles: true,
        }),
      );
      expect(shiny.calls).toEqual([["net_selected", null]]);
    } finally {
      shiny.restore();
    }
  });
});

describe("Python selection", () => {
  it("clears a clicked node to None after a rebuild", () => {
    const { factory } = countingFactory();
    const traits: Record<string, unknown> = {
      data,
      buffer: null,
      schema: null,
      options: { a: 1 },
      selected: "TP53",
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
    makeAnywidget(factory).render({ model, el: container() });
    traits.options = {};
    handlers["change:options"]?.();
    expect(traits.selected).toBeNull();
  });
});
