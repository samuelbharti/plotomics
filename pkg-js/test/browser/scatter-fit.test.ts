import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createVolcano } from "../../src/components/volcano.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { type MarkBox, canvasPNG, drawnPixels, markBox } from "./helpers.js";

// The volcano and the embedding draw with regl-scatterplot. These tests check
// that the first view shows all the data across the plot area, that the axes
// state the range the points are drawn at, and what a resize, an option
// change and a quick second update do.

/** Deterministic values spread evenly over [lo, hi]. */
function spread(n: number, lo: number, hi: number, seed: number) {
  let s = seed;
  return Float64Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  });
}

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** The numbers on each axis. x labels are centred, y labels right-aligned. */
function ticks(el: HTMLElement): { x: number[]; y: number[] } {
  const read = (anchor: string) =>
    Array.from(el.querySelectorAll(`svg text[text-anchor="${anchor}"]`))
      .map((t) => Number(t.textContent))
      .filter((v) => Number.isFinite(v));
  return { x: read("middle"), y: read("end") };
}

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

/** Where the points sit on the canvas (the PNG export adds the axes). */
async function box(el: HTMLElement) {
  const png = await canvasPNG(el);
  return png ? markBox(png) : null;
}

// With 4% padding on each side, the data starts 3.7% in from each edge. The
// inner bounds catch points that spill past the edges, which would also make
// the box reach from edge to edge.
const fillsPlotArea = (b: MarkBox | null) =>
  b !== null &&
  b.left > 0.01 &&
  b.left < 0.06 &&
  b.right > 0.94 &&
  b.right < 0.99 &&
  b.top > 0.01 &&
  b.top < 0.06 &&
  b.bottom > 0.94 &&
  b.bottom < 0.99;

const poll = { timeout: 10_000, interval: 100 };

/** Zoom in at the centre of the plot with the mouse wheel. */
function zoomIn(el: HTMLElement) {
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const r = canvas.getBoundingClientRect();
  for (let i = 0; i < 5; i += 1) {
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -120,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

const N = 2000;
let instances: PlotomicsInstance<unknown>[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("scatter components frame their data", () => {
  it("volcano: shows every point and labels the axes with the data range", async () => {
    const el = container(800, 400);
    const volcano = createVolcano(el, {
      data: { columns: { x: spread(N, -4, 4, 1), y: spread(N, 0, 20, 2) } },
      options: { labelTopN: 0, showThresholdLines: false },
    });
    instances.push(volcano);

    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);
    expect(ticks(el).x).toContain(-4);
    expect(ticks(el).x).toContain(4);
    expect(ticks(el).y).toContain(20);
  });

  it("volcano: an option change keeps the zoomed view", async () => {
    const el = container(800, 400);
    const volcano = createVolcano(el, {
      data: { columns: { x: spread(N, -4, 4, 1), y: spread(N, 0, 20, 2) } },
      options: { labelTopN: 0 },
    });
    instances.push(volcano);
    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);

    zoomIn(el);
    await expect
      .poll(() => ticks(el).x, poll)
      .toSatisfy((x: number[]) => x.length > 0 && !x.includes(-4));
    const zoomed = ticks(el);

    volcano.setOptions({ fcThreshold: 2 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(ticks(el)).toEqual(zoomed);
  });

  it("embedding: frames data far from the origin, in wide and tall boxes", async () => {
    // UMAP-like coordinates, nowhere near [-1, 1].
    const columns = { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) };
    for (const [width, height] of [
      [800, 400],
      [400, 700],
    ] as const) {
      const el = container(width, height);
      const embedding = createEmbedding(el, {
        data: { columns },
        options: { showAxes: true },
      });
      instances.push(embedding);

      await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);
      expect(ticks(el).x).toContain(6);
      expect(ticks(el).x).toContain(14);
      expect(ticks(el).y).toContain(-20);
      expect(ticks(el).y).toContain(-10);
    }
  });

  it("embedding with aspect 'equal': one data unit is as wide as it is tall", async () => {
    const el = container(600, 600);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 0, 20, 5), y: spread(N, 0, 10, 6) } },
      options: { showAxes: true, aspect: "equal" },
    });
    instances.push(embedding);

    // x spans 20 units across the width, so y spans half of that.
    await expect
      .poll(() => box(el), poll)
      .toSatisfy((b: MarkBox | null) => b !== null && b.left < 0.06);
    const b = (await box(el)) as MarkBox;
    const pxPerUnitX = b.widthPx / 20;
    const pxPerUnitY = b.heightPx / 10;
    expect(Math.abs(pxPerUnitX / pxPerUnitY - 1)).toBeLessThan(0.03);
  });

  it("embedding: turning the axes on refits the smaller plot area", async () => {
    const el = container(400, 700);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) } },
    });
    instances.push(embedding);
    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);

    embedding.setOptions({ showAxes: true });
    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);
    expect(ticks(el).x).toContain(6);
    expect(ticks(el).x).toContain(14);
  });

  it("embedding: refits on resize until panned or zoomed, then keeps the view", async () => {
    const el = container(800, 400);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) } },
      options: { showAxes: true },
    });
    instances.push(embedding);
    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);

    el.style.cssText = "width:500px;height:500px;";
    embedding.resize(500, 500);
    await expect.poll(() => box(el), poll).toSatisfy(fillsPlotArea);
    expect(ticks(el).x).toContain(6);
    expect(ticks(el).x).toContain(14);
    expect(ticks(el).y).toContain(-20);
    expect(ticks(el).y).toContain(-10);

    zoomIn(el);
    // Zoomed in, the axes no longer reach the ends of the data.
    await expect
      .poll(() => ticks(el).y, poll)
      .toSatisfy((y: number[]) => y.length > 0 && !y.includes(-20));
    const zoomed = ticks(el);

    el.style.cssText = "width:700px;height:500px;";
    embedding.resize(700, 500);
    // The plot area grew wider at the same height and the zoom is kept, so
    // the x axis covers more data and the y axis the same.
    await expect
      .poll(() => span(ticks(el).x), poll)
      .toBeGreaterThan(span(zoomed.x) * 1.2);
    const after = ticks(el);
    expect(after.y).toEqual(zoomed.y);
    expect(after.x).not.toContain(6);
    expect(after.x).not.toContain(14);
  });

  it("embedding: the last of two quick setData calls wins, points and axes", async () => {
    const el = container(800, 400);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) } },
      options: { showAxes: true },
    });
    instances.push(embedding);

    // Once the first render has started: five points on a new range.
    await new Promise((resolve) => setTimeout(resolve, 0));
    embedding.setData({
      columns: {
        x: Float64Array.from([100, 125, 150, 175, 200]),
        y: Float64Array.from([0, 25, 50, 75, 100]),
      },
    });

    // Five points cover a few dozen pixels. The first 2,000 cover thousands.
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : null;
      }, poll)
      .toSatisfy((n: number | null) => n !== null && n > 0 && n < 500);
    expect(ticks(el).x).toContain(100);
    expect(ticks(el).x).toContain(200);
    expect(ticks(el).y).not.toContain(-20);
  });
});
