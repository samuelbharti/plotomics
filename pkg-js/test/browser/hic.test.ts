import { afterEach, describe, expect, it } from "vitest";
import { createHic, cssColorToUnitRGB } from "../../src/components/hic.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { drawnPixels } from "./helpers.js";

// Hi-C draws through WebGL, so these checks need a real browser: the matrix
// must reach the canvas, the axis labels must state the right coordinates, and
// an option change must reach the drawn cells.

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** A symmetric distance-decay matrix, row-major. */
function decay(n: number) {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      values[r * n + c] = 1000 / (Math.abs(r - c) + 1);
  }
  return values;
}

/** Text of the x-axis tick labels, left to right. */
function xTicks(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('svg text[text-anchor="middle"]'))
    .map((t) => t.textContent ?? "")
    .filter((s) => s !== "" && !s.startsWith("contacts"));
}

/** Hover the centre of cell (row, col) and return the tooltip text. */
function hover(el: HTMLElement, n: number, row: number, col: number): string {
  // Same layout as the component: margins 16/96/46/60, square plot, centered.
  const r = el.getBoundingClientRect();
  const innerW = r.width - 60 - 96;
  const innerH = r.height - 16 - 46;
  const size = Math.min(innerW, innerH);
  const left = 60 + (innerW - size) / 2;
  const top = 16 + (innerH - size) / 2;
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + left + ((col + 0.5) / n) * size,
      clientY: r.top + top + ((row + 0.5) / n) * size,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV");
  return tip?.textContent ?? "";
}

let instances: PlotomicsInstance<unknown>[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("hic in a browser", () => {
  it("draws the matrix and labels the axes in kb", async () => {
    const el = container(600, 400);
    const hic = createHic(el, {
      data: {
        columns: { values: decay(64) },
        meta: { n: 64, binSize: 10_000 },
      },
    });
    instances.push(hic);

    const png = await hic.exportPNG?.(1);
    expect(png).toBeTruthy();
    // The plot square is 338 px wide; most of it is colored.
    expect(await drawnPixels(png as Blob)).toBeGreaterThan(338 * 338 * 0.5);
    expect(xTicks(el)).toEqual([
      "0",
      "100kb",
      "200kb",
      "300kb",
      "400kb",
      "500kb",
      "600kb",
    ]);
  });

  it("does not throw on missing cells, and shows them as NA", () => {
    const el = container(600, 400);
    const values: (number | null)[] = Array.from(decay(4));
    values[1 * 4 + 2] = null; // R sends NA as null
    const hic = createHic(el, {
      data: { columns: { values: values as number[] }, meta: { n: 4 } },
    });
    instances.push(hic);
    expect(hover(el, 4, 1, 2)).toContain("NA");
  });

  it("applies a symmetric change to a sparse matrix right away", () => {
    const el = container(600, 400);
    const hic = createHic(el, {
      data: { columns: { i: [0], j: [1], v: [7] }, meta: { n: 4 } },
    });
    instances.push(hic);
    expect(hover(el, 4, 1, 0)).toContain("contacts: 7");

    hic.setOptions({ symmetric: false });
    expect(hover(el, 4, 1, 0)).toContain("contacts: 0");
    expect(hover(el, 4, 0, 1)).toContain("contacts: 7");
  });

  it("keeps the overlay and does not throw when WebGL setup fails", () => {
    const proto = WebGLRenderingContext.prototype;
    const real = proto.getShaderParameter;
    // Every shader "fails to compile".
    proto.getShaderParameter = () => false;
    try {
      const el = container(600, 400);
      const hic = createHic(el, {
        data: {
          columns: { values: decay(64) },
          meta: { n: 64, binSize: 10_000 },
        },
      });
      instances.push(hic);
      expect(xTicks(el)).toContain("100kb");
      expect(() => hic.setOptions({ vmin: 1 })).not.toThrow();
    } finally {
      proto.getShaderParameter = real;
    }
  });

  it("reads CSS colours for the background, with white for transparent", () => {
    expect(cssColorToUnitRGB("#000")).toEqual([0, 0, 0]);
    expect(cssColorToUnitRGB("white")).toEqual([1, 1, 1]);
    expect(cssColorToUnitRGB("rgb(255, 0, 0)")).toEqual([1, 0, 0]);
    expect(cssColorToUnitRGB("transparent")).toEqual([1, 1, 1]);
  });

  it("draws a diverging map with a negative vmin", async () => {
    const el = container(600, 400);
    // Observed/expected style values from -2 to 2.
    const n = 32;
    const values = new Float64Array(n * n).map(
      (_, k) => ((k % n) / (n - 1)) * 4 - 2,
    );
    const hic = createHic(el, {
      data: { columns: { values }, meta: { n } },
      options: { colormap: "rdbu", transform: "linear", vmin: -2, vmax: 2 },
    });
    instances.push(hic);

    const png = (await hic.exportPNG?.(1)) as Blob;
    // Before the fix, every value at or below 0 was drawn as background.
    expect(await drawnPixels(png)).toBeGreaterThan(338 * 338 * 0.9);
  });
});
