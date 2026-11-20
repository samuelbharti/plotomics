import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createDotplot } from "../../src/components/dotplot.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createNetwork } from "../../src/components/network.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createUpset } from "../../src/components/upset.js";
import { createVolcano } from "../../src/components/volcano.js";
import type {
  PlotomicsInstance,
  PlotomicsTheme,
} from "../../src/core/index.js";
import { PLOTS, settled } from "./plots.js";

// Every theme colour may be a CSS custom property, var(--name), which takes
// the value the page gives it. A canvas, regl-scatterplot and sigma cannot
// read var(): given one as it is, a canvas keeps black or the colour it drew
// before, regl-scatterplot paints white and sigma black. So each plot is
// drawn twice, once with its colours given directly and once with the same
// colours as var(), and the two must look the same. Before the fix the
// UpSet bars, the profile bars and banner, the lollipop PTM track and heads,
// the KM curves, the oncoplot cells, the violins, the spatial spots, the
// treemap tiles, the embedding points and the network nodes differed.

const COLOURS = {
  background: "#fdf6e3",
  foreground: "#7b2d8e",
  muted: "#c05621",
  grid: "#7fb3d5",
  axis: "#2f855a",
};
const PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#1fa3a3",
  "#f032e6",
  "#8a6d00",
];

const literal: Partial<PlotomicsTheme> = {
  ...COLOURS,
  categorical: PALETTE,
};
const viaVar: Partial<PlotomicsTheme> = {
  ...Object.fromEntries(Object.keys(COLOURS).map((k) => [k, `var(--t-${k})`])),
  categorical: PALETTE.map((_, i) => `var(--t-c${i})`),
};

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

/** A container that sets every custom property the var() theme names. */
function container(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  for (const [k, v] of Object.entries(COLOURS)) {
    el.style.setProperty(`--t-${k}`, v);
  }
  PALETTE.forEach((c, i) => {
    el.style.setProperty(`--t-c${i}`, c);
  });
  document.body.appendChild(el);
  return el;
}

/** The pixels of the element on screen, as RGBA bytes. */
async function shot(el: HTMLElement): Promise<Uint8ClampedArray> {
  const base64 = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** How many pixels differ by more than 2 in any channel. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 4; k += 1) {
      if (Math.abs((a[i + k] as number) - (b[i + k] as number)) > 2) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/** The screen pixels of a plot that `make` draws in a fresh container. */
async function drawn(
  name: string,
  height: number,
  make: (el: HTMLElement) => PlotomicsInstance<unknown>,
): Promise<Uint8ClampedArray> {
  const el = container(640, height);
  const inst = make(el);
  instances.push(inst);
  await settled(name);
  await settled(name);
  const pixels = await shot(el);
  inst.destroy();
  instances = instances.filter((i) => i !== inst);
  el.remove();
  return pixels;
}

describe.each(PLOTS)("$name with theme colours given as var()", (plot) => {
  it("draws as it does with the colours given directly", async () => {
    const want = await drawn(plot.name, plot.height, (el) =>
      plot.make(el, literal),
    );
    const got = await drawn(plot.name, plot.height, (el) =>
      plot.make(el, viaVar),
    );
    expect(differing(want, got)).toBe(0);
  });
});

describe("colour options given as var()", () => {
  // The colours a plot takes as options reach the same canvases, and so
  // does theme.muted, the ring of a dot plot dot with no value.
  const cases: {
    name: string;
    height: number;
    colours: Record<string, string>;
    make(
      el: HTMLElement,
      colours: (k: string) => string,
    ): PlotomicsInstance<unknown>;
  }[] = [
    {
      name: "dotplot",
      height: 400,
      colours: { muted: "#b7791f" },
      make: (el, c) =>
        createDotplot(el, {
          data: {
            columns: {
              gene: ["CD3E", "CD3E", "LYZ", "LYZ"],
              cluster: ["T", "B", "T", "B"],
              pct: [80, 60, 90, 40],
              value: [1, null, 2, null] as unknown as number[],
            },
          },
          options: { theme: { muted: c("muted") } },
        }),
    },
    {
      name: "lollipop",
      height: 440,
      colours: { backbone: "#b7791f", stem: "#285e61" },
      make: (el, c) =>
        createLollipop(el, {
          data: {
            columns: {
              position: [40, 120, 200],
              count: [5, 9, 3],
              class: ["Missense", "Missense", "Nonsense"],
            },
            meta: { length: 300, classes: ["Missense", "Nonsense"] },
          },
          options: { backboneColor: c("backbone"), stemColor: c("stem") },
        }),
    },
    {
      name: "oncoplot",
      height: 400,
      colours: { empty: "#e9d8a6", burden: "#9b2226", frequency: "#005f73" },
      make: (el, c) =>
        createOncoplot(el, {
          data: {
            columns: {
              codes: [1, 0, 2, 0, 1, 1],
              tmb: [3, 5, 2],
              freq: [60, 40],
            },
            meta: {
              nrows: 2,
              ncols: 3,
              genes: ["TP53", "KRAS"],
              samples: ["S1", "S2", "S3"],
              classes: ["Missense_Mutation", "Nonsense_Mutation"],
            },
          },
          options: {
            emptyColor: c("empty"),
            burdenColor: c("burden"),
            frequencyColor: c("frequency"),
          },
        }),
    },
    {
      name: "upset",
      height: 400,
      colours: { bar: "#2b6cb0", empty: "#e2c044" },
      make: (el, c) =>
        createUpset(el, {
          data: {
            columns: { size: [30, 20, 10] },
            meta: {
              sets: ["A", "B"],
              setSizes: [40, 30],
              membership: [1, 0, 0, 1, 1, 1],
            },
          },
          options: { barColor: c("bar"), emptyDotColor: c("empty") },
        }),
    },
    {
      name: "volcano",
      height: 400,
      colours: { up: "#9b2226", down: "#005f73", ns: "#ca6702" },
      make: (el, c) =>
        createVolcano(el, {
          data: {
            columns: {
              x: Array.from({ length: 60 }, (_, i) => (i - 30) / 6),
              y: Array.from({ length: 60 }, (_, i) => (i % 15) + 0.5),
            },
          },
          options: {
            pointSize: 8,
            labelTopN: 0,
            colors: { up: c("up"), down: c("down"), ns: c("ns") },
          },
        }),
    },
    {
      name: "network",
      height: 400,
      colours: { node: "#9b2226", edge: "#ca6702" },
      make: (el, c) =>
        createNetwork(el, {
          data: {
            columns: {
              id: ["a", "b", "c", "d"],
              x: [0, 1, 1, 0],
              y: [0, 0, 1, 1],
              size: [14, 14, 14, 14],
            },
            meta: {
              edges: [
                ["a", "b"],
                ["b", "c"],
                ["c", "d"],
              ],
            },
          },
          options: {
            defaultNodeColor: c("node"),
            defaultEdgeColor: c("edge"),
          },
        }),
    },
  ];

  for (const k of cases) {
    it(`draws the ${k.name} as it does with the colours given directly`, async () => {
      const make = (byVar: boolean) => (el: HTMLElement) => {
        for (const [name, value] of Object.entries(k.colours)) {
          el.style.setProperty(`--o-${name}`, value);
        }
        return k.make(el, (name) =>
          byVar ? `var(--o-${name})` : (k.colours[name] as string),
        );
      };
      const want = await drawn(k.name, k.height, make(false));
      const got = await drawn(k.name, k.height, make(true));
      expect(differing(want, got)).toBe(0);
    });
  }
});
