import { afterEach, describe, expect, it } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import { createDotplot } from "../../src/components/dotplot.js";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createHic } from "../../src/components/hic.js";
import { createViolin } from "../../src/components/violin.js";
import {
  type PlotomicsData,
  type PlotomicsInstance,
  type PlotomicsTheme,
  defaultTheme,
  textSizes,
} from "../../src/core/index.js";

// Chart text takes its size from theme.fontSize through textSizes(), and the
// layout makes room for it. At the default size and at 16 px, in a wide and
// a narrow widget, no text runs past the widget, and labels that the layout
// spaces out do not overlap.

type Theme = Partial<PlotomicsTheme>;
const BIG: Theme = { fontSize: 16 };

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

const texts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
const fontSize = (t: SVGTextElement) => Number(t.getAttribute("font-size"));
const anchor = (t: SVGTextElement) => t.getAttribute("text-anchor");
/** The angle a text is turned by, 0 when it is not turned. */
const turn = (t: SVGTextElement) =>
  Number(/rotate\((-?\d+)/.exec(t.getAttribute("transform") ?? "")?.[1] ?? 0);

/**
 * The box of a text on screen, one em deep. A text's box spans the line
 * height, about 1.36 times its size, across the line. Trimmed to one em,
 * two labels whose lines are one size from each other do not touch.
 */
function emBox(t: SVGTextElement) {
  const r = t.getBoundingClientRect();
  const trim = 0.18 * fontSize(t);
  const across = Math.abs(turn(t)) === 90;
  return {
    left: r.left + (across ? trim : 0),
    right: r.right - (across ? trim : 0),
    top: r.top + (across ? 0 : trim),
    bottom: r.bottom - (across ? 0 : trim),
  };
}

function expectInside(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  for (const t of texts(el)) {
    const r = t.getBoundingClientRect();
    const what = `"${t.textContent}"`;
    expect(r.left, what).toBeGreaterThanOrEqual(box.left - 0.5);
    expect(r.right, what).toBeLessThanOrEqual(box.right + 0.5);
    expect(r.top, what).toBeGreaterThanOrEqual(box.top - 0.5);
    expect(r.bottom, what).toBeLessThanOrEqual(box.bottom + 0.5);
  }
}

function expectNoOverlap(group: SVGTextElement[], what: string) {
  const boxes = group.map(emBox);
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const a = boxes[i] as ReturnType<typeof emBox>;
      const b = boxes[j] as ReturnType<typeof emBox>;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const pair = `${what}: "${group[i]?.textContent}" and "${group[j]?.textContent}"`;
      expect(ox > 0.5 && oy > 0.5, pair).toBe(false);
    }
  }
}

// ---- data ----------------------------------------------------------------

const GENES = ["CD3E", "MS4A1", "LYZ", "NKG7", "HLA-DRA", "PPBP", "GNLY"];
const GROUPS = [
  "T cells",
  "B cells",
  "CD14 Monocytes",
  "NK cells",
  "Dendritic cells",
  "Platelets",
];

function dotplotData(): PlotomicsData {
  const gene: string[] = [];
  const cluster: string[] = [];
  const pct: number[] = [];
  const value: (number | null)[] = [];
  for (let i = 0; i < GENES.length; i += 1) {
    for (let j = 0; j < GROUPS.length; j += 1) {
      gene.push(GENES[i] as string);
      cluster.push(GROUPS[j] as string);
      pct.push(10 + ((i * 37 + j * 23) % 90));
      // One missing value, so the legend keys the open ring.
      value.push(i === 2 && j === 3 ? null : ((i * 7 + j * 3) % 10) / 3);
    }
  }
  return {
    columns: { gene, cluster, pct, value: value as number[] },
    meta: { valueLabel: "mean expression" },
  };
}

function violinData(): PlotomicsData {
  const feats = GENES.slice(0, 5);
  const feature: string[] = [];
  const group: string[] = [];
  const density: number[] = [];
  const median: number[] = [];
  const n = 21;
  for (let i = 0; i < feats.length; i += 1) {
    for (let j = 0; j < GROUPS.length; j += 1) {
      feature.push(feats[i] as string);
      group.push(GROUPS[j] as string);
      const peak = ((i + j) % 5) / 5;
      for (let k = 0; k < n; k += 1) {
        density.push(Math.exp(-(((k / (n - 1) - peak) / 0.2) ** 2)));
      }
      median.push(peak * (i + 1) * 2.5);
    }
  }
  // Each row has its own range, from 0 to 2.5, 5, 7.5, 10 and 12.5.
  const grids: number[] = [];
  for (let i = 0; i < feats.length; i += 1) {
    for (let k = 0; k < n; k += 1) grids.push((k / (n - 1)) * (i + 1) * 2.5);
  }
  return {
    columns: { feature, group },
    meta: {
      grid: Array.from({ length: n }, (_, k) => k / (n - 1)),
      grids,
      density,
      median,
    },
  };
}

function matrixData(nrows: number, ncols: number): PlotomicsData {
  const values = Float64Array.from(
    { length: nrows * ncols },
    (_, k) => Math.sin(k * 0.37) * 3 + (k % 7),
  );
  values[5] = Number.NaN;
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => `GENE_${pad(i)}`),
      colLabels: Array.from({ length: ncols }, (_, i) => `sample_${pad(i)}`),
    },
  };
}

function hicData(): PlotomicsData {
  const n = 64;
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      values[r * n + c] = 1000 / (Math.abs(r - c) + 1);
  }
  return { columns: { values }, meta: { n, binSize: 10_000 } };
}

// ---- the components and the roles of their text -------------------------

interface Roles {
  /** Texts at the label size: ticks, category labels, legend entries. */
  labels: SVGTextElement[];
  /** Texts at the axis title size: axis, legend and colour bar titles. */
  titles: SVGTextElement[];
  /** Groups of labels the layout spaces out, which must not overlap. */
  spaced: Record<string, SVGTextElement[]>;
}

interface Case {
  name: string;
  /** The component's default height. */
  height: number;
  make(el: HTMLElement, theme: Theme): PlotomicsInstance<unknown>;
  roles(el: HTMLElement): Roles;
}

const CASES: Case[] = [
  {
    name: "dotplot",
    height: 560,
    make: (el, theme) =>
      createDotplot(el, { data: dotplotData(), options: { theme } }),
    roles(el) {
      const all = texts(el);
      const rows = all.filter((t) => anchor(t) === "end" && turn(t) === 0);
      const cols = all.filter((t) => turn(t) === -45);
      const legend = all.filter((t) => anchor(t) === "start");
      const isTitle = (t: SVGTextElement) =>
        ["mean expression", "% expressing"].includes(t.textContent ?? "");
      return {
        labels: [...rows, ...cols, ...legend.filter((t) => !isTitle(t))],
        titles: legend.filter(isTitle),
        spaced: { "row labels": rows, legend },
      };
    },
  },
  {
    name: "violin",
    height: 560,
    make: (el, theme) =>
      createViolin(el, { data: violinData(), options: { theme } }),
    roles(el) {
      const all = texts(el);
      const rows = all.filter((t) => anchor(t) === "end" && turn(t) === 0);
      const cols = all.filter((t) => turn(t) === -45);
      const values = all.filter((t) => anchor(t) === "start");
      return {
        labels: [...rows, ...cols, ...values],
        titles: [],
        spaced: { "feature labels": rows, "value axis labels": values },
      };
    },
  },
  {
    name: "heatmap",
    height: 480,
    make: (el, theme) =>
      createHeatmap(el, { data: matrixData(24, 12), options: { theme } }),
    roles(el) {
      const all = texts(el);
      const rows = all.filter((t) => anchor(t) === "end" && turn(t) === 0);
      const cols = all.filter((t) => turn(t) === -90);
      const ticks = all.filter((t) => anchor(t) === "start");
      const title = all.filter((t) => t.textContent === "value");
      return {
        labels: [...rows, ...cols, ...ticks],
        titles: title,
        spaced: {
          "row labels": rows,
          "column labels": cols,
          "colour bar": [...ticks, ...title],
        },
      };
    },
  },
  {
    name: "clustermap",
    height: 560,
    make: (el, theme) =>
      createClustermap(el, { data: matrixData(20, 10), options: { theme } }),
    roles(el) {
      const all = texts(el);
      const flat = all.filter((t) => anchor(t) === "start" && turn(t) === 0);
      const rows = flat.filter((t) => /^GENE/.test(t.textContent ?? ""));
      const ticks = flat.filter((t) => !rows.includes(t));
      const cols = all.filter((t) => turn(t) === -90 && anchor(t) === "end");
      const title = all.filter((t) => anchor(t) === "middle");
      return {
        labels: [...rows, ...cols, ...ticks],
        titles: title,
        spaced: {
          "row labels": rows,
          "column labels": cols,
          "colour bar": [...ticks, ...title],
        },
      };
    },
  },
  {
    name: "hic",
    height: 480,
    make: (el, theme) =>
      createHic(el, { data: hicData(), options: { theme, label: "chr1" } }),
    roles(el) {
      const all = texts(el);
      const isTitle = (t: SVGTextElement) =>
        ["chr1", "contacts (log)"].includes(t.textContent ?? "");
      const x = all.filter(
        (t) => anchor(t) === "middle" && turn(t) === 0 && !isTitle(t),
      );
      const y = all.filter((t) => anchor(t) === "end");
      const values = all.filter((t) => anchor(t) === "start");
      const cbTitle = all.filter((t) => t.textContent === "contacts (log)");
      return {
        labels: [...x, ...y, ...values],
        titles: all.filter(isTitle),
        spaced: {
          "x axis ticks": x,
          "y axis ticks": y,
          "colour bar": [...values, ...cbTitle],
        },
      };
    },
  },
];

const THEMES: [string, Theme][] = [
  ["the default theme", {}],
  ["fontSize 16", BIG],
];

describe.each(CASES)("$name text", (c) => {
  it.each(THEMES)("takes its sizes from textSizes at %s", (_, theme) => {
    const el = container(800, c.height);
    instances.push(c.make(el, theme));
    const sizes = textSizes({ ...defaultTheme, ...theme });
    const { labels, titles } = c.roles(el);
    expect(labels.length).toBeGreaterThan(0);
    for (const t of labels) {
      expect(fontSize(t), `"${t.textContent}"`).toBe(sizes.label);
    }
    for (const t of titles) {
      expect(fontSize(t), `"${t.textContent}"`).toBe(sizes.axisTitle);
    }
  });

  it("follows a theme set through setOptions", () => {
    const el = container(800, c.height);
    const plot = c.make(el, {});
    instances.push(plot);
    plot.setOptions({ theme: BIG });
    const sizes = textSizes({ ...defaultTheme, ...BIG });
    const { labels, titles } = c.roles(el);
    expect(labels.length).toBeGreaterThan(0);
    for (const t of labels) expect(fontSize(t)).toBe(sizes.label);
    for (const t of titles) expect(fontSize(t)).toBe(sizes.axisTitle);
  });

  for (const width of [800, 400]) {
    it.each(THEMES)(
      `keeps its text inside a ${width} px widget, unclipped and clear, at %s`,
      (_, theme) => {
        const el = container(width, c.height);
        instances.push(c.make(el, theme));
        expectInside(el);
        for (const [what, group] of Object.entries(c.roles(el).spaced)) {
          expect(group.length, what).toBeGreaterThan(0);
          expectNoOverlap(group, what);
        }
      },
    );
  }
});
