import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createNetwork } from "../../src/components/network.js";
import { createSpatial } from "../../src/components/spatial.js";
import { createTreemap } from "../../src/components/treemap.js";
import { createVolcano } from "../../src/components/volcano.js";
import {
  type PlotomicsInstance,
  type PlotomicsTheme,
  textSizes,
} from "../../src/core/index.js";

// Chart text takes its size from theme.fontSize (issue #112), and the layout
// makes room for it: no text runs past the widget edge, and labels that the
// layout keeps separate do not overlap. Each component is checked at the
// default theme and at fontSize 16, at its usual width and at 400 px.

type Theme = Partial<PlotomicsTheme>;
const THEMES: { name: string; theme: Theme }[] = [
  { name: "the default theme", theme: {} },
  { name: "fontSize 16", theme: { fontSize: 16 } },
];
const sizesOf = (theme: Theme) => textSizes({ fontSize: theme.fontSize ?? 12 });

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const poll = { timeout: 10_000, interval: 50 };

/** The SVG texts of a widget that show something. */
function svgTexts(el: HTMLElement): SVGTextElement[] {
  return (
    Array.from(el.querySelectorAll("svg text")) as SVGTextElement[]
  ).filter((t) => (t.textContent ?? "") !== "");
}
const sizeOf = (t: Element) => Number(t.getAttribute("font-size"));
const sizesIn = (texts: Element[]) => [...new Set(texts.map(sizeOf))];
const isNumber = (t: Element) =>
  (t.textContent ?? "") !== "" && Number.isFinite(Number(t.textContent));
const named = (el: HTMLElement, text: string) =>
  svgTexts(el).filter((t) => t.textContent === text);

/** Texts whose box runs past the widget edge, as "text: side". */
function outside(el: HTMLElement): string[] {
  const box = el.getBoundingClientRect();
  const out: string[] = [];
  for (const t of svgTexts(el)) {
    const r = t.getBoundingClientRect();
    const name = t.textContent ?? "";
    if (r.left < box.left - 0.5) out.push(`${name}: left`);
    if (r.right > box.right + 0.5) out.push(`${name}: right`);
    if (r.top < box.top - 0.5) out.push(`${name}: top`);
    if (r.bottom > box.bottom + 0.5) out.push(`${name}: bottom`);
  }
  return out;
}

/**
 * Pairs of texts whose boxes overlap by more than 1 px both ways. The box of
 * an SVG text is its line box, which reaches past the glyphs, so a 1 px
 * touch is not counted.
 */
function overlaps(texts: Element[]): string[] {
  const boxes = texts.map((t) => ({
    name: t.textContent ?? "",
    r: t.getBoundingClientRect(),
  }));
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]?.r as DOMRect;
      const b = boxes[j]?.r as DOMRect;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) out.push(`${boxes[i]?.name} / ${boxes[j]?.name}`);
    }
  }
  return out;
}

/** Deterministic values spread over [lo, hi]. */
function spread(n: number, lo: number, hi: number, seed: number) {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  });
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

// ---------------------------------------------------------------------------
// Volcano
// ---------------------------------------------------------------------------

function volcanoData() {
  const n = 2000;
  const x = spread(n, -4, 4, 1);
  const y = spread(n, 0, 20, 2);
  const label = x.map((_, i) => `G${i}`);
  return { columns: { x, y, label } };
}

/** Tick labels, axis titles and gene labels of a volcano. */
function volcanoParts(el: HTMLElement) {
  const all = svgTexts(el);
  return {
    xTicks: all.filter(
      (t) => isNumber(t) && t.getAttribute("text-anchor") === "middle",
    ),
    yTicks: all.filter(
      (t) => isNumber(t) && t.getAttribute("text-anchor") === "end",
    ),
    titles: [...named(el, "log2 fold change"), ...named(el, "-log10 p-value")],
    genes: all.filter((t) => /^G\d+$/.test(t.textContent ?? "")),
  };
}

/** Wait for the fitted view: gene labels drawn, and the overlay settled. */
async function volcanoReady(el: HTMLElement) {
  await expect
    .poll(() => volcanoParts(el).genes.length, poll)
    .toBeGreaterThan(0);
  await wait(300);
}

describe("volcano text sizes", () => {
  it("sizes ticks, titles and gene labels from theme.fontSize, and again after setOptions", async () => {
    const el = container(800, 400);
    const v = createVolcano(el, { data: volcanoData() });
    instances.push(v);
    await volcanoReady(el);
    for (const theme of [{}, { fontSize: 16 }]) {
      if (theme.fontSize) {
        v.setOptions({ theme });
        await wait(300);
      }
      const s = sizesOf(theme);
      const p = volcanoParts(el);
      expect(p.xTicks.length).toBeGreaterThan(2);
      expect(p.yTicks.length).toBeGreaterThan(2);
      expect(sizesIn([...p.xTicks, ...p.yTicks])).toEqual([s.label]);
      expect(sizesIn(p.genes)).toEqual([s.label]);
      expect(p.titles.length).toBe(2);
      expect(sizesIn(p.titles)).toEqual([s.axisTitle]);
    }
  });

  for (const { name, theme } of THEMES) {
    for (const width of [800, 400]) {
      it(`keeps text inside the widget and ticks from overlapping, ${name}, ${width} px`, async () => {
        const el = container(width, 400);
        instances.push(
          createVolcano(el, { data: volcanoData(), options: { theme } }),
        );
        await volcanoReady(el);
        const s = sizesOf(theme);
        const p = volcanoParts(el);
        expect(sizesIn([...p.xTicks, ...p.yTicks])).toEqual([s.label]);
        expect(sizesIn(p.titles)).toEqual([s.axisTitle]);
        expect(outside(el)).toEqual([]);
        expect(overlaps(p.xTicks)).toEqual([]);
        expect(overlaps(p.yTicks)).toEqual([]);
        // The y title clears the y tick labels, and the x title the x ticks.
        expect(overlaps([...p.yTicks, ...named(el, "-log10 p-value")])).toEqual(
          [],
        );
        expect(
          overlaps([...p.xTicks, ...named(el, "log2 fold change")]),
        ).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

const CLUSTERS = [
  "B cells",
  "CD4 T cells",
  "CD8 T cells",
  "NK cells",
  "Monocytes",
  "Dendritic cells",
  "Platelets",
  "Plasmablasts",
];

function embeddingData(continuous: boolean) {
  const n = 800;
  const x = spread(n, -8, 12, 3);
  const y = spread(n, -6, 9, 4);
  const color = continuous
    ? spread(n, 0, 4.5, 5)
    : x.map((_, i) => CLUSTERS[i % CLUSTERS.length] as string);
  return { columns: { x, y, color } };
}

/** Tick labels, axis titles and legend entries of an embedding. */
function embeddingParts(el: HTMLElement) {
  const all = svgTexts(el);
  const titles = [...named(el, "UMAP 1"), ...named(el, "UMAP 2")];
  return {
    xTicks: all.filter(
      (t) => isNumber(t) && t.getAttribute("text-anchor") === "middle",
    ),
    yTicks: all.filter(
      (t) => isNumber(t) && t.getAttribute("text-anchor") === "end",
    ),
    titles,
    legend: all.filter((t) => t.getAttribute("text-anchor") === "start"),
  };
}

async function embeddingReady(el: HTMLElement) {
  await expect
    .poll(() => embeddingParts(el).legend.length, poll)
    .toBeGreaterThan(2);
  await wait(300);
}

describe("embedding text sizes", () => {
  it("sizes ticks, titles and legend entries from theme.fontSize, and again after setOptions", async () => {
    const el = container(600, 400);
    const e = createEmbedding(el, {
      data: embeddingData(false),
      options: { showAxes: true },
    });
    instances.push(e);
    await embeddingReady(el);
    for (const theme of [{}, { fontSize: 16 }]) {
      if (theme.fontSize) {
        e.setOptions({ theme });
        await wait(300);
      }
      const s = sizesOf(theme);
      const p = embeddingParts(el);
      expect(p.xTicks.length).toBeGreaterThan(2);
      expect(p.yTicks.length).toBeGreaterThan(2);
      expect(sizesIn([...p.xTicks, ...p.yTicks])).toEqual([s.label]);
      expect(p.legend.map((t) => t.textContent)).toEqual(
        expect.arrayContaining(CLUSTERS),
      );
      expect(sizesIn(p.legend)).toEqual([s.label]);
      expect(p.titles.length).toBe(2);
      expect(sizesIn(p.titles)).toEqual([s.axisTitle]);
    }
  });

  for (const { name, theme } of THEMES) {
    for (const width of [600, 400]) {
      for (const continuous of [false, true]) {
        const key = continuous ? "colour bar" : "legend";
        it(`keeps text inside the widget and labels from overlapping, ${key}, ${name}, ${width} px`, async () => {
          const el = container(width, 400);
          instances.push(
            createEmbedding(el, {
              data: embeddingData(continuous),
              options: { showAxes: true, theme },
            }),
          );
          await embeddingReady(el);
          const s = sizesOf(theme);
          const p = embeddingParts(el);
          expect(sizesIn([...p.xTicks, ...p.yTicks, ...p.legend])).toEqual([
            s.label,
          ]);
          expect(sizesIn(p.titles)).toEqual([s.axisTitle]);
          expect(outside(el)).toEqual([]);
          expect(overlaps(p.xTicks)).toEqual([]);
          expect(overlaps(p.yTicks)).toEqual([]);
          expect(overlaps(p.legend)).toEqual([]);
          expect(overlaps([...p.yTicks, ...named(el, "UMAP 2")])).toEqual([]);
          expect(overlaps([...p.xTicks, ...named(el, "UMAP 1")])).toEqual([]);
        });
      }
    }
  }

  it("keeps a long category list inside a short plot", async () => {
    const el = container(400, 260);
    const labels = Array.from({ length: 18 }, (_, i) => `cluster ${i + 1}`);
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: labels.map((_, i) => i),
            y: labels.map((_, i) => i % 5),
            color: labels,
          },
        },
        options: { theme: { fontSize: 16 } },
      }),
    );
    await expect.poll(() => named(el, "cluster 1").length, poll).toBe(1);
    await wait(200);
    expect(outside(el)).toEqual([]);
    expect(
      svgTexts(el).some((t) => /^\+\d+ more$/.test(t.textContent ?? "")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spatial
// ---------------------------------------------------------------------------

const REGIONS = ["Tumour", "Stroma", "Immune infiltrate", "Normal epithelium"];

function spatialData(continuous: boolean) {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      x.push(5 + i * 10);
      y.push(5 + j * 10);
    }
  }
  const color = continuous
    ? x.map((v, i) => (i % 17 === 0 ? null : v * 12.5))
    : x.map((_, i) => (i % 17 === 0 ? null : REGIONS[i % REGIONS.length]));
  return {
    columns: { x, y, color: color as unknown as string[] },
    meta: { imgWidth: 160, imgHeight: 100, spotDiameter: 8 },
  };
}

describe("spatial text sizes", () => {
  it("sizes legend entries from theme.fontSize, and again after setOptions", () => {
    const el = container(600, 400);
    const sp = createSpatial(el, {
      data: spatialData(false),
      options: { showImage: false },
    });
    instances.push(sp);
    for (const theme of [{}, { fontSize: 16 }]) {
      if (theme.fontSize) sp.setOptions({ theme });
      const legend = svgTexts(el);
      expect(legend.map((t) => t.textContent)).toEqual(
        expect.arrayContaining([...REGIONS, "NA"]),
      );
      expect(sizesIn(legend)).toEqual([sizesOf(theme).label]);
    }
  });

  for (const { name, theme } of THEMES) {
    for (const width of [600, 400]) {
      for (const continuous of [false, true]) {
        const key = continuous ? "colour bar" : "legend";
        it(`keeps text inside the widget and legend entries from overlapping, ${key}, ${name}, ${width} px`, () => {
          const el = container(width, 400);
          instances.push(
            createSpatial(el, {
              data: spatialData(continuous),
              options: { showImage: false, theme },
            }),
          );
          const all = svgTexts(el);
          expect(all.length).toBeGreaterThan(2);
          expect(sizesIn(all)).toEqual([sizesOf(theme).label]);
          expect(outside(el)).toEqual([]);
          expect(overlaps(all)).toEqual([]);
        });
      }
    }
  }

  it("keeps a long level list inside a short widget", () => {
    const el = container(400, 200);
    const levels = Array.from({ length: 14 }, (_, i) => `region ${i + 1}`);
    const data = spatialData(false);
    data.columns.color = data.columns.x.map(
      (_, i) => levels[i % levels.length] as string,
    );
    instances.push(
      createSpatial(el, {
        data,
        options: { showImage: false, theme: { fontSize: 16 } },
      }),
    );
    expect(outside(el)).toEqual([]);
    expect(overlaps(svgTexts(el))).toEqual([]);
    expect(
      svgTexts(el).some((t) => /^\+\d+ more$/.test(t.textContent ?? "")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

/** Three pathways of genes, with long pathway names. */
function treemapData() {
  const id = ["root", "P1", "P2", "P3"];
  const parent = ["", "root", "root", "root"];
  const value = [0, 0, 0, 0];
  const labels = [
    "All pathways",
    "Oxidative phosphorylation",
    "Cell cycle checkpoints",
    "Interferon gamma response",
  ];
  for (let i = 0; i < 24; i += 1) {
    id.push(`g${i}`);
    parent.push(`P${(i % 3) + 1}`);
    value.push(((i * 7) % 11) + 2);
    labels.push(`GENE${i}A`);
  }
  return { columns: { id, parent, value }, meta: { labels } };
}

describe("treemap text sizes", () => {
  it("sizes tile labels, group names and the breadcrumb from theme.fontSize, and again after setOptions", () => {
    const el = container(600, 400);
    const tm = createTreemap(el, {
      data: treemapData(),
      options: { colorBy: "value" },
    });
    instances.push(tm);
    for (const theme of [{}, { fontSize: 16 }]) {
      if (theme.fontSize) tm.setOptions({ theme });
      const s = sizesOf(theme);
      const crumb = named(el, "All pathways");
      const labels = svgTexts(el).filter(
        (t) => !crumb.includes(t) && t.textContent !== "›",
      );
      // Gene tiles, group names and the two ends of the value key.
      expect(labels.length).toBeGreaterThan(5);
      expect(sizesIn(labels)).toEqual([s.label]);
      expect(sizesIn(crumb)).toEqual([s.axisTitle]);
    }
  });

  for (const { name, theme } of THEMES) {
    for (const width of [600, 400]) {
      for (const colorBy of ["parent", "value"] as const) {
        it(`keeps text inside the widget and labels from overlapping, colorBy ${colorBy}, ${name}, ${width} px`, () => {
          const el = container(width, 400);
          instances.push(
            createTreemap(el, {
              data: treemapData(),
              options: { colorBy, theme },
            }),
          );
          const all = svgTexts(el);
          expect(all.length).toBeGreaterThan(5);
          expect(outside(el)).toEqual([]);
          expect(overlaps(all)).toEqual([]);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

const GENES = [
  "TP53",
  "MDM2",
  "CDKN1A",
  "BRCA1",
  "ATM",
  "CHEK2",
  "RB1",
  "E2F1",
  "MYC",
  "PTEN",
  "AKT1",
  "EGFR",
];

/** Twelve labelled genes on a ring, large enough for sigma to label. */
function networkData() {
  const n = GENES.length;
  const x = GENES.map((_, i) => Math.cos((2 * Math.PI * i) / n) * 10);
  const y = GENES.map((_, i) => Math.sin((2 * Math.PI * i) / n) * 10);
  const size = GENES.map(() => 10);
  const edges = GENES.map((g, i) => [g, GENES[(i + 1) % n]]);
  return { columns: { id: GENES, x, y, size }, meta: { edges } };
}

/**
 * Record the text sigma draws on its canvases: the font, and the left and
 * right edge in canvas pixels.
 */
function recordCanvasText() {
  const calls: {
    text: string;
    font: string;
    left: number;
    right: number;
    width: number;
  }[] = [];
  const proto = CanvasRenderingContext2D.prototype;
  const real = proto.fillText;
  proto.fillText = function (
    this: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ) {
    const m = this.getTransform();
    const w = this.measureText(text).width;
    calls.push({
      text,
      font: this.font,
      left: m.a * x + m.e,
      right: m.a * (x + w) + m.e,
      width: this.canvas.width,
    });
    return maxWidth === undefined
      ? real.call(this, text, x, y)
      : real.call(this, text, x, y, maxWidth);
  };
  return {
    calls,
    restore() {
      proto.fillText = real;
    },
  };
}
const pxOf = (font: string) => Number(/([\d.]+)px/.exec(font)?.[1]);

describe("network text sizes", () => {
  it("sizes node labels from theme.fontSize, and again after setOptions", async () => {
    const rec = recordCanvasText();
    try {
      const net = createNetwork(container(600, 400), { data: networkData() });
      instances.push(net);
      for (const theme of [{}, { fontSize: 16 }]) {
        // Sigma draws the first frame while it is created, so the record
        // starts empty only for the redraw after setOptions.
        if (theme.fontSize) {
          rec.calls.length = 0;
          net.setOptions({ theme });
        }
        await expect
          .poll(
            () => rec.calls.filter((c) => GENES.includes(c.text)).length,
            poll,
          )
          .toBeGreaterThan(3);
        const labels = rec.calls.filter((c) => GENES.includes(c.text));
        expect([...new Set(labels.map((c) => pxOf(c.font)))]).toEqual([
          sizesOf(theme).label,
        ]);
      }
    } finally {
      rec.restore();
    }
  });

  for (const { name, theme } of THEMES) {
    for (const width of [600, 400]) {
      it(`keeps node labels inside the widget, ${name}, ${width} px`, async () => {
        const rec = recordCanvasText();
        try {
          instances.push(
            createNetwork(container(width, 400), {
              data: networkData(),
              options: { theme },
            }),
          );
          await expect
            .poll(
              () => rec.calls.filter((c) => GENES.includes(c.text)).length,
              poll,
            )
            .toBeGreaterThan(3);
          const labels = rec.calls.filter((c) => GENES.includes(c.text));
          expect([...new Set(labels.map((c) => pxOf(c.font)))]).toEqual([
            sizesOf(theme).label,
          ]);
          const clipped = labels
            .filter((c) => c.left < 0 || c.right > c.width)
            .map((c) => c.text);
          expect(clipped).toEqual([]);
        } finally {
          rec.restore();
        }
      });
    }
  }
});
