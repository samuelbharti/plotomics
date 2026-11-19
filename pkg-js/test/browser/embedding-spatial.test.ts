import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createEmbedding } from "../../src/components/embedding.js";
import { createSpatial } from "../../src/components/spatial.js";
import { type PlotomicsInstance, ramp } from "../../src/core/index.js";
import { canvasPNG, drawnPixels } from "./helpers.js";

function container(width = 500, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function svgTexts(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("svg text")).map(
    (t) => t.textContent ?? "",
  );
}

function hoverAt(el: HTMLElement, x: number, y: number): string {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

function pixel(el: HTMLElement, x: number, y: number): number[] {
  const c = el.querySelector("canvas") as HTMLCanvasElement;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const ratio = c.width / c.clientWidth;
  const d = ctx.getImageData(
    Math.floor(x * ratio),
    Math.floor(y * ratio),
    1,
    1,
  ).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

const poll = { timeout: 10_000, interval: 50 };

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("embedding with missing values", () => {
  it("reads a colour column that starts with NA as categories", async () => {
    const el = container();
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [0, 1, 2, 3],
            y: [0, 1, 0, 1],
            color: [null, "B cell", "T cell", "B cell"] as unknown as string[],
          },
        },
      }),
    );
    await expect
      .poll(() => svgTexts(el), poll)
      .toEqual(expect.arrayContaining(["B cell", "T cell", "NA"]));
  });

  it("sorts text categories, keeping cluster 2 before cluster 10", async () => {
    const el = container();
    const labels = ["cluster 10", "cluster 2", "cluster 1", "cluster 2"];
    instances.push(
      createEmbedding(el, {
        data: { columns: { x: [0, 1, 2, 3], y: [0, 1, 0, 1], color: labels } },
      }),
    );
    await expect
      .poll(() => svgTexts(el).filter((t) => t.startsWith("cluster")), poll)
      .toEqual(["cluster 1", "cluster 2", "cluster 10"]);
  });

  it("leaves a point with a missing coordinate off the axes", async () => {
    const el = container();
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [10, null, 12, 14] as unknown as number[],
            y: [1, 2, 3, 4],
          },
        },
        options: { showAxes: true },
      }),
    );
    // Data runs from 10 to 14; a null read as 0 stretched the axis to 0.
    await expect
      .poll(() => {
        const xs = Array.from(
          el.querySelectorAll('svg text[text-anchor="middle"]'),
        )
          .map((t) => Number(t.textContent))
          .filter((v) => Number.isFinite(v));
        return xs.length ? Math.min(...xs) : Number.NaN;
      }, poll)
      .toBeGreaterThanOrEqual(9);
  });

  it("drops the lasso selection when new data arrives", async () => {
    const el = container();
    const seen: number[][] = [];
    const plot = createEmbedding(el, {
      data: { columns: { x: [0, 1, 2, 3], y: [0, 1, 2, 3] } },
      options: { mouseMode: "lasso", onSelect: (rows) => seen.push(rows) },
    });
    instances.push(plot);
    await new Promise((r) => setTimeout(r, 300));
    // Lasso the whole plot area.
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      // regl-scatterplot starts a lasso only with the main button held.
      buttons: 1,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0.01, 0.01)));
    for (const [fx, fy] of [
      [0.99, 0.01],
      [0.99, 0.99],
      [0.01, 0.99],
      [0.01, 0.02],
    ] as const) {
      for (let s = 1; s <= 10; s += 1) {
        window.dispatchEvent(new MouseEvent("mousemove", at(fx, fy)));
        await new Promise((res) => setTimeout(res, 5));
      }
    }
    window.dispatchEvent(new MouseEvent("mouseup", at(0.01, 0.02)));
    await expect
      .poll(() => plot.selectedIndices.length, poll)
      .toBeGreaterThan(0);

    plot.setData({ columns: { x: [0, 1], y: [0, 1] } });
    expect(plot.selectedIndices).toEqual([]);
    expect(seen[seen.length - 1]).toEqual([]);
  });
});

describe("embedding legend and selection on re-render", () => {
  it("keeps the NA key in view with more than 20 categories", async () => {
    const el = container(600, 500);
    const labels = Array.from({ length: 22 }, (_, i) => `c${i + 1}`);
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [...labels.map((_, i) => i), 30],
            y: [...labels.map((_, i) => i), 30],
            color: [...labels, null] as unknown as string[],
          },
        },
      }),
    );
    await expect
      .poll(() => svgTexts(el), poll)
      .toEqual(expect.arrayContaining(["+2 more", "NA"]));
  });

  it("keeps the selection when the same points arrive again", async () => {
    const el = container();
    const pts = () => ({ columns: { x: [0, 1, 2, 3], y: [0, 1, 2, 3] } });
    const plot = createEmbedding(el, {
      data: pts(),
      options: { mouseMode: "lasso" },
    });
    instances.push(plot);
    await new Promise((r) => setTimeout(r, 300));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      buttons: 1,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0.01, 0.01)));
    for (const [fx, fy] of [
      [0.99, 0.01],
      [0.99, 0.99],
      [0.01, 0.99],
      [0.01, 0.02],
    ] as const) {
      for (let s = 1; s <= 10; s += 1) {
        window.dispatchEvent(new MouseEvent("mousemove", at(fx, fy)));
        await new Promise((res) => setTimeout(res, 5));
      }
    }
    window.dispatchEvent(new MouseEvent("mouseup", at(0.01, 0.02)));
    await expect
      .poll(() => plot.selectedIndices.length, poll)
      .toBeGreaterThan(0);
    const before = plot.selectedIndices;
    // A Shiny re-render: the same points, as a new object.
    plot.setData(pts());
    expect(plot.selectedIndices).toEqual(before);
  });
});

/** RGB of a PNG at a point given in CSS px of a widget `cssWidth` wide. */
async function pngPixel(
  png: Blob,
  cssWidth: number,
  x: number,
  y: number,
): Promise<number[]> {
  const bitmap = await createImageBitmap(png);
  const k = bitmap.width / cssWidth;
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

/** The widget as the screen shows it, as a PNG. */
async function screenPNG(el: HTMLElement): Promise<Blob> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

const far = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));

/** A box of an element, relative to the widget. */
function boxIn(el: HTMLElement, node: Element) {
  const e = el.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return {
    left: r.left - e.left,
    right: r.right - e.left,
    top: r.top - e.top,
    bottom: r.bottom - e.top,
  };
}

describe("embedding gridlines", () => {
  // A dense block of large points over x from 0 to 5, and two points at
  // x = 10 that stretch the axis: gridlines at 2 and 4 run through the
  // block, the one at 8 through empty space.
  function blockData() {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i <= 50; i += 1) {
      for (let j = 0; j <= 80; j += 1) {
        x.push((i / 50) * 5);
        y.push((j / 80) * 10);
      }
    }
    x.push(10, 10);
    y.push(0, 10);
    return { columns: { x, y } };
  }

  async function ready(el: HTMLElement) {
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(10_000);
    await new Promise((r) => setTimeout(r, 300));
  }

  /** x of the gridline at a tick value, and the middle of the plot area. */
  function gridAt(el: HTMLElement, value: string) {
    const label = Array.from(el.querySelectorAll("svg text")).find(
      (t) =>
        t.textContent === value && t.getAttribute("text-anchor") === "middle",
    ) as SVGTextElement;
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const plot = boxIn(el, canvas);
    // In the element: the label's x is in the plot box, which sits inside
    // the theme padding.
    const svg = boxIn(el, el.querySelector("svg") as SVGSVGElement);
    return {
      x: Number(label.getAttribute("x")) + svg.left,
      y: Math.round((plot.top + plot.bottom) / 2),
    };
  }

  /**
   * How far the pixels on the gridline at 2, inside the block of points,
   * are from the points beside it; and how far the pixel on the gridline at
   * 8, in empty space, is from the grid colour.
   */
  async function gridOf(el: HTMLElement, png: Blob) {
    const inside = gridAt(el, "2");
    const point = await pngPixel(png, 500, inside.x + 3, inside.y);
    let across = 0;
    for (const dx of [-1, 0, 1]) {
      const p = await pngPixel(png, 500, inside.x + dx, inside.y);
      across = Math.max(across, far(p, point));
    }
    const empty = gridAt(el, "8");
    let grid = 255;
    for (const dx of [-1, 0, 1]) {
      const p = await pngPixel(png, 500, empty.x + dx, empty.y);
      grid = Math.min(grid, far(p, [0xe5, 0xe7, 0xeb]));
    }
    return { across, grid, point };
  }

  const options = {
    showAxes: true,
    showLegend: false,
    pointSize: 10,
    pointScaleMode: "constant" as const,
    opacity: 1,
    padding: 0,
  };

  it("draws the gridlines under the points, on screen and in the PNG", async () => {
    // Before the fix the gridlines were SVG lines over the canvas, so a
    // pale line crossed every point under it.
    const el = container(500, 400);
    const plot = createEmbedding(el, { data: blockData(), options });
    instances.push(plot);
    await ready(el);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const g = await gridOf(el, png as Blob);
      // The block of points is drawn, not the white page.
      expect(far(g.point, [255, 255, 255])).toBeGreaterThan(60);
      expect(g.across).toBeLessThan(12);
      expect(g.grid).toBeLessThan(12);
    }
  });

  it("keeps the gridlines under the points in the SVG export", async () => {
    const el = container(500, 400);
    const plot = createEmbedding(el, { data: blockData(), options });
    instances.push(plot);
    await ready(el);
    const doc = new DOMParser().parseFromString(
      plot.exportSVG?.() ?? "",
      "image/svg+xml",
    );
    const nodes = Array.from(doc.documentElement.children);
    const image = nodes.findIndex((n) => n.localName === "image");
    const isGrid = (n: Element) => n.getAttribute("stroke") === "#e5e7eb";
    expect(image).toBeGreaterThan(0);
    expect(nodes.slice(0, image).filter(isGrid).length).toBeGreaterThan(4);
    expect(nodes.slice(image + 1).filter(isGrid)).toEqual([]);
  });
});

describe("embedding legend gutter", () => {
  const n = 400;
  const xs = Array.from({ length: n }, (_, i) => (i * 37) % 101);
  const ys = Array.from({ length: n }, (_, i) => (i * 53) % 97);
  const clusters = xs.map((_, i) => `cluster ${(i % 6) + 1}`);

  /** The plot area and the legend box, relative to the widget. */
  function parts(el: HTMLElement) {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const box = el.querySelector('svg rect[rx="4"]');
    return {
      plot: boxIn(el, canvas),
      legend: box ? boxIn(el, box) : null,
    };
  }

  for (const [kind, color] of [
    ["categorical legend", clusters],
    ["colour bar", xs.map((v) => v / 10)],
  ] as const) {
    it(`keeps the ${kind} right of the points, inside the widget`, async () => {
      // Before the fix the legend sat inside the plot area, over points.
      const el = container(500, 400);
      instances.push(
        createEmbedding(el, {
          data: { columns: { x: xs, y: ys, color: color as string[] } },
        }),
      );
      await expect
        .poll(() => {
          const p = parts(el);
          return p.legend !== null && p.plot.right <= p.legend.left;
        }, poll)
        .toBe(true);
      const p = parts(el);
      expect(p.legend?.right).toBeLessThanOrEqual(500);
      // The plot keeps most of the widget.
      expect(p.plot.right - p.plot.left).toBeGreaterThan(300);
    });
  }

  it("gives the gutter back when the legend is turned off", async () => {
    const el = container(500, 400);
    const plot = createEmbedding(el, {
      data: { columns: { x: xs, y: ys, color: clusters } },
    });
    instances.push(plot);
    await expect.poll(() => parts(el).legend !== null, poll).toBe(true);
    const narrow = parts(el).plot.right;
    expect(narrow).toBeLessThan(450);
    plot.setOptions({ showLegend: false });
    // The plot area runs to the right edge of the plot box, which is the
    // default theme padding of 10 px in from the widget's.
    await expect.poll(() => parts(el).plot.right, poll).toBe(490);
  });

  it("cuts a long category name to keep the plot area", async () => {
    const el = container(500, 400);
    const long = "a cell type whose name runs on and on past any gutter";
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: xs,
            y: ys,
            color: xs.map((_, i) => (i % 2 ? long : "B cells")),
          },
        },
      }),
    );
    await expect.poll(() => parts(el).legend !== null, poll).toBe(true);
    const p = parts(el);
    expect(p.plot.right).toBeLessThanOrEqual(p.legend?.left ?? 0);
    expect(p.plot.right - p.plot.left).toBeGreaterThan(250);
    expect(svgTexts(el).some((t) => t.endsWith("\u2026"))).toBe(true);
  });
});

describe("embedding colour bar labels", () => {
  it("labels round values inside the range, each at its value", async () => {
    // Before the fix the bar read the raw ends and middle, such as
    // "10.01", "5.01" and "2.7e-3".
    const el = container(500, 400);
    const values = Array.from({ length: 50 }, (_, i) =>
      i === 0 ? 0.0027 : i === 49 ? 10.01 : (i / 49) * 10,
    );
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: values.map((_, i) => i % 7),
            y: values.map((_, i) => Math.floor(i / 7)),
            color: values,
          },
        },
        options: { colormap: "ltc" },
      }),
    );
    const bar = () =>
      (Array.from(el.querySelectorAll("svg text")) as SVGTextElement[]).filter(
        (t) => t.getAttribute("text-anchor") === "start",
      );
    await expect
      .poll(() => bar().map((t) => t.textContent), poll)
      .toEqual(["2", "4", "6", "8", "10"]);
    const y = (s: string) =>
      Number(
        bar()
          .find((t) => t.textContent === s)
          ?.getAttribute("y"),
      );
    expect(y("6")).toBeCloseTo((y("4") + y("8")) / 2, 6);
    // The bar is drawn from the ramp asked for.
    const stops = Array.from(el.querySelectorAll("stop")).map((s) =>
      s.getAttribute("stop-color"),
    );
    expect(stops[0]).toBe(ramp("ltc")(0));
    expect(stops[stops.length - 1]).toBe(ramp("ltc")(1));
  });
});

describe("spatial colours and missing values", () => {
  const base = {
    x: [20, 60, 100, 140],
    y: [50, 50, 50, 50],
  };
  const meta = { imgWidth: 160, imgHeight: 100, spotDiameter: 20 };

  it("colours numeric cluster ids against their levels", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: { ...base, color: [0, 1, 2, 0] },
          meta: { ...meta, levels: ["0", "1", "2"] },
        },
        options: { colorMode: "categorical", showImage: false, spotOpacity: 1 },
      }),
    );
    // 400 x 250 holds the 160 x 100 image at scale 2.5.
    const muted = [0x6b, 0x72, 0x80];
    expect(pixel(el, 20 * 2.5, 50 * 2.5)).not.toEqual(muted);
    expect(pixel(el, 60 * 2.5, 50 * 2.5)).not.toEqual(
      pixel(el, 20 * 2.5, 50 * 2.5),
    );
  });

  it("fills levels past a short colour list from the palette", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: { ...base, color: ["a", "b", "c", "a"] },
          meta: { ...meta, colors: ["#ff0000"] },
        },
        // No theme padding, so the image fills the widget at scale 2.5.
        options: { showImage: false, spotOpacity: 1, theme: { padding: 0 } },
      }),
    );
    const a = pixel(el, 20 * 2.5, 50 * 2.5);
    const b = pixel(el, 60 * 2.5, 50 * 2.5);
    const c = pixel(el, 100 * 2.5, 50 * 2.5);
    expect(a).toEqual([255, 0, 0]);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(b);
  });

  it("reads a leading NA, sorts levels naturally and says NA on hover", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            ...base,
            color: [null, "10", "2", "1"] as unknown as string[],
          },
          meta,
        },
        options: { showImage: false },
      }),
    );
    const texts = svgTexts(el);
    expect(texts.filter((t) => /^\d+$/.test(t))).toEqual(["1", "2", "10"]);
    expect(texts).toContain("NA");
    expect(hoverAt(el, 20 * 2.5, 50 * 2.5)).toContain("NA");
  });

  it("does not throw on hovering a spot with a missing number", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            ...base,
            color: [1, null, 3, 4] as unknown as number[],
          },
          meta,
        },
        options: { showImage: false },
      }),
    );
    expect(hoverAt(el, 60 * 2.5, 50 * 2.5)).toContain("NA");
    expect(svgTexts(el)).toContain("NA");
  });

  it("draws no spot for a missing coordinate", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            x: [null, 60] as unknown as number[],
            y: [null, 50] as unknown as number[],
          },
          meta,
        },
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    // A null read as 0 put the spot in the top-left corner of the image.
    expect(pixel(el, 2, 2)).toEqual([255, 255, 255]);
  });
});

/**
 * A spatial plot with no theme padding, for tests that read its layout at
 * the widget's own size.
 */
function flush(el: HTMLElement, args: Parameters<typeof createSpatial>[1]) {
  return createSpatial(el, {
    ...args,
    options: { ...args.options, theme: { padding: 0 } },
  });
}

describe("spatial spot size and legend gutter", () => {
  /** Spots every 100 px on a 2000 px image, as on a full-resolution slide. */
  function fullRes() {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      for (let j = 0; j < 20; j += 1) {
        x.push(50 + i * 100);
        y.push(50 + j * 100);
      }
    }
    return { x, y };
  }
  const dark = [0x1a, 0x1a, 0x1a];
  const white = [255, 255, 255];

  it("sizes spots from their spacing when no diameter is given", () => {
    const el = container(400, 400);
    instances.push(
      flush(el, {
        data: {
          columns: fullRes(),
          meta: { imgWidth: 2000, imgHeight: 2000 },
        },
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    // The contain fit takes the image to 0.2, so the first spot is centred
    // at (10, 10) and its neighbours are 20 px off. Spots of 100 image px
    // reach 10 px out; before the fix they were 4 image px, cut to the
    // 1 px floor.
    expect(pixel(el, 10, 10)).toEqual(dark);
    expect(pixel(el, 16, 10)).toEqual(dark);
    expect(pixel(el, 10, 16)).toEqual(dark);
  });

  it("keeps a given diameter", () => {
    const el = container(400, 400);
    instances.push(
      flush(el, {
        data: {
          columns: fullRes(),
          meta: { imgWidth: 2000, imgHeight: 2000, spotDiameter: 20 },
        },
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    expect(pixel(el, 10, 10)).toEqual(dark);
    expect(pixel(el, 16, 10)).toEqual(white);
  });

  /** Spots on a 10 x 10 grid over a 100 x 100 image. */
  function tissue(color: unknown[]) {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      for (let j = 0; j < 10; j += 1) {
        x.push(5 + i * 10);
        y.push(5 + j * 10);
      }
    }
    const col = x.map((_, i) => color[i % color.length]);
    return {
      columns: { x, y, color: col as unknown as string[] },
      meta: { imgWidth: 100, imgHeight: 100, spotDiameter: 8 },
    };
  }

  /** The right edge of what the canvas draws, on the middle row. */
  function drawnRight(el: HTMLElement): number {
    const w = el.getBoundingClientRect().width;
    const mid = el.getBoundingClientRect().height / 2;
    for (let x = Math.floor(w) - 1; x >= 0; x -= 1) {
      if (pixel(el, x, mid).some((v) => v !== 255)) return x + 1;
    }
    return 0;
  }

  const LONG = "Normal epithelium next to the tumour margin";

  const cases: [string, unknown[]][] = [
    ["legend", ["Tumour", "Stroma", LONG, null]],
    ["colour bar", [1, 250, 3000, null]],
  ];
  for (const [name, color] of cases) {
    it(`keeps the ${name} in a gutter clear of the image`, () => {
      const el = container(300, 300);
      instances.push(flush(el, { data: tissue(color) }));
      const box = el.getBoundingClientRect();
      const edge = drawnRight(el);
      // Before the fix the image took the whole width, under the legend.
      expect(edge).toBeLessThan(box.width - 8);
      const texts = svgTexts(el);
      expect(texts).toContain("NA");
      for (const t of Array.from(el.querySelectorAll("svg text, svg rect"))) {
        const r = t.getBoundingClientRect();
        expect(r.left - box.left).toBeGreaterThanOrEqual(edge);
        expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
      }
      if (name === "legend") {
        // A long level is cut with an ellipsis to the gutter.
        expect(texts.some((t) => t.endsWith("\u2026"))).toBe(true);
      }
    });
  }

  it("gives the image the whole width with showLegend false", () => {
    const el = container(300, 300);
    instances.push(
      flush(el, {
        data: tissue(["Tumour", "Stroma"]),
        options: { showLegend: false },
      }),
    );
    expect(drawnRight(el)).toBe(300);
  });

  /** Legend texts and swatches whose box runs past the widget's edge. */
  function outsideBox(el: HTMLElement): string[] {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll("svg text, svg rect"))
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5;
      })
      .map((t) => t.textContent || t.tagName);
  }

  it("keeps every legend row inside a short widget", () => {
    const el = container(600, 40);
    instances.push(flush(el, { data: tissue(["A", "B", "C", null]) }));
    // Before the fix the rows were "A", "+2 more" and "NA", the last at
    // baseline 44 in a 40 px widget.
    expect(svgTexts(el)).toEqual(["A", "+2 more"]);
    expect(outsideBox(el)).toEqual([]);
  });

  it("shortens the colour bar to fit a short widget, with the NA key", () => {
    const el = container(600, 80);
    instances.push(flush(el, { data: tissue([1, 250, 3000, null]) }));
    // Before the fix the bar was 90 px tall from y = 18, past the bottom.
    expect(svgTexts(el)).toContain("NA");
    expect(outsideBox(el)).toEqual([]);
  });

  it("leaves the legend out of a widget too short for one row", () => {
    for (const color of [
      ["A", "B"],
      [1, 2],
    ]) {
      const el = container(300, 24);
      instances.push(flush(el, { data: tissue(color) }));
      expect(svgTexts(el)).toEqual([]);
    }
  });

  const narrow: [string, unknown[]][] = [
    ["legend", ["Cytotoxic T cells", "B cells"]],
    ["colour bar", [1, 250, 3000]],
  ];
  for (const [name, color] of narrow) {
    it(`leaves the ${name} out when its gutter cannot show the labels`, () => {
      const el = container(120, 300);
      instances.push(flush(el, { data: tissue(color) }));
      // Before the fix the gutter kept 42 px and showed only ellipses.
      expect(svgTexts(el)).toEqual([]);
      expect(drawnRight(el)).toBe(120);
    });
  }

  it("keeps a legend whose labels show a few characters", () => {
    const el = container(200, 300);
    instances.push(
      flush(el, { data: tissue(["Cytotoxic T cells", "B cells"]) }),
    );
    const texts = svgTexts(el);
    expect(texts.length).toBe(2);
    expect(texts[1]?.endsWith("\u2026")).toBe(true);
    for (const t of texts) expect(t.length).toBeGreaterThanOrEqual(4);
    expect(outsideBox(el)).toEqual([]);
  });
});

describe("spatial legend as the widget grows taller", () => {
  /** Spots on a 4 x 4 grid over a 100 x 100 image. */
  function spots(color: unknown[]) {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        x.push(10 + i * 25);
        y.push(10 + j * 25);
      }
    }
    return {
      columns: {
        x,
        y,
        color: x.map((_, i) => color[i % color.length]) as unknown as string[],
      },
      meta: { imgWidth: 100, imgHeight: 100 },
    };
  }

  const cases: [string, unknown[], number[]][] = [
    // Before the fix, at 150 px, heights 36 to 49 showed "B" and "+2 more"
    // cut, and from 50 px "Wolfram cells" came in and the legend went away.
    ["levels", ["B", "C", "Wolfram cells"], [150, 300]],
    // Before the fix a colour bar that the height left no room for its NA
    // key showed, and went away once the NA key came in.
    ["colour bar", [1, 2, null], [100, 110, 120, 130]],
  ];
  for (const [name, color, widths] of cases) {
    it(`never loses the ${name} at a greater height`, () => {
      for (const width of widths) {
        const shown: number[] = [];
        for (let height = 20; height <= 140; height += 2) {
          const el = container(width, height);
          const sp = createSpatial(el, { data: spots(color) });
          if (svgTexts(el).length > 0) shown.push(height);
          sp.destroy();
          el.remove();
        }
        const first = shown[0] ?? Number.POSITIVE_INFINITY;
        const gaps: number[] = [];
        for (let height = 20; height <= 140; height += 2) {
          if (height > first && !shown.includes(height)) gaps.push(height);
        }
        expect(gaps, `${width} px`).toEqual([]);
      }
    });
  }
});

describe("spatial panel before the image loads", () => {
  const data = {
    columns: { x: [5], y: [5], color: ["A"] },
    meta: { imgWidth: 100, imgHeight: 100, spotDiameter: 4 },
  };

  it("fills the panel in a var() grid colour, and draws none for none", () => {
    // Before the fix the canvas could not read var(), so the panel kept the
    // background fill.
    const el = container(300, 300);
    el.style.setProperty("--spatial-panel", "#ff00ff");
    instances.push(
      createSpatial(el, {
        data,
        options: {
          showLegend: false,
          theme: { grid: "var(--spatial-panel)" },
        },
      }),
    );
    expect(pixel(el, 150, 150)).toEqual([255, 0, 255]);

    const none = container(300, 300);
    instances.push(
      createSpatial(none, {
        data,
        options: { showLegend: false, theme: { grid: "none" } },
      }),
    );
    expect(pixel(none, 150, 150)).toEqual([255, 255, 255]);
  });
});

describe("embedding colour bar far from 0", () => {
  it("labels no value outside a narrow range far from 0", async () => {
    // Before the fix the bar of 150000123 to 150001123 read 150001200,
    // above the bar and outside the legend box.
    const el = container(500, 400);
    const values = Array.from(
      { length: 50 },
      (_, i) => 150000123 + Math.round((i / 49) * 1000),
    );
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: values.map((_, i) => i % 7),
            y: values.map((_, i) => Math.floor(i / 7)),
            color: values,
          },
        },
      }),
    );
    const bar = () =>
      (Array.from(el.querySelectorAll("svg text")) as SVGTextElement[])
        .filter((t) => t.getAttribute("text-anchor") === "start")
        .map((t) => t.textContent ?? "")
        .filter((s) => /^\d{6,}$/.test(s))
        .map(Number);
    await expect.poll(() => bar().length, poll).toBeGreaterThanOrEqual(2);
    for (const v of bar()) {
      expect(v).toBeGreaterThanOrEqual(150000123);
      expect(v).toBeLessThanOrEqual(150001123);
    }
  });
});

/** A seeded random number generator (mulberry32), for repeatable data. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2000 cells in 15 clusters, with an expression value for each. */
function cells() {
  const rand = seeded(7);
  const norm = () => {
    const u = Math.max(1e-12, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const n = 2000;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const expr = new Float32Array(n);
  const centres = Array.from({ length: 15 }, () => [norm() * 8, norm() * 8]);
  for (let i = 0; i < n; i += 1) {
    const k = Math.floor(rand() * 15);
    const c = centres[k] as number[];
    x[i] = (c[0] as number) + norm() * 0.9;
    y[i] = (c[1] as number) + norm() * 0.9;
    expr[i] = rand() < 0.6 ? 0 : Math.max(0, norm() * 1.2 + (k % 3));
  }
  return { x, y, color: expr };
}

describe("embedding axes at small sizes", () => {
  /** The boxes of the tick labels with `anchor`, in order along the axis. */
  function tickBoxes(el: HTMLElement, anchor: string, along: "x" | "y") {
    return (
      Array.from(
        el.querySelectorAll(`svg text[text-anchor="${anchor}"]`),
      ) as SVGTextElement[]
    )
      .filter((t) => /^-?[\d.]+$/.test(t.textContent ?? ""))
      .map((t) => t.getBoundingClientRect())
      .sort((a, b) => (along === "x" ? a.left - b.left : a.top - b.top));
  }

  // Before the fix the axes always had six d3 ticks: the x labels ran
  // together at 250 px wide (fontSize 12) and 300 to 350 px (fontSize 16),
  // and the y labels at 140 px tall (fontSize 12) and 180 px (fontSize 16).
  const cases: [number, number, number][] = [
    [250, 400, 12],
    [300, 400, 16],
    [350, 400, 16],
    [600, 140, 12],
    [600, 180, 16],
  ];
  for (const [w, h, fontSize] of cases) {
    it(`keeps tick labels clear of each other at ${w} x ${h} px, fontSize ${fontSize}`, async () => {
      const el = container(w, h);
      instances.push(
        createEmbedding(el, {
          data: { columns: cells() },
          options: { showAxes: true, theme: { fontSize } },
        }),
      );
      // The axes follow the data once the points are drawn.
      await expect
        .poll(async () => {
          const png = await canvasPNG(el);
          return png ? drawnPixels(png) : 0;
        }, poll)
        .toBeGreaterThan(100);
      await new Promise((r) => setTimeout(r, 300));
      const xs = tickBoxes(el, "middle", "x");
      expect(xs.length).toBeGreaterThan(1);
      for (let i = 1; i < xs.length; i += 1) {
        expect((xs[i] as DOMRect).left).toBeGreaterThan(
          (xs[i - 1] as DOMRect).right,
        );
      }
      const ys = tickBoxes(el, "end", "y");
      expect(ys.length).toBeGreaterThan(1);
      for (let i = 1; i < ys.length; i += 1) {
        expect((ys[i] as DOMRect).top).toBeGreaterThanOrEqual(
          (ys[i - 1] as DOMRect).bottom,
        );
      }
    });
  }
});

describe("spatial colour bar labels", () => {
  /** Spots on a 4 x 4 grid over a 100 x 100 image, coloured by `color`. */
  function spots(color: number[]) {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        x.push(12.5 + i * 25);
        y.push(12.5 + j * 25);
      }
    }
    return {
      columns: {
        x,
        y,
        color: x.map((_, i) => color[i % color.length]) as unknown as string[],
      },
      meta: { imgWidth: 100, imgHeight: 100, spotDiameter: 20 },
    };
  }

  /** The colour bar's tick labels, top first, with the y of each. */
  function barLabels(el: HTMLElement): { text: string; y: number }[] {
    return (Array.from(el.querySelectorAll("svg text")) as SVGTextElement[])
      .map((t) => ({
        text: t.textContent ?? "",
        y: Number(t.getAttribute("y")),
      }))
      .sort((a, b) => a.y - b.y);
  }

  const cases: [string, number[], string[]][] = [
    // Before the fix: "0.03" over "1.2e-3".
    ["small values", [0.0012, 0.01, 0.02, 0.03], ["0.03", "0.02", "0.01"]],
    // Before the fix: "1.2e+6" over "850".
    ["large values", [850, 4e5, 8e5, 1.2e6], ["1.0M", "0.5M"]],
  ];
  for (const [what, color, labels] of cases) {
    it(`labels round values in one format for ${what}`, () => {
      const el = container(400, 300);
      instances.push(flush(el, { data: spots(color) }));
      const bar = barLabels(el);
      expect(bar.map((b) => b.text)).toEqual(labels);
    });
  }

  it("labels one value once when every spot has it", () => {
    // Before the fix the bar read "6" over "5", and every spot took the
    // low end of the ramp.
    const el = container(400, 300);
    instances.push(
      flush(el, {
        data: spots([5]),
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    expect(barLabels(el).map((b) => b.text)).toEqual(["5"]);
    // The spots take the middle of the ramp, where the bar labels their
    // value. The first row of spots is centred 37.5 px down.
    const hex = (rgb: number[]) =>
      `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const row = new Set<string>();
    for (let x = 0; x < 400; x += 2) row.add(hex(pixel(el, x, 37.5)));
    expect(row.has(ramp("viridis")(0.5).toLowerCase())).toBe(true);
    expect(row.has(ramp("viridis")(0).toLowerCase())).toBe(false);
  });
});

describe("embedding axes deep in a zoom", () => {
  it("keeps every tick label clear of the axis titles and inside the plot", async () => {
    // The 2000 cells above with their axes and colour bar, zoomed 40 and
    // then 60 wheel steps. Before the fix the exact labels, seven and more
    // characters long, ran under the y title, as the margin held about
    // five.
    const el = container(800, 480);
    instances.push(
      createEmbedding(el, {
        data: { columns: cells() },
        options: { showAxes: true },
      }),
    );
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(100);
    await new Promise((r) => setTimeout(r, 300));

    const all = () =>
      Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
    const numeric = (anchor: string) =>
      all().filter(
        (t) =>
          t.getAttribute("text-anchor") === anchor &&
          /^-?[\d.]+$/.test(t.textContent ?? ""),
      );
    const titleBox = (label: string) =>
      (
        all().find((t) => t.textContent === label) as SVGTextElement
      ).getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;
    const frame = () =>
      new Promise((r) => requestAnimationFrame(() => r(null)));

    let steps = 0;
    for (const target of [40, 60]) {
      for (; steps < target; steps += 1) {
        const canvas = el.querySelector("canvas") as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -120,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        );
        await frame();
      }
      // The y labels carry seven or more characters at this zoom.
      await expect
        .poll(
          () =>
            Math.max(
              0,
              ...numeric("end").map((t) => t.textContent?.length ?? 0),
            ),
          { timeout: 30_000, interval: 100 },
        )
        .toBeGreaterThanOrEqual(7);
      await new Promise((r) => setTimeout(r, 300));
      const yTitle = titleBox("UMAP 2");
      const xTitle = titleBox("UMAP 1");
      const plot = (
        el.querySelector("svg") as SVGSVGElement
      ).getBoundingClientRect();
      const canvasBox = (
        el.querySelector("canvas") as HTMLCanvasElement
      ).getBoundingClientRect();
      const ys = numeric("end");
      const xs = numeric("middle");
      expect(ys.length, `${target} steps`).toBeGreaterThan(1);
      expect(xs.length, `${target} steps`).toBeGreaterThan(1);
      for (const t of [...ys, ...xs]) {
        const b = t.getBoundingClientRect();
        const what = `${t.textContent} after ${target} steps`;
        expect(overlap(b, yTitle), what).toBe(false);
        expect(overlap(b, xTitle), what).toBe(false);
        expect(b.left, what).toBeGreaterThanOrEqual(plot.left);
        expect(b.right, what).toBeLessThanOrEqual(plot.right);
      }
      // The labels stay exact: none repeats.
      const values = ys.map((t) => t.textContent);
      expect(new Set(values).size).toBe(values.length);
      // The colour bar keeps its gutter right of the points, inside the
      // widget.
      const bar = numeric("start");
      expect(bar.length).toBeGreaterThan(1);
      for (const t of bar) {
        const b = t.getBoundingClientRect();
        expect(b.left).toBeGreaterThan(canvasBox.right);
        expect(b.right).toBeLessThanOrEqual(plot.right);
      }
    }
  });
});

describe("spatial export of a tissue image from another origin", () => {
  /** A PNG on this test server, under a host name of another origin. */
  async function crossOriginPNG(): Promise<string | null> {
    const { default: path } = await import("../../../assets/favicon.png?url");
    for (const host of ["127.0.0.1", "[::1]", "localhost"]) {
      if (host === location.hostname) continue;
      const url = `${location.protocol}//${host}:${location.port}${path}`;
      const loads = await new Promise<boolean>((resolve) => {
        const im = new Image();
        im.onload = () => resolve(true);
        im.onerror = () => resolve(false);
        im.src = url;
      });
      if (loads) return url;
    }
    return null;
  }

  /** Pixels of a PNG (a Blob or a data URL) within 2 of `rgb`. */
  async function pixelsOf(png: Blob | string, rgb: number[]) {
    const blob =
      typeof png === "string" ? await (await fetch(png)).blob() : png;
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let k = 0; k < d.length; k += 4) {
      if (rgb.every((v, i) => Math.abs((d[k + i] as number) - v) <= 2)) {
        count += 1;
      }
    }
    return count;
  }

  it("exports the spots and legend without the image", async () => {
    const url = await crossOriginPNG();
    expect(url, "another host name for the test server").not.toBeNull();
    // The test server answers CORS requests from its other host names, so
    // the image is kept from asking: it then loads as from a server that
    // sends no CORS headers, and taints the canvas.
    const proto = HTMLImageElement.prototype;
    const crossOrigin = Object.getOwnPropertyDescriptor(
      proto,
      "crossOrigin",
    ) as PropertyDescriptor;
    Object.defineProperty(proto, "crossOrigin", {
      configurable: true,
      get: () => null,
      set: () => {},
    });
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (message: unknown) => {
      warned.push(String(message));
    };
    try {
      const el = container(400, 300);
      const plot = createSpatial(el, {
        data: {
          columns: { x: [50], y: [50], color: ["a"] },
          meta: {
            image: url as string,
            imgWidth: 100,
            imgHeight: 100,
            spotDiameter: 30,
            colors: ["#ff00ff"],
          },
        },
        options: { spotOpacity: 1 },
      });
      instances.push(plot);
      const canvas = el.querySelector("canvas") as HTMLCanvasElement;
      const tainted = () => {
        try {
          canvas.getContext("2d")?.getImageData(0, 0, 1, 1);
          return false;
        } catch {
          return true;
        }
      };
      await expect.poll(tainted, poll).toBe(true);

      // The PNG export was null.
      const png = await plot.exportPNG?.(1);
      expect(png).toBeInstanceOf(Blob);
      expect(await pixelsOf(png as Blob, [255, 0, 255])).toBeGreaterThan(500);
      expect(svgTexts(el)).toContain("a");

      // The SVG export left out the spots as well as the image.
      const svg = plot.exportSVG?.() ?? "";
      const href = /<image[^>]* href="(data:image\/png[^"]+)"/.exec(svg)?.[1];
      expect(href).toBeTruthy();
      expect(await pixelsOf(href as string, [255, 0, 255])).toBeGreaterThan(
        500,
      );

      const said = warned.join("\n");
      expect(said).toContain("without the image");
      expect(said).not.toContain("leaves out the image and spots");
    } finally {
      Object.defineProperty(proto, "crossOrigin", crossOrigin);
      console.warn = warn;
    }
  });
});
