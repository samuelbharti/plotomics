import { afterEach, describe, expect, it } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 600, height = 480) {
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

/** RGB of the heatmap canvas at a fraction of its width and height. */
function cellPixel(el: HTMLElement, fx: number, fy: number): number[] {
  const c = el.querySelector("canvas") as HTMLCanvasElement;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const d = ctx.getImageData(
    Math.floor(fx * c.width),
    Math.floor(fy * c.height),
    1,
    1,
  ).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("clustermap in a browser", () => {
  it("draws every row once when a row has a missing cell", () => {
    // The issue's matrix, with R's null for the NaN.
    const el = container();
    instances.push(
      createClustermap(el, {
        data: {
          columns: {
            values: [0, 0, 1, 1, null, 5, 10, 10] as unknown as number[],
          },
          meta: {
            nrows: 4,
            ncols: 2,
            rowLabels: ["r0", "r1", "r2", "r3"],
            colLabels: ["c0", "c1"],
          },
        },
      }),
    );
    const texts = svgTexts(el);
    for (const label of ["r0", "r1", "r2", "r3", "c0", "c1"]) {
      expect(texts.filter((t) => t === label)).toHaveLength(1);
    }
    expect(texts).toContain("NA");
    // Somewhere on the heatmap is the grey of the missing cell.
    let grey = false;
    for (let r = 0; r < 4 && !grey; r += 1) {
      for (let c = 0; c < 2 && !grey; c += 1) {
        const [R, G, B] = cellPixel(el, (c + 0.5) / 2, (r + 0.5) / 4);
        grey = R === 0xcc && G === 0xcc && B === 0xcc;
      }
    }
    expect(grey).toBe(true);
  });

  it("does not cluster again when the options sent are unchanged", () => {
    const n = 600;
    const values = new Float32Array(n * 6);
    let s = 7;
    for (let i = 0; i < values.length; i += 1) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    const el = container();
    const data = { columns: { values }, meta: { nrows: n, ncols: 6 } };
    const t0 = performance.now();
    const plot = createClustermap(el, { data });
    const first = performance.now() - t0;
    instances.push(plot);
    // R and Python send every option, changed or not.
    const t1 = performance.now();
    plot.setOptions({
      metric: "euclidean",
      linkage: "average",
      zScore: false,
      clusterRows: true,
      clusterCols: true,
      colormap: "viridis",
      showLabels: false,
      legendTitle: "expression",
    });
    const again = performance.now() - t1;
    expect(again).toBeLessThan(first / 5);
    expect(svgTexts(el).some((t) => t.startsWith("expression"))).toBe(true);
  });

  it("gives each clustermap on a page its own colour bar gradient", () => {
    const a = container();
    const b = container();
    const data = {
      columns: { values: [1, 2, 3, 4] },
      meta: { nrows: 2, ncols: 2 },
    };
    instances.push(
      createClustermap(a, { data }),
      createClustermap(b, { data, options: { colormap: "rdbu" } }),
    );
    const idA = a.querySelector("linearGradient")?.getAttribute("id");
    const idB = b.querySelector("linearGradient")?.getAttribute("id");
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});
