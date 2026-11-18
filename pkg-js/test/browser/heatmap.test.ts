import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 600, height = 480) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** RGB of the WebGL canvas at a CSS-pixel point inside the canvas. */
function glPixel(el: HTMLElement, fx: number, fy: number): number[] {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const c = document.createElement("canvas");
  c.width = gl.width;
  c.height = gl.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(gl, 0, 0);
  const d = ctx.getImageData(
    Math.min(c.width - 1, Math.floor(fx * c.width)),
    Math.min(c.height - 1, Math.floor(fy * c.height)),
    1,
    1,
  ).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

/** Hover a point given as fractions of the plot canvas; tooltip text. */
function hoverAt(el: HTMLElement, fx: number, fy: number): string {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const r = gl.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

function svgTexts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("heatmap in a browser", () => {
  it("draws a matrix taller than the GPU texture limit", () => {
    // 20,000 rows by 2 columns: past MAX_TEXTURE_SIZE on many GPUs, and on
    // the software renderer the tests use.
    const nrows = 20000;
    const values = new Float32Array(nrows * 2);
    for (let r = 0; r < nrows; r += 1) {
      values[r * 2] = r;
      values[r * 2 + 1] = r;
    }
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows, ncols: 2 } },
      }),
    );
    const top = glPixel(el, 0.5, 0.01);
    const bottom = glPixel(el, 0.5, 0.99);
    // Viridis runs from dark purple (low, row 0) to yellow (high, last row).
    expect(top).not.toEqual([255, 255, 255]);
    expect(bottom[0] as number).toBeGreaterThan(top[0] as number);
    // One canvas pixel holds about 50 rows; the tooltip names one of the last.
    expect(hoverAt(el, 0.5, 0.9999)).toMatch(/row 199\d\d/);
  });

  it("draws an R null cell grey, keys it, and leaves it out of the range", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: [1, null, 3, 5] as unknown as number[] },
          meta: { nrows: 2, ncols: 2 },
        },
      }),
    );
    // The top-right cell is missing.
    expect(glPixel(el, 0.75, 0.25)).toEqual([0xcc, 0xcc, 0xcc]);
    const texts = svgTexts(el).map((t) => t.textContent);
    // The colour bar runs over 1 to 5, not 0 to 5.
    expect(texts).toContain("1");
    expect(texts).toContain("5");
    expect(texts).toContain("NA");
    expect(hoverAt(el, 0.75, 0.25)).toContain("value: NA");
  });

  it("z-scores a row with a missing cell over the rest of the row", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: [1, Number.NaN, 3] },
          meta: { nrows: 1, ncols: 3 },
        },
        options: { zScore: true },
      }),
    );
    expect(hoverAt(el, 1 / 6, 0.5)).toContain("z: -1");
    expect(hoverAt(el, 5 / 6, 0.5)).toContain("z: 1");
    expect(glPixel(el, 0.5, 0.5)).toEqual([0xcc, 0xcc, 0xcc]);
  });

  it("thins row labels that would overlap and fits long ones", () => {
    const nrows = 60;
    const long = "a very long gene set name that runs past any margin";
    const rowLabels = Array.from({ length: nrows }, (_, i) =>
      i === 0 ? long : `G${i}`,
    );
    const el = container(600, 480);
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: new Float32Array(nrows * 3).fill(1) },
          meta: { nrows, ncols: 3, rowLabels },
        },
      }),
    );
    // Row labels are the unrotated end-anchored texts left of the plot.
    const rows = svgTexts(el).filter(
      (t) =>
        t.getAttribute("text-anchor") === "end" && !t.hasAttribute("transform"),
    );
    const shown = rows.filter((t) => /^G\d+$/.test(t.textContent ?? ""));
    // Rows are about 6.7 px tall: every second one is labelled.
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.length).toBeLessThan(nrows);
    const ys = rows
      .map((t) => Number(t.getAttribute("y")))
      .sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      expect((ys[i] as number) - (ys[i - 1] as number)).toBeGreaterThanOrEqual(
        11,
      );
    }
    // The long label is cut to the margin and stays inside the element.
    const cut = rows.find((t) => (t.textContent ?? "").endsWith("…"));
    expect(cut).toBeDefined();
    expect((cut as SVGTextElement).getBBox().x).toBeGreaterThanOrEqual(0);
  });

  it("gives each heatmap on a page its own colour bar gradient", () => {
    const a = container();
    const b = container();
    instances.push(
      createHeatmap(a, {
        data: { columns: { values: [1, 2] }, meta: { nrows: 1, ncols: 2 } },
      }),
      createHeatmap(b, {
        data: { columns: { values: [1, 2] }, meta: { nrows: 1, ncols: 2 } },
        options: { colormap: "rdbu" },
      }),
    );
    const idA = a.querySelector("linearGradient")?.getAttribute("id");
    const idB = b.querySelector("linearGradient")?.getAttribute("id");
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});
