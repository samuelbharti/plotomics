import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createVolcano } from "../../src/components/volcano.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { type MarkBox, drawnPixels, markBox } from "./helpers.js";

// The volcano and the embedding draw with regl-scatterplot. These tests check
// that the first view shows all the data across the plot area, that the axes
// state the range the points are drawn at, and what a resize does.

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

/** The numbers printed on the axes, in document order. */
function axisNumbers(el: HTMLElement): number[] {
  return Array.from(el.querySelectorAll("svg text"))
    .map((t) => Number(t.textContent))
    .filter((v) => Number.isFinite(v));
}

async function box(instance: PlotomicsInstance<unknown>) {
  const png = await instance.exportPNG?.(1);
  return png ? markBox(png) : null;
}

// With 4% padding on each side, the data starts 3.7% in from each edge.
const fillsPlotArea = (b: MarkBox | null) =>
  b !== null &&
  b.left < 0.06 &&
  b.right > 0.94 &&
  b.top < 0.06 &&
  b.bottom > 0.94;

const poll = { timeout: 10_000, interval: 100 };

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

    await expect.poll(() => box(volcano), poll).toSatisfy(fillsPlotArea);
    const ticks = axisNumbers(el);
    expect(ticks).toContain(-4);
    expect(ticks).toContain(4);
    expect(ticks).toContain(20);
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

      await expect.poll(() => box(embedding), poll).toSatisfy(fillsPlotArea);
      const ticks = axisNumbers(el);
      expect(ticks).toContain(6);
      expect(ticks).toContain(14);
      expect(ticks).toContain(-20);
      expect(ticks).toContain(-10);
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
      .poll(() => box(embedding), poll)
      .toSatisfy((b: MarkBox | null) => b !== null && b.left < 0.06);
    const b = (await box(embedding)) as MarkBox;
    const pxPerUnitX = b.widthPx / 20;
    const pxPerUnitY = b.heightPx / 10;
    expect(Math.abs(pxPerUnitX / pxPerUnitY - 1)).toBeLessThan(0.03);
  });

  it("embedding: refits on resize until panned or zoomed, then keeps the view", async () => {
    const el = container(800, 400);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) } },
      options: { showAxes: true },
    });
    instances.push(embedding);
    await expect.poll(() => box(embedding), poll).toSatisfy(fillsPlotArea);

    el.style.cssText = "width:500px;height:500px;";
    embedding.resize(500, 500);
    await expect.poll(() => box(embedding), poll).toSatisfy(fillsPlotArea);

    // Zoom in at the centre with the mouse wheel.
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
    // Zoomed in, the axes no longer reach the ends of the data.
    await expect
      .poll(() => axisNumbers(el), poll)
      .toSatisfy((ticks: number[]) => !ticks.includes(-20) && ticks.length > 0);
    const zoomed = axisNumbers(el);

    el.style.cssText = "width:700px;height:500px;";
    embedding.resize(700, 500);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterResize = axisNumbers(el);
    expect(afterResize).not.toContain(-20);
    expect(afterResize).not.toContain(-10);
    // The y range is the same, since the height did not change.
    expect(afterResize.filter((t) => t < 0)).toEqual(
      zoomed.filter((t) => t < 0),
    );
  });

  it("embedding: the last of two quick setData calls wins, points and axes", async () => {
    const el = container(800, 400);
    const embedding = createEmbedding(el, {
      data: { columns: { x: spread(N, 5, 15, 3), y: spread(N, -20, -10, 4) } },
      options: { showAxes: true },
    });
    instances.push(embedding);

    // Straight after the first draw has started: five points on a new range.
    embedding.setData({
      columns: {
        x: Float64Array.from([100, 125, 150, 175, 200]),
        y: Float64Array.from([0, 25, 50, 75, 100]),
      },
    });

    // Five points cover a few dozen pixels. The first 2,000 cover thousands.
    await expect
      .poll(async () => {
        const png = await embedding.exportPNG?.(1);
        return png ? drawnPixels(png) : null;
      }, poll)
      .toSatisfy((n: number | null) => n !== null && n > 0 && n < 500);
    const ticks = axisNumbers(el);
    expect(ticks).toContain(100);
    expect(ticks).toContain(200);
    expect(ticks).not.toContain(-20);
  });
});
