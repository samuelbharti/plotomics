import { afterEach, describe, expect, it } from "vitest";
import type {
  PlotomicsData,
  PlotomicsFactory,
  PlotomicsInstance,
} from "../../src/core/index.js";

// anywidget imports a widget's module again for every widget in a notebook,
// so state kept at module level starts again for each one. A gradient id from
// a module counter was then the same in every widget, and `url(#id)` paints
// with the first gradient of that id in the page: the second colour bar
// showed the first one's ramp. A query string makes the browser load a module
// again, as anywidget does.

function container() {
  const el = document.createElement("div");
  el.style.cssText = "width:500px;height:360px;";
  document.body.appendChild(el);
  return el;
}

let instances: PlotomicsInstance<unknown>[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.replaceChildren();
});

/** The ids of the gradients in `el`, and the ids its fills point to. */
function gradients(el: HTMLElement) {
  const ids = Array.from(el.querySelectorAll("linearGradient")).map(
    (g) => g.id,
  );
  const fills = Array.from(el.querySelectorAll("[fill^='url(#']")).map((n) =>
    (n.getAttribute("fill") as string).slice(5, -1),
  );
  return { ids, fills };
}

type Loaded = Record<string, PlotomicsFactory<Record<string, unknown>>>;

const values = Array.from({ length: 16 }, (_, k) => k);
const cases: {
  name: string;
  /** Two copies of the module, as two anywidget widgets have. */
  load: () => Promise<[Loaded, Loaded]>;
  factory: string;
  data: PlotomicsData;
}[] = [
  {
    name: "hic",
    load: () =>
      Promise.all([
        import("../../src/components/hic.ts?copy=a"),
        import("../../src/components/hic.ts?copy=b"),
      ]),
    factory: "createHic",
    data: { columns: { values }, meta: { n: 4 } },
  },
  {
    name: "embedding",
    load: () =>
      Promise.all([
        import("../../src/components/embedding.ts?copy=a"),
        import("../../src/components/embedding.ts?copy=b"),
      ]),
    factory: "createEmbedding",
    data: { columns: { x: [0, 1, 2], y: [0, 1, 2], color: [0, 5, 10] } },
  },
  {
    name: "spatial",
    load: () =>
      Promise.all([
        import("../../src/components/spatial.ts?copy=a"),
        import("../../src/components/spatial.ts?copy=b"),
      ]),
    factory: "createSpatial",
    data: {
      columns: { x: [10, 50, 90], y: [10, 50, 90], color: [0, 5, 10] },
      meta: { imgWidth: 100, imgHeight: 100 },
    },
  },
];

describe("colour bar gradient ids", () => {
  for (const c of cases) {
    it(`differ between two ${c.name} widgets that each load the module`, async () => {
      const [ma, mb] = await c.load();
      const a = ma[c.factory];
      const b = mb[c.factory];
      expect(a).not.toBe(b);
      const elA = container();
      const elB = container();
      for (const [factory, el] of [
        [a, elA],
        [b, elB],
      ] as const) {
        instances.push(
          (factory as PlotomicsFactory<Record<string, unknown>>)(el, {
            data: c.data,
          }) as PlotomicsInstance<unknown>,
        );
      }
      await expect
        .poll(() => gradients(elB).ids.length, { timeout: 10_000 })
        .toBeGreaterThan(0);
      await expect
        .poll(() => gradients(elA).ids.length, { timeout: 10_000 })
        .toBeGreaterThan(0);
      const ga = gradients(elA);
      const gb = gradients(elB);
      expect(ga.ids.filter((id) => gb.ids.includes(id))).toEqual([]);
      // Each colour bar is filled with a gradient of its own widget.
      for (const id of gb.fills) expect(gb.ids).toContain(id);
      expect(gb.fills.length).toBeGreaterThan(0);
    });
  }

  it("differ when the module that makes them is loaded twice", async () => {
    const a = await import("../../src/core/dom.ts?copy=a");
    const b = await import("../../src/core/dom.ts?copy=b");
    expect(a.uniqueId).not.toBe(b.uniqueId);
    // Each copy counts from 1 again, so only the random part differs.
    expect(a.uniqueId("plotomics-x")).not.toBe(b.uniqueId("plotomics-x"));
  });
});
