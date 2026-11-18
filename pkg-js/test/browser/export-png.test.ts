import { afterEach, describe, expect, it } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import { createDotplot } from "../../src/components/dotplot.js";
import { createEmbedding } from "../../src/components/embedding.js";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createHic } from "../../src/components/hic.js";
import { createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createProfile } from "../../src/components/profile.js";
import { createSpatial } from "../../src/components/spatial.js";
import { createTreemap } from "../../src/components/treemap.js";
import { createUpset } from "../../src/components/upset.js";
import { createViolin } from "../../src/components/violin.js";
import { createVolcano } from "../../src/components/volcano.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

// exportPNG should give the view the screen shows: the marks on the canvas
// and the axes, labels and legends in the SVG over it. Before the fix 13
// components exported the canvas alone.

const W = 600;
const H = 420;

function container() {
  const el = document.createElement("div");
  el.style.cssText = `width:${W}px;height:${H}px;`;
  document.body.appendChild(el);
  return el;
}

function decay(n: number) {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      values[r * n + c] = 100 / (Math.abs(r - c) + 1);
  }
  return values;
}

const spread = (n: number, lo: number, hi: number) =>
  Float64Array.from(
    { length: n },
    (_, i) => lo + ((i * 7919) % n) * ((hi - lo) / n),
  );

type Make = (el: HTMLElement) => PlotomicsInstance<unknown>;

const cases: [string, Make][] = [
  [
    "clustermap",
    (el) =>
      createClustermap(el, {
        data: {
          columns: { values: [1, 2, 3, 4, 5, 6] },
          meta: {
            nrows: 2,
            ncols: 3,
            rowLabels: ["r1", "r2"],
            colLabels: ["c1", "c2", "c3"],
          },
        },
      }),
  ],
  [
    "dotplot",
    (el) =>
      createDotplot(el, {
        data: {
          columns: {
            gene: ["A", "B", "A", "B"],
            cluster: ["x", "x", "y", "y"],
            pct: [80, 100, 20, 90],
            value: [1, 4, 2, 3],
          },
        },
      }),
  ],
  [
    "embedding",
    (el) =>
      createEmbedding(el, {
        data: {
          columns: { x: spread(200, 0, 10), y: spread(200, 0, 5) },
        },
        options: { showAxes: true },
      }),
  ],
  [
    "heatmap",
    (el) =>
      createHeatmap(el, {
        data: {
          columns: { values: [1, 2, 3, 4] },
          meta: { nrows: 2, ncols: 2 },
        },
      }),
  ],
  [
    "hic",
    (el) =>
      createHic(el, {
        data: {
          columns: { values: decay(16) },
          meta: { n: 16, binSize: 10_000 },
        },
      }),
  ],
  [
    "km",
    (el) =>
      createKm(el, {
        data: {
          columns: { time: [0, 5, 10], surv: [1, 0.8, 0.6] },
          meta: { riskTimes: [0, 5, 10] },
        },
      }),
  ],
  [
    "lollipop",
    (el) =>
      createLollipop(el, {
        data: {
          columns: {
            position: [175, 248, 273],
            count: [25, 20, 18],
            class: ["Missense", "Missense", "Missense"],
            label: ["R175H", "R248Q", "R273H"],
          },
          meta: { length: 393, gene: "TP53", classes: ["Missense"] },
        },
      }),
  ],
  [
    "oncoplot",
    (el) =>
      createOncoplot(el, {
        data: {
          columns: {
            codes: [1, 0, 2, 0, 1, 0],
            tmb: [2, 1, 1],
            freq: [66.7, 33.3],
          },
          meta: {
            nrows: 2,
            ncols: 3,
            genes: ["TP53", "KRAS"],
            samples: ["S1", "S2", "S3"],
            classes: ["Missense_Mutation", "Nonsense_Mutation"],
          },
        },
      }),
  ],
  [
    "profile",
    (el) =>
      createProfile(el, {
        data: {
          columns: {
            value: [10, 2, 7, 4],
            group: ["C>A", "C>A", "C>G", "C>G"],
            label: ["A[C>A]A", "A[C>A]C", "A[C>G]A", "A[C>G]C"],
          },
          meta: { title: "Sample 1" },
        },
      }),
  ],
  [
    "spatial",
    (el) =>
      createSpatial(el, {
        data: {
          columns: {
            x: [20, 60, 100, 140],
            y: [50, 50, 50, 50],
            color: ["a", "b", "c", "a"],
          },
          meta: { imgWidth: 160, imgHeight: 100, spotDiameter: 20 },
        },
        options: { showImage: false },
      }),
  ],
  [
    "treemap",
    (el) =>
      createTreemap(el, {
        data: {
          columns: {
            id: ["root", "P1", "P2", "g1", "g2", "g3"],
            parent: ["", "root", "root", "P1", "P1", "P2"],
            value: [0, 0, 0, 3, 2, 4],
          },
          meta: {
            labels: ["All", "Pathway one", "Pathway two", "g1", "g2", "g3"],
          },
        },
      }),
  ],
  [
    "upset",
    (el) =>
      createUpset(el, {
        data: {
          columns: { size: [124, 50] },
          meta: { sets: ["A", "B"], membership: [1, 0, 0, 1] },
        },
      }),
  ],
  [
    "violin",
    (el) =>
      createViolin(el, {
        data: {
          columns: {
            feature: ["CD3E", "CD3E", "MS4A1", "MS4A1"],
            group: ["T", "B", "T", "B"],
          },
          meta: {
            grid: [0, 1, 2],
            density: [0, 1, 0, 0, 0.5, 0, 0, 1, 0, 0, 0.2, 0],
          },
        },
      }),
  ],
  [
    "volcano",
    (el) =>
      createVolcano(el, {
        data: { columns: { x: spread(200, -4, 4), y: spread(200, 0, 20) } },
      }),
  ],
];

/**
 * How many of the SVG text labels have ink under them in the PNG. A pixel
 * is ink when it is opaque and not white (the theme background).
 */
async function textInk(el: HTMLElement, png: Blob, k: number) {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const box = el.getBoundingClientRect();
  let total = 0;
  let inked = 0;
  for (const t of Array.from(el.querySelectorAll("svg text"))) {
    if (!(t.textContent ?? "").trim()) continue;
    const r = t.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor((r.left - box.left) * k));
    const y0 = Math.max(0, Math.floor((r.top - box.top) * k));
    const x1 = Math.min(canvas.width, Math.ceil((r.right - box.left) * k));
    const y1 = Math.min(canvas.height, Math.ceil((r.bottom - box.top) * k));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    total += 1;
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if ((d[i + 3] as number) < 128) continue;
      const far = Math.max(
        255 - (d[i] as number),
        255 - (d[i + 1] as number),
        255 - (d[i + 2] as number),
      );
      if (far > 60) ink += 1;
    }
    if (ink >= 3) inked += 1;
  }
  return { total, inked };
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

const poll = { timeout: 10_000, interval: 100 };

describe("PNG export", () => {
  for (const [name, make] of cases) {
    it(`${name}: the PNG is the whole widget, labels included`, async () => {
      const el = container();
      const instance = make(el);
      instances.push(instance);
      const k = Math.min(window.devicePixelRatio || 1, 2);
      // The scatter plots draw a frame or two later, so poll.
      await expect
        .poll(async () => {
          const png = await instance.exportPNG?.(1);
          if (!png) return null;
          const bitmap = await createImageBitmap(png);
          const size = [bitmap.width, bitmap.height];
          bitmap.close();
          const ink = await textInk(el, png, k);
          return { size, share: ink.total ? ink.inked / ink.total : 0 };
        }, poll)
        .toEqual({
          size: [Math.round(W * k), Math.round(H * k)],
          share: expect.toSatisfy((v: number) => v >= 0.8),
        });
    });
  }

  it("scales the whole widget", async () => {
    const el = container();
    const [, make] = cases.find(([name]) => name === "km") as [string, Make];
    instances.push(make(el));
    const png = await instances[0]?.exportPNG?.(2);
    const bitmap = await createImageBitmap(png as Blob);
    const k = Math.min(window.devicePixelRatio || 1, 2);
    expect([bitmap.width, bitmap.height]).toEqual([
      Math.round(W * k * 2),
      Math.round(H * k * 2),
    ]);
  });
});
