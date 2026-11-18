import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createNetwork } from "../../src/components/network.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createProfile } from "../../src/components/profile.js";
import { createTreemap } from "../../src/components/treemap.js";
import { createViolin } from "../../src/components/violin.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/**
 * Whether the SVG overlay or the 2D canvas paints the colour #rrggbb, on
 * the canvas within 40 per channel (violins are filled at 85% opacity).
 */
function paints(el: HTMLElement, hex: string): boolean {
  if ((el.querySelector("svg")?.innerHTML ?? "").toLowerCase().includes(hex)) {
    return true;
  }
  const canvas = el.querySelector("canvas") as HTMLCanvasElement | null;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return false;
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < d.length; i += 4) {
    const near = [0, 1, 2].every(
      (k) => Math.abs((d[i + k] as number) - (want[k] as number)) <= 40,
    );
    if (near) return true;
  }
  return false;
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

// Two colours no default palette has.
const theme = { categorical: ["#ff00ff", "#00ffff"] };

type Make = (el: HTMLElement) => PlotomicsInstance<unknown>;
const cases: [string, Make][] = [
  [
    "km",
    (el) =>
      createKm(el, {
        data: {
          columns: {
            time: [0, 5, 0, 5],
            surv: [1, 0.8, 1, 0.6],
            group: ["a", "a", "b", "b"],
          },
        },
        options: { theme },
      }),
  ],
  [
    "lollipop",
    (el) =>
      createLollipop(el, {
        data: {
          columns: {
            position: [100, 200],
            count: [5, 3],
            class: ["Missense", "Nonsense"],
          },
          meta: { length: 300, classes: ["Missense", "Nonsense"] },
        },
        options: { theme },
      }),
  ],
  [
    "oncoplot",
    (el) =>
      createOncoplot(el, {
        data: {
          columns: { codes: [1, 2, 0, 1], tmb: [1, 2], freq: [100, 50] },
          meta: {
            nrows: 2,
            ncols: 2,
            genes: ["TP53", "KRAS"],
            samples: ["S1", "S2"],
            classes: ["Missense_Mutation", "Nonsense_Mutation"],
          },
        },
        options: { theme },
      }),
  ],
  [
    "profile",
    (el) =>
      createProfile(el, {
        data: {
          columns: { value: [10, 2, 7, 4], group: ["A", "A", "B", "B"] },
        },
        options: { theme },
      }),
  ],
  [
    "violin",
    (el) =>
      createViolin(el, {
        data: {
          columns: { feature: ["F", "F"], group: ["T", "B"] },
          meta: { grid: [0, 1, 2], density: [0, 1, 0, 0, 1, 0] },
        },
        options: { theme },
      }),
  ],
];

describe("categorical colours", () => {
  for (const [name, make] of cases) {
    it(`${name} takes its colours from theme.categorical`, () => {
      const el = container();
      instances.push(make(el));
      // Before the fix these five read the Okabe-Ito list directly.
      expect(paints(el, "#ff00ff")).toBe(true);
      expect(paints(el, "#00ffff")).toBe(true);
    });
  }

  it("gives 9 categories 9 colours with the default palette", async () => {
    const el = container();
    const labels = Array.from({ length: 9 }, (_, i) => `c${i + 1}`);
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: labels.map((_, i) => i),
            y: labels.map((_, i) => i % 3),
            color: labels,
          },
        },
      }),
    );
    const swatches = () =>
      Array.from(el.querySelectorAll('svg rect[width="10"][height="10"]')).map(
        (r) => r.getAttribute("fill"),
      );
    // Before the fix c9 took the colour of c1.
    await expect
      .poll(() => new Set(swatches()).size, { timeout: 10_000, interval: 100 })
      .toBe(9);
  });

  it("keeps Okabe-Ito for 8 categories and a missing value", async () => {
    const el = container();
    const labels = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [...labels.map((_, i) => i), 9],
            y: [...labels.map((_, i) => i % 3), 1],
            color: [...labels, null] as unknown as string[],
          },
        },
      }),
    );
    const first = () =>
      el
        .querySelector('svg rect[width="10"][height="10"]')
        ?.getAttribute("fill")
        ?.toLowerCase();
    // Before the fix the NA entry counted as a 9th category.
    await expect
      .poll(first, { timeout: 10_000, interval: 100 })
      .toBe("#0072b2");
  });

  it("gives 9 annotation levels 9 colours", () => {
    const el = container(700, 400);
    const levels = Array.from({ length: 9 }, (_, i) => `L${i + 1}`);
    instances.push(
      createOncoplot(el, {
        data: {
          columns: {
            codes: Array.from({ length: 9 }, () => 0),
            tmb: Array.from({ length: 9 }, () => 1),
            freq: [100],
          },
          meta: {
            nrows: 1,
            ncols: 9,
            genes: ["TP53"],
            samples: levels.map((l) => `S${l}`),
            classes: ["Missense_Mutation"],
            annotations: [
              { name: "Site", levels, codes: levels.map((_, i) => i) },
            ],
          },
        },
      }),
    );
    const fills = new Set(
      Array.from(el.querySelectorAll('svg rect[width="9"][height="9"]')).map(
        (r) => r.getAttribute("fill")?.toLowerCase(),
      ),
    );
    // One class colour and 9 level colours. Before the fix L9 took the
    // colour of L1.
    expect(fills.size).toBe(10);
  });

  it("colours a treemap that is a lone root", () => {
    const el = container();
    instances.push(
      createTreemap(el, {
        data: { columns: { id: ["root"], parent: [""], value: [5] } },
      }),
    );
    expect(paints(el, "#0072b2")).toBe(true);
  });

  it("leaves NaN network groups out of the group count", async () => {
    const el = container();
    const ids = Array.from({ length: 9 }, (_, i) => `n${i}`);
    const groups: unknown[] = ids.slice(0, 8).map((_, i) => `g${i}`);
    groups.push(Number.NaN);
    const net = createNetwork(el, {
      data: {
        columns: {
          id: ids,
          x: ids.map((_, i) => Math.cos(i)),
          y: ids.map((_, i) => Math.sin(i)),
        },
        meta: { nodeGroup: groups },
      },
      options: { defaultNodeSize: 12 },
    });
    instances.push(net);
    // With 8 groups the nodes keep Okabe-Ito; the 20-colour palette has no
    // #0072B2.
    await expect
      .poll(
        async () => {
          const png = await net.exportPNG?.(1);
          if (!png) return false;
          const bitmap = await createImageBitmap(png);
          const c = document.createElement("canvas");
          c.width = bitmap.width;
          c.height = bitmap.height;
          const ctx = c.getContext("2d") as CanvasRenderingContext2D;
          ctx.drawImage(bitmap, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4) {
            const near =
              Math.abs((d[i] as number) - 0x00) <= 12 &&
              Math.abs((d[i + 1] as number) - 0x72) <= 12 &&
              Math.abs((d[i + 2] as number) - 0xb2) <= 12;
            if (near) return true;
          }
          return false;
        },
        { timeout: 10_000, interval: 200 },
      )
      .toBe(true);
  });
});
