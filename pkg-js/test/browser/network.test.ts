import { afterEach, describe, expect, it } from "vitest";
import { createNetwork } from "../../src/components/network.js";
import { OKABE_ITO, type PlotomicsInstance } from "../../src/core/index.js";
import { drawnPixels } from "./helpers.js";

// Sigma draws with WebGL, so export and the renderer's own checks need a
// real browser.

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

const poll = { timeout: 10_000, interval: 50 };

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

/** Twelve genes on a ring, at the default node size, with optional groups. */
function ring(groups?: (string | null)[]) {
  const n = GENES.length;
  const x = GENES.map((_, i) => Math.cos((2 * Math.PI * i) / n) * 10);
  const y = GENES.map((_, i) => Math.sin((2 * Math.PI * i) / n) * 10);
  const edges = GENES.map((g, i) => [g, GENES[(i + 1) % n]]);
  return {
    columns: { id: GENES, x, y },
    meta: { edges, ...(groups ? { nodeGroup: groups as string[] } : {}) },
  };
}

const PATHWAYS = ["p53 pathway", "Cell cycle", "PI3K signalling"];
/** Groups for {@link ring}: three pathways, and no group for the last gene. */
const ringGroups = () =>
  GENES.map((_, i) => (i === GENES.length - 1 ? null : PATHWAYS[i % 3]));

/** Record the text sigma draws on its labels canvas. */
function recordLabels() {
  const drawn: string[] = [];
  const proto = CanvasRenderingContext2D.prototype;
  const real = proto.fillText;
  proto.fillText = function (
    this: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ) {
    if (this.canvas.className === "sigma-labels") drawn.push(text);
    return maxWidth === undefined
      ? real.call(this, text, x, y)
      : real.call(this, text, x, y, maxWidth);
  };
  return {
    drawn,
    restore() {
      proto.fillText = real;
    },
  };
}

const legendTexts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
/** Right edge of the graph: sigma's canvases end there. */
const graphRight = (el: HTMLElement) =>
  (
    el.querySelector("canvas.sigma-nodes") as HTMLCanvasElement
  ).getBoundingClientRect().right;

/** A 40-node spiral with given coordinates and a chain of edges. */
function spiral() {
  const n = 40;
  const id = Array.from({ length: n }, (_, i) => `N${i}`);
  const x = Float64Array.from({ length: n }, (_, i) => Math.cos(i / 3) * i);
  const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 3) * i);
  const edges = id.slice(1).map((s, i) => [s, id[i]]);
  return { columns: { id, x, y }, meta: { edges } };
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("network in a browser", () => {
  it("exports the nodes and edges that are on screen", async () => {
    const net = createNetwork(container(), { data: spiral() });
    instances.push(net);
    await new Promise((r) => setTimeout(r, 300));

    const png = await net.exportPNG?.(1);
    // Before the fix every pixel was the background colour.
    expect(await drawnPixels(png as Blob)).toBeGreaterThan(1000);

    const svg = net.exportSVG?.() ?? "";
    expect(svg).toContain("data:image/png;base64,");
  });

  it("returns no image, without throwing, when the view is hidden", async () => {
    const el = container();
    const net = createNetwork(el, { data: spiral() });
    instances.push(net);
    el.style.display = "none";
    expect(net.exportSVG?.()).toBeNull();
    expect(await net.exportPNG?.(1)).toBeNull();
  });

  it("renders a correlation network with negative weights", () => {
    const n = 40;
    const id = Array.from({ length: n }, (_, i) => `N${i}`);
    const source: string[] = [];
    const target: string[] = [];
    const weight: number[] = [];
    for (let i = 0; i < n; i += 1) {
      for (const j of [i + 1, i + 7]) {
        if (j >= n) continue;
        source.push(`N${i}`);
        target.push(`N${j}`);
        weight.push(((i * 37 + j * 11) % 19) / 10 - 0.9);
      }
    }
    // Before the fix, sigma threw "Coordinates of node ... are invalid".
    expect(() => {
      instances.push(
        createNetwork(container(), {
          data: { columns: { id, source, target, weight } },
        }),
      );
    }).not.toThrow();
  });
});

describe("network labels and group legend", () => {
  it("labels nodes of the default size at the starting zoom", async () => {
    const rec = recordLabels();
    try {
      instances.push(createNetwork(container(), { data: ring() }));
      // Before the fix a threshold of 8 hid the label of every 4 px node
      // until about 4x zoom.
      await expect
        .poll(
          () => new Set(rec.drawn.filter((t) => GENES.includes(t))).size,
          poll,
        )
        .toBeGreaterThan(3);
    } finally {
      rec.restore();
    }
  });

  it("keeps the label grid thinning a crowded graph", async () => {
    const rec = recordLabels();
    try {
      const n = 400;
      const id = Array.from({ length: n }, (_, i) => `G${i}`);
      const x = id.map((_, i) => (i % 20) * 0.5);
      const y = id.map((_, i) => Math.floor(i / 20) * 0.5);
      instances.push(
        createNetwork(container(), { data: { columns: { id, x, y } } }),
      );
      await expect.poll(() => rec.drawn.length, poll).toBeGreaterThan(0);
      expect(new Set(rec.drawn).size).toBeLessThan(n / 4);
    } finally {
      rec.restore();
    }
  });

  it("draws a legend of the node groups in a gutter right of the graph", () => {
    const el = container();
    instances.push(createNetwork(el, { data: ring(ringGroups()) }));
    const texts = legendTexts(el);
    // Before the fix the network had no legend.
    expect(texts.map((t) => t.textContent)).toEqual([...PATHWAYS, "NA"]);
    const fills = Array.from(el.querySelectorAll("svg rect")).map((r) =>
      r.getAttribute("fill")?.toLowerCase(),
    );
    expect(fills).toEqual([
      ...OKABE_ITO.slice(0, 3).map((c) => c.toLowerCase()),
      "#7c8598",
    ]);
    const right = graphRight(el);
    const box = el.getBoundingClientRect();
    expect(right).toBeLessThan(box.right);
    for (const t of texts) {
      const r = t.getBoundingClientRect();
      expect(r.left).toBeGreaterThanOrEqual(right);
      expect(r.right).toBeLessThanOrEqual(box.right);
    }
  });

  it("cuts a long group name to the gutter, and keeps the gutter on resize", () => {
    const el = container(400, 400);
    const long = "Regulation of cyclin-dependent protein kinase activity";
    const groups = GENES.map((_, i) => (i % 2 ? long : "DNA repair"));
    const net = createNetwork(el, { data: ring(groups) });
    instances.push(net);
    const shown = legendTexts(el).map((t) => t.textContent ?? "");
    expect(shown[0]).toBe("DNA repair");
    expect(shown[1]?.endsWith("\u2026")).toBe(true);
    for (const w of [400, 560]) {
      el.style.width = `${w}px`;
      net.resize(w, 400);
      const box = el.getBoundingClientRect();
      const right = graphRight(el);
      for (const t of legendTexts(el)) {
        const r = t.getBoundingClientRect();
        expect(r.left).toBeGreaterThanOrEqual(right);
        expect(r.right).toBeLessThanOrEqual(box.right);
      }
    }
  });

  it("gives the graph the whole width without groups or with showLegend false", () => {
    for (const [data, options] of [
      [ring(), {}],
      [ring(ringGroups()), { showLegend: false }],
    ] as const) {
      const el = container();
      instances.push(createNetwork(el, { data, options }));
      expect(legendTexts(el)).toEqual([]);
      expect(graphRight(el)).toBeCloseTo(el.getBoundingClientRect().right, 0);
    }
  });

  it("exports the legend with the graph", async () => {
    const el = container();
    const net = createNetwork(el, { data: ring(ringGroups()) });
    instances.push(net);
    await new Promise((r) => setTimeout(r, 300));
    const png = (await net.exportPNG?.(1)) as Blob;
    const bitmap = await createImageBitmap(png);
    const k = bitmap.width / el.getBoundingClientRect().width;
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const box = el.getBoundingClientRect();
    const texts = legendTexts(el);
    expect(texts.length).toBe(4);
    for (const t of texts) {
      const r = t.getBoundingClientRect();
      const d = ctx.getImageData(
        Math.floor((r.left - box.left) * k),
        Math.floor((r.top - box.top) * k),
        Math.max(1, Math.ceil(r.width * k)),
        Math.max(1, Math.ceil(r.height * k)),
      ).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          255 -
            Math.min(d[i] as number, d[i + 1] as number, d[i + 2] as number) >
          60
        ) {
          ink += 1;
        }
      }
      expect(ink, t.textContent ?? "").toBeGreaterThan(3);
    }
    // The graph is still in the PNG, left of the legend.
    expect(await drawnPixels(png)).toBeGreaterThan(1000);
    const svg = net.exportSVG?.() ?? "";
    expect(svg).toContain(">p53 pathway</text>");
    expect(svg).toContain("data:image/png;base64,");
  });
});

describe("network legend in a small widget", () => {
  /** Four nodes with the given groups. */
  function grouped(groups: (string | null)[]) {
    return {
      columns: { id: ["a", "b", "c", "d"], x: [0, 1, 2, 3], y: [0, 1, 0, 1] },
      meta: { nodeGroup: groups as string[] },
    };
  }

  it("keeps every legend row inside a short widget", () => {
    const el = container(600, 40);
    instances.push(createNetwork(el, { data: grouped(["A", "B", "C", null]) }));
    // Before the fix the rows were "A", "+2 more" and "NA", the last at
    // baseline 44 in a 40 px widget.
    expect(legendTexts(el).map((t) => t.textContent)).toEqual(["A", "+2 more"]);
    const box = el.getBoundingClientRect();
    for (const t of legendTexts(el)) {
      expect(t.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        box.bottom + 0.5,
      );
    }
  });

  it("leaves the legend out of a widget too short for one row", () => {
    const el = container(600, 24);
    instances.push(createNetwork(el, { data: grouped(["A", "B", "C", null]) }));
    expect(legendTexts(el)).toEqual([]);
    expect(graphRight(el)).toBeCloseTo(el.getBoundingClientRect().right, 0);
  });

  it("leaves the legend out when its gutter cannot show the names", () => {
    const el = container(120, 300);
    const groups = ["Cytotoxic T cells", "B cells", "B cells", "B cells"];
    instances.push(createNetwork(el, { data: grouped(groups) }));
    // Before the fix the legend read "\u2026" twice and the graph kept 78 px.
    expect(legendTexts(el)).toEqual([]);
    expect(graphRight(el)).toBeCloseTo(el.getBoundingClientRect().right, 0);
  });

  it("keeps a legend whose names show a few characters", () => {
    const el = container(200, 300);
    const groups = ["Cytotoxic T cells", "B cells", "B cells", "B cells"];
    instances.push(createNetwork(el, { data: grouped(groups) }));
    const shown = legendTexts(el).map((t) => t.textContent ?? "");
    expect(shown.length).toBe(2);
    expect(shown[0]?.endsWith("\u2026")).toBe(true);
    for (const s of shown) expect(s.length).toBeGreaterThanOrEqual(4);
    expect(graphRight(el)).toBeLessThan(el.getBoundingClientRect().right - 50);
  });
});

describe("network legend as the widget grows taller", () => {
  it("never loses the legend at a greater height", () => {
    // Before the fix, at 150 px wide, heights 36 to 49 showed "B" and
    // "+2 more" cut, and from 50 px "Wolfram cells" came in and the legend
    // went away.
    for (const width of [150, 300]) {
      const shown: number[] = [];
      for (let height = 20; height <= 120; height += 2) {
        const el = container(width, height);
        const net = createNetwork(el, {
          data: {
            columns: { id: ["a", "b", "c"], x: [0, 1, 2], y: [0, 1, 0] },
            meta: { nodeGroup: ["B", "C", "Wolfram cells"] },
          },
        });
        if (legendTexts(el).length > 0) shown.push(height);
        else {
          expect(graphRight(el)).toBeCloseTo(
            el.getBoundingClientRect().right,
            0,
          );
        }
        net.destroy();
        el.remove();
      }
      const first = shown[0] ?? Number.POSITIVE_INFINITY;
      const gaps: number[] = [];
      for (let height = 20; height <= 120; height += 2) {
        if (height > first && !shown.includes(height)) gaps.push(height);
      }
      expect(gaps, `${width} px`).toEqual([]);
    }
  });
});
