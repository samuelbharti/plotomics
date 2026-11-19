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
    return {
      x: Number(label.getAttribute("x")),
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
        options: { showImage: false, spotOpacity: 1 },
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
