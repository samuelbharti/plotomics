import { afterEach, describe, expect, it } from "vitest";
import { createGosling } from "../../src/components/gosling.js";
import { createIgv } from "../../src/components/igv.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { PLOTS, settled } from "./plots.js";

// destroy() is documented as idempotent. Before the fix a second call threw
// in the volcano and embedding (regl-scatterplot destroyed twice), the
// heatmap and Hi-C (regl destroyed twice), and a resize(), setOptions() or
// setData() after destroy() drew on the destroyed plot: the volcano and
// embedding then threw from a later frame. Now a second destroy() and every
// call after it do nothing, and the exports give null.

const fastaURL = new URL("./fixtures/tiny.fa", import.meta.url).href;

interface Built {
  name: string;
  height: number;
  make(el: HTMLElement): PlotomicsInstance<unknown>;
  /** Wait for the component to finish drawing. */
  ready(inst: PlotomicsInstance<unknown>): Promise<void>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BUILT: Built[] = [
  ...PLOTS.map((p) => ({
    name: p.name,
    height: p.height,
    make: (el: HTMLElement) => p.make(el),
    ready: () => settled(p.name),
  })),
  {
    name: "gosling",
    height: 300,
    make: (el) =>
      createGosling(el, {
        options: {
          spec: {
            tracks: [
              {
                data: {
                  type: "json",
                  chromosomeField: "chrom",
                  genomicFields: ["start", "end"],
                  values: [
                    { chrom: "chr1", start: 10_000_000, end: 60_000_000 },
                  ],
                },
                mark: "rect",
                x: { field: "start", type: "genomic" },
                xe: { field: "end", type: "genomic" },
                width: 500,
                height: 60,
              },
            ],
          },
        },
      }) as PlotomicsInstance<unknown>,
    ready: async (inst) => {
      // The first mount loads Gosling, which can take a while.
      for (let i = 0; i < 120; i += 1) {
        if (inst.exportPNG && (await inst.exportPNG(1))) return;
        await wait(250);
      }
    },
  },
  {
    name: "igv",
    height: 300,
    make: (el) =>
      createIgv(el, {
        options: {
          config: {
            reference: { id: "tiny", name: "tiny", fastaURL, indexed: false },
            loadDefaultGenomes: false,
            locus: "chrT:1-1200",
          },
        },
      }) as PlotomicsInstance<unknown>,
    ready: async (inst) => {
      for (let i = 0; i < 120; i += 1) {
        if (inst.exportSVG?.()) return;
        await wait(250);
      }
    },
  },
];

/** Errors thrown on the page, also from a later frame or a promise. */
function watchErrors() {
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => errors.push(String(e.message));
  const onRejection = (e: PromiseRejectionEvent) =>
    errors.push(String(e.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return {
    errors,
    stop() {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    },
  };
}

function container(height: number): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:640px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe.each(BUILT)("$name after destroy()", (c) => {
  it("does nothing on a second destroy() or on any other call", async () => {
    const watch = watchErrors();
    try {
      const el = container(c.height);
      const inst = c.make(el);
      instances.push(inst);
      await c.ready(inst);
      inst.destroy();
      expect(el.childElementCount).toBe(0);
      expect(() => inst.destroy()).not.toThrow();
      expect(() => inst.resize(500, 300)).not.toThrow();
      expect(() => inst.setOptions({ theme: { fontSize: 16 } })).not.toThrow();
      expect(() => inst.setData({ columns: {} })).not.toThrow();
      expect(inst.exportSVG?.() ?? null).toBeNull();
      expect((await inst.exportPNG?.(1)) ?? null).toBeNull();
      // Nothing comes back into the element, and nothing throws later, on
      // a resize of the element or its removal.
      el.style.width = "500px";
      await wait(400);
      el.remove();
      await wait(200);
      expect(el.childElementCount).toBe(0);
      expect(watch.errors).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it("throws nothing when destroyed right after it is built or updated", async () => {
    const watch = watchErrors();
    try {
      for (const update of ["none", "setData", "setOptions", "resize"]) {
        const el = container(c.height);
        const inst = c.make(el);
        if (update !== "none") {
          await c.ready(inst);
          if (update === "setData") inst.setData({ columns: {} });
          if (update === "setOptions") {
            inst.setOptions({ theme: { fontSize: 16 } });
          }
          if (update === "resize") inst.resize(500, 300);
        }
        inst.destroy();
        await wait(300);
        el.remove();
        expect(el.childElementCount, update).toBe(0);
      }
      await wait(200);
      expect(watch.errors).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});
