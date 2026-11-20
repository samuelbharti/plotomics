import { afterEach, describe, expect, it } from "vitest";
import { createNetwork } from "../../src/components/network.js";
import {
  DEFAULT_PADDING,
  OKABE_ITO,
  type PlotomicsInstance,
  darkTheme,
  defaultTheme,
} from "../../src/core/index.js";
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
      // The graph runs to the right edge of the plot box, inside the theme
      // padding.
      expect(graphRight(el)).toBeCloseTo(
        el.getBoundingClientRect().right - DEFAULT_PADDING,
        0,
      );
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

/**
 * A network with no theme padding, for tests that read its layout at the
 * widget's own size.
 */
function flush(el: HTMLElement, args: Parameters<typeof createNetwork>[1]) {
  return createNetwork(el, {
    ...args,
    options: { ...args.options, theme: { padding: 0 } },
  });
}

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
    instances.push(flush(el, { data: grouped(["A", "B", "C", null]) }));
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
    instances.push(flush(el, { data: grouped(["A", "B", "C", null]) }));
    expect(legendTexts(el)).toEqual([]);
    expect(graphRight(el)).toBeCloseTo(el.getBoundingClientRect().right, 0);
  });

  it("leaves the legend out when its gutter cannot show the names", () => {
    const el = container(120, 300);
    const groups = ["Cytotoxic T cells", "B cells", "B cells", "B cells"];
    instances.push(flush(el, { data: grouped(groups) }));
    // Before the fix the legend read "\u2026" twice and the graph kept 78 px.
    expect(legendTexts(el)).toEqual([]);
    expect(graphRight(el)).toBeCloseTo(el.getBoundingClientRect().right, 0);
  });

  it("keeps a legend whose names show a few characters", () => {
    const el = container(200, 300);
    const groups = ["Cytotoxic T cells", "B cells", "B cells", "B cells"];
    instances.push(flush(el, { data: grouped(groups) }));
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
          // The graph runs to the right edge of the plot box, inside the
          // theme padding, also where the padding takes the whole height.
          expect(graphRight(el)).toBeCloseTo(
            el.getBoundingClientRect().right - DEFAULT_PADDING,
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

describe("network default edge colour", () => {
  /** Two nodes on one line, joined by one edge 3.85 px wide. */
  const pair = () => ({
    columns: {
      id: ["A", "B"],
      x: [0, 10],
      y: [0, 0],
      source: ["A"],
      target: ["B"],
      weight: [1],
    },
  });

  /** Red, green and blue bytes of a hex colour. */
  const bytes = (hex: string) =>
    [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16));

  /** Relative luminance of red, green and blue bytes (WCAG 2). */
  function luminance(rgb: readonly number[]): number {
    const lin = (v: number) =>
      v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    return (
      0.2126 * lin(rgb[0] as number) +
      0.7152 * lin(rgb[1] as number) +
      0.0722 * lin(rgb[2] as number)
    );
  }
  const contrast = (a: readonly number[], b: readonly number[]) => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  /**
   * The colour of the edge in the exported PNG: of the pixels in the middle
   * column, which the edge crosses, the one furthest from the background.
   */
  async function edgePixel(
    net: PlotomicsInstance<unknown>,
    background: readonly number[],
  ): Promise<number[]> {
    await new Promise((r) => setTimeout(r, 300));
    const png = (await net.exportPNG?.(1)) as Blob;
    const bitmap = await createImageBitmap(png);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const d = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
    let best = [...background];
    let far = 0;
    for (let i = 0; i < d.length; i += 4) {
      const px = [d[i], d[i + 1], d[i + 2]] as number[];
      const dist = px.reduce(
        (s, v, k) => s + Math.abs(v - (background[k] as number)),
        0,
      );
      if (dist > far) {
        far = dist;
        best = px;
      }
    }
    return best;
  }

  it("draws edges quieter than the nodes and the labels in both themes", async () => {
    for (const theme of [defaultTheme, darkTheme]) {
      const el = container();
      const net = createNetwork(el, { data: pair(), options: { theme } });
      instances.push(net);
      const bg = bytes(theme.background);
      const edge = await edgePixel(net, bg);
      const node = bytes("#7c8598");
      const label = bytes(theme.foreground);
      const name = theme === darkTheme ? "dark" : "light";
      // Before the fix the dark theme drew the edges in #d6dae1, at a
      // contrast of 13.7 on the background, where the nodes have 5.2.
      expect(contrast(edge, bg), name).toBeGreaterThan(1.2);
      expect(contrast(edge, bg), name).toBeLessThan(contrast(node, bg));
      expect(contrast(edge, bg), name).toBeLessThan(contrast(label, bg));
    }
  });

  it("reads a theme given as var() for the edge colour", async () => {
    const bg = bytes(darkTheme.background);
    const literal = createNetwork(container(), {
      data: pair(),
      options: { theme: darkTheme },
    });
    instances.push(literal);
    const want = await edgePixel(literal, bg);
    const el = container();
    el.style.setProperty("--net-bg", darkTheme.background);
    el.style.setProperty("--net-fg", darkTheme.foreground);
    const net = createNetwork(el, {
      data: pair(),
      options: {
        theme: { background: "var(--net-bg)", foreground: "var(--net-fg)" },
      },
    });
    instances.push(net);
    const edge = await edgePixel(net, bg);
    // The colours the page gives the properties draw the edge the same
    // colours given directly draw.
    for (const k of [0, 1, 2]) {
      expect(Math.abs((edge[k] as number) - (want[k] as number))).toBeLessThan(
        4,
      );
    }
    expect(contrast(edge, bg)).toBeGreaterThan(1.2);
    expect(contrast(edge, bg)).toBeLessThan(contrast(bytes("#7c8598"), bg));
  });

  it("keeps a given edge colour", async () => {
    const el = container();
    const net = createNetwork(el, {
      data: pair(),
      options: { theme: darkTheme, defaultEdgeColor: "#d62728" },
    });
    instances.push(net);
    const edge = await edgePixel(net, bytes(darkTheme.background));
    expect(edge[0]).toBeGreaterThan(190);
    expect(edge[1]).toBeLessThan(70);
  });
});

/** A seeded stream of numbers in [0, 1) (mulberry32). */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 300 proteins in six groups with 900 edges, most of them inside a group,
 * laid out by ForceAtlas2.
 */
function proteins() {
  const rand = seeded(9);
  const n = 300;
  const groups = [
    "Ribosome",
    "Proteasome",
    "Spliceosome",
    "DNA replication",
    "Cell cycle",
    "mTOR signaling",
  ];
  const id = Array.from({ length: n }, (_, i) => `PROT${i + 1}`);
  const source: string[] = [];
  const target: string[] = [];
  for (let e = 0; e < 900; e += 1) {
    const a = Math.floor(rand() * n);
    let b =
      rand() < 0.7
        ? (a + groups.length * (1 + Math.floor(rand() * 5))) % n
        : Math.floor(rand() * n);
    if (b === a) b = (a + 1) % n;
    source.push(id[a] as string);
    target.push(id[b] as string);
    // A draw for a weight the graph does not use, so the layout matches
    // the one the defect was found on.
    rand();
  }
  return {
    columns: { id, source, target },
    meta: { nodeGroup: id.map((_, i) => groups[i % groups.length] as string) },
  };
}

interface TextBox {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Record the boxes of the text in the last frame of sigma's labels canvas. */
function recordLabelBoxes() {
  const proto = CanvasRenderingContext2D.prototype;
  const realText = proto.fillText;
  const realClear = proto.clearRect;
  let boxes: TextBox[] = [];
  proto.clearRect = function (
    this: CanvasRenderingContext2D,
    ...args: Parameters<typeof realClear>
  ) {
    if (this.canvas.className === "sigma-labels") boxes = [];
    return realClear.apply(this, args);
  };
  proto.fillText = function (
    this: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ) {
    if (this.canvas.className === "sigma-labels") {
      const m = this.measureText(text);
      boxes.push({
        text,
        left: x - m.actualBoundingBoxLeft,
        right: x + m.actualBoundingBoxRight,
        top: y - m.actualBoundingBoxAscent,
        bottom: y + m.actualBoundingBoxDescent,
      });
    }
    return maxWidth === undefined
      ? realText.call(this, text, x, y)
      : realText.call(this, text, x, y, maxWidth);
  };
  return {
    boxes: () => boxes,
    restore() {
      proto.fillText = realText;
      proto.clearRect = realClear;
    },
  };
}

describe("network labels in a crowded graph", () => {
  it("never draws a node label over another", async () => {
    for (const [width, fontSize] of [
      [400, 12],
      [400, 16],
      [800, 12],
      [800, 16],
    ] as const) {
      const rec = recordLabelBoxes();
      try {
        const el = container(width, 480);
        const net = createNetwork(el, {
          data: proteins(),
          options: { theme: { fontSize } },
        });
        await expect.poll(() => rec.boxes().length, poll).toBeGreaterThan(0);
        await new Promise((r) => setTimeout(r, 300));
        const boxes = rec.boxes();
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i] as TextBox;
            const b = boxes[j] as TextBox;
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 0 && iy > 0) hits.push(`${a.text} on ${b.text}`);
          }
        }
        const at = `${width} px, fontSize ${fontSize}`;
        // Before the fix "PROT206" ran into "PROT281" at 400 px,
        // fontSize 16.
        expect(hits, at).toEqual([]);
        // The labels that do not collide are still drawn.
        expect(boxes.length, at).toBeGreaterThan(3);
        net.destroy();
        el.remove();
      } finally {
        rec.restore();
      }
    }
  });
});

describe("network labels after a new render", () => {
  it("draws the same labels again after new options and new data", async () => {
    const rec = recordLabelBoxes();
    const shown = () =>
      rec
        .boxes()
        .map((b) => b.text)
        .sort();
    const settle = () => new Promise((r) => setTimeout(r, 300));
    try {
      const net = createNetwork(container(800, 480), {
        data: proteins(),
        options: { theme: { fontSize: 16 } },
      });
      instances.push(net);
      await expect.poll(() => rec.boxes().length, poll).toBeGreaterThan(3);
      await settle();
      const first = shown();
      // The new renderer draws its first frame as it is created. The
      // labels of the old one's last frame must not keep room on it.
      net.setOptions({ theme: { fontSize: 16 } });
      await settle();
      expect(shown()).toEqual(first);
      net.setData(proteins());
      await settle();
      expect(shown()).toEqual(first);
    } finally {
      rec.restore();
    }
  });
});

describe("network group levels", () => {
  it("orders the legend and the colours by the given levels", () => {
    const el = container();
    const groups = GENES.map((_, i) => (i % 2 ? "p53 pathway" : "Cell cycle"));
    const data = ring(groups);
    instances.push(
      createNetwork(el, {
        data: {
          ...data,
          meta: {
            ...data.meta,
            nodeGroupLevels: ["p53 pathway", "DNA repair", "Cell cycle"],
          },
        },
      }),
    );
    // Before the fix the legend read "Cell cycle", "p53 pathway": the
    // order the nodes have them, and the unused level was left out.
    expect(legendTexts(el).map((t) => t.textContent)).toEqual([
      "p53 pathway",
      "DNA repair",
      "Cell cycle",
    ]);
    const fills = Array.from(el.querySelectorAll("svg rect")).map((r) =>
      r.getAttribute("fill")?.toLowerCase(),
    );
    expect(fills).toEqual(OKABE_ITO.slice(0, 3).map((c) => c.toLowerCase()));
  });
});

describe("network destroy", () => {
  it("puts back the background the element had", () => {
    const options = { theme: { background: "#0b0f19" } };
    const el = container();
    el.style.backgroundColor = "rgb(250, 240, 230)";
    createNetwork(el, { data: ring(), options }).destroy();
    expect(el.style.backgroundColor).toBe("rgb(250, 240, 230)");
    // Before the fix the element kept the theme background.
    const bare = container();
    createNetwork(bare, { data: ring(), options }).destroy();
    expect(bare.getAttribute("style") ?? "").not.toContain("background");
  });
});
