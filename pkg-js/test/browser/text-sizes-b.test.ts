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

function dotplotData(genes = GENES, groups = GROUPS): PlotomicsData {
  const gene: string[] = [];
  const cluster: string[] = [];
  const pct: number[] = [];
  const value: (number | null)[] = [];
  for (let i = 0; i < genes.length; i += 1) {
    for (let j = 0; j < groups.length; j += 1) {
      gene.push(genes[i] as string);
      cluster.push(groups[j] as string);
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

/** The value range of row `i`; by default 0 to 2.5, 5, 7.5 and so on. */
type RowRange = (i: number) => [number, number];

function violinData(
  feats = GENES.slice(0, 5),
  groups = GROUPS,
  range: RowRange = (i) => [0, (i + 1) * 2.5],
): PlotomicsData {
  const feature: string[] = [];
  const group: string[] = [];
  const density: number[] = [];
  const median: number[] = [];
  const n = 21;
  for (let i = 0; i < feats.length; i += 1) {
    for (let j = 0; j < groups.length; j += 1) {
      feature.push(feats[i] as string);
      group.push(groups[j] as string);
      const peak = ((i + j) % 5) / 5;
      for (let k = 0; k < n; k += 1) {
        density.push(Math.exp(-(((k / (n - 1) - peak) / 0.2) ** 2)));
      }
      median.push(peak * (i + 1) * 2.5);
    }
  }
  // Each row has its own range.
  const grids: number[] = [];
  for (let i = 0; i < feats.length; i += 1) {
    const [lo, hi] = range(i);
    for (let k = 0; k < n; k += 1) grids.push(lo + (k / (n - 1)) * (hi - lo));
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

const pad = (i: number) => String(i + 1).padStart(2, "0");

function matrixData(
  nrows: number,
  ncols: number,
  {
    rowName = (i: number) => `GENE_${pad(i)}`,
    colName = (i: number) => `sample_${pad(i)}`,
    value = (k: number) => Math.sin(k * 0.37) * 3 + (k % 7),
    missing = true,
  } = {},
): PlotomicsData {
  const values = Float64Array.from({ length: nrows * ncols }, (_, k) =>
    value(k),
  );
  if (missing) values[5] = Number.NaN;
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => rowName(i)),
      colLabels: Array.from({ length: ncols }, (_, i) => colName(i)),
    },
  };
}

function hicData(n = 64, binSize = 10_000): PlotomicsData {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      values[r * n + c] = 1000 / (Math.abs(r - c) + 1);
  }
  return { columns: { values }, meta: { n, binSize } };
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

// ---- narrow and short widgets, large text, long and wide labels ----------

const LONG_GENES = Array.from(
  { length: 25 },
  (_, i) => `ENSG000001${41510 + i}_GENE${i}`,
);
const LONG_GROUPS = Array.from(
  { length: 24 },
  (_, i) => `Cluster ${i + 1} activated T`,
);
const longMatrix = () =>
  matrixData(60, 40, {
    rowName: (i) => `ENSG000001${41510 + i}_LONG_GENE_NAME`,
    colName: (i) => `patient_${i}_tumour_biopsy_rep1`,
  });
/** Colour bar labels from -123.45 to 88.28, wider than the default gutter. */
const wideMatrix = () =>
  matrixData(20, 10, { value: (k) => -123.45 + (k % 50) * 4.321 });
/** Value axis labels such as -0.0123 and 12346. */
const wideViolin = () =>
  violinData(GENES.slice(0, 5), GROUPS, (i) => [
    -0.0123 * (i + 1),
    12345.6 * (i + 1),
  ]);
const themed = (fontSize: number) => ({ theme: { fontSize } });

/**
 * Neighbouring labels turned 45 degrees whose lines are less than one size
 * from each other: their letters run into each other.
 */
function crowdedDiagonals(el: HTMLElement): string[] {
  const at = (t: SVGTextElement) => Number(t.getAttribute("x"));
  const diag = texts(el)
    .filter((t) => turn(t) === -45 && t.textContent)
    .sort((a, b) => at(a) - at(b));
  const out: string[] = [];
  for (let i = 1; i < diag.length; i += 1) {
    const a = diag[i - 1] as SVGTextElement;
    const b = diag[i] as SVGTextElement;
    if ((at(b) - at(a)) * Math.SQRT1_2 < fontSize(b) - 0.5) {
      out.push(`"${a.textContent}" and "${b.textContent}"`);
    }
  }
  return out;
}

interface Hard {
  what: string;
  /** The entry of CASES whose roles name the text. */
  kind: string;
  width: number;
  height: number;
  make(el: HTMLElement): PlotomicsInstance<unknown>;
  /** Labels that must be drawn in full, not shortened or cut. */
  shows?: string[];
}

const hicTicks = ([fontSize, width, n, binSize]: number[]): Hard => ({
  what: `hic ticks, ${n} bins, fontSize ${fontSize}`,
  kind: "hic",
  width: width as number,
  height: 480,
  make: (el) =>
    createHic(el, {
      data: hicData(n, binSize),
      options: { label: "chr1", ...themed(fontSize as number) },
    }),
});

const HARD: Hard[] = [
  // Tick labels that do not fit even at the coarsest nice step.
  ...[
    [16, 300, 64, 10_000],
    [20, 360, 64, 10_000],
    [24, 420, 64, 10_000],
    [16, 320, 2490, 100_000],
    [20, 380, 2490, 100_000],
    [24, 440, 2490, 100_000],
  ].map(hicTicks),
  {
    what: "hic, 1 Mb in 2.5 kb bins, fontSize 24",
    kind: "hic",
    width: 300,
    height: 480,
    make: (el) =>
      createHic(el, {
        data: hicData(400, 2_500),
        options: { label: "chr1", ...themed(24) },
      }),
  },
  // Group labels turned 45 degrees in narrow columns.
  {
    what: "dotplot, 6 groups, fontSize 16",
    kind: "dotplot",
    width: 300,
    height: 560,
    make: (el) =>
      createDotplot(el, { data: dotplotData(), options: themed(16) }),
  },
  {
    what: "dotplot, 24 long groups",
    kind: "dotplot",
    width: 600,
    height: 560,
    make: (el) =>
      createDotplot(el, { data: dotplotData(LONG_GENES, LONG_GROUPS) }),
  },
  {
    what: "violin, 16 long groups",
    kind: "violin",
    width: 400,
    height: 560,
    make: (el) =>
      createViolin(el, {
        data: violinData(LONG_GENES.slice(0, 12), LONG_GROUPS.slice(0, 16)),
      }),
  },
  // The dotplot legends in a narrow or a short widget.
  ...[
    [300, 400, 24],
    [800, 200, 16],
    [800, 240, 20],
    [800, 280, 24],
    [800, 240, 24],
  ].map(
    ([width, height, fontSize]): Hard => ({
      what: `dotplot legends, fontSize ${fontSize}`,
      kind: "dotplot",
      width: width as number,
      height: height as number,
      make: (el) =>
        createDotplot(el, {
          data: dotplotData(),
          options: themed(fontSize as number),
        }),
    }),
  ),
  // Heatmap margins and colour bar with long labels.
  ...[
    [300, 480, 24],
    [300, 480, 16],
    [800, 240, 18],
    [800, 300, 24],
  ].map(
    ([width, height, fontSize]): Hard => ({
      what: `heatmap with long labels, fontSize ${fontSize}`,
      kind: "heatmap",
      width: width as number,
      height: height as number,
      make: (el) =>
        createHeatmap(el, {
          data: longMatrix(),
          options: themed(fontSize as number),
        }),
    }),
  ),
  {
    // Short enough that the colour bar would be shorter than its labels.
    what: "heatmap colour bar, fontSize 24",
    kind: "heatmap",
    width: 800,
    height: 140,
    make: (el) =>
      createHeatmap(el, {
        data: matrixData(60, 40, { missing: false }),
        options: themed(24),
      }),
  },
  {
    what: "violin value axis, fontSize 24",
    kind: "violin",
    width: 800,
    height: 560,
    make: (el) => createViolin(el, { data: violinData(), options: themed(24) }),
  },
  // Colour bar and value axis labels wider than the default gutters.
  {
    what: "clustermap with wide colour bar labels, fontSize 16",
    kind: "clustermap",
    width: 800,
    height: 480,
    make: (el) =>
      createClustermap(el, { data: wideMatrix(), options: themed(16) }),
    shows: ["88.28", "-17.59", "-123.45"],
  },
  {
    what: "heatmap with wide colour bar labels, fontSize 16",
    kind: "heatmap",
    width: 800,
    height: 480,
    make: (el) =>
      createHeatmap(el, { data: wideMatrix(), options: themed(16) }),
    shows: ["88.28", "-17.59", "-123.45"],
  },
  {
    what: "violin with wide value axis labels, fontSize 16",
    kind: "violin",
    width: 800,
    height: 560,
    make: (el) => createViolin(el, { data: wideViolin(), options: themed(16) }),
    shows: ["-0.0123", "12346"],
  },
];

describe("text in narrow and short widgets, at large sizes", () => {
  it.each(HARD)("$what, $width x $height px", (h) => {
    const el = container(h.width, h.height);
    instances.push(h.make(el));
    expectInside(el);
    const c = CASES.find((k) => k.name === h.kind) as Case;
    for (const [what, group] of Object.entries(c.roles(el).spaced)) {
      expectNoOverlap(group, what);
    }
    expect(crowdedDiagonals(el)).toEqual([]);
    const drawn = texts(el).map((t) => t.textContent);
    for (const s of h.shows ?? []) expect(drawn).toContain(s);
  });

  it("leaves the heatmap a quarter of a 300 px widget at fontSize 24", () => {
    const el = container(300, 480);
    instances.push(
      createHeatmap(el, { data: longMatrix(), options: themed(24) }),
    );
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.getBoundingClientRect().width).toBeGreaterThanOrEqual(75);
  });

  it("leaves the hic map a quarter of a 300 px widget at fontSize 24", () => {
    const el = container(300, 480);
    instances.push(
      createHic(el, {
        data: hicData(400, 2_500),
        options: { label: "chr1", ...themed(24) },
      }),
    );
    const frame = el.querySelector("svg rect") as SVGRectElement;
    expect(frame.getBoundingClientRect().width).toBeGreaterThanOrEqual(75);
  });
});
