import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createProfile } from "../../src/components/profile.js";
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
});
