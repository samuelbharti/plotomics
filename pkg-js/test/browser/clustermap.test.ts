import { agnes } from "ml-hclust";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

// Count the clustering runs; the real agnes still runs.
vi.mock("ml-hclust", { spy: true });

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

  it("clusters again only when the data or a clustering option changes", () => {
    const values = Float32Array.from(
      { length: 8 * 5 },
      (_, i) => (i * 37) % 11,
    );
    const data = () => ({
      columns: { values: values.slice() },
      meta: { nrows: 8, ncols: 5 },
    });
    const all = {
      metric: "euclidean" as const,
      linkage: "average" as const,
      zScore: false,
      clusterRows: true,
      clusterCols: true,
      colormap: "viridis" as const,
      showLabels: true,
      legendTitle: "value",
    };
    const el = container();
    const runs = vi.mocked(agnes);
    runs.mockClear();
    const plot = createClustermap(el, { data: data(), options: all });
    instances.push(plot);
    expect(runs).toHaveBeenCalledTimes(2);
    // A Shiny re-render: the same data again, then every option.
    const rerender = (opts: typeof all) => {
      runs.mockClear();
      plot.setData(data());
      plot.setOptions(opts);
      return runs.mock.calls.length;
    };
    expect(rerender({ ...all, showLabels: false, legendTitle: "expr" })).toBe(
      0,
    );
    expect(rerender({ ...all, colormap: "rdbu" as never })).toBe(0);
    expect(rerender({ ...all, metric: "correlation" as never })).toBe(2);
    // Turning row clustering off leaves the columns as they were.
    expect(
      rerender({ ...all, metric: "correlation" as never, clusterRows: false }),
    ).toBe(0);
    // New values cluster again.
    runs.mockClear();
    values[0] = 99;
    plot.setData(data());
    expect(runs).toHaveBeenCalledTimes(1);
    expect(svgTexts(el).some((t) => t.startsWith("value"))).toBe(true);
  });

  it("keeps the NA key inside a narrow widget", () => {
    const el = container(300, 400);
    instances.push(
      createClustermap(el, {
        data: {
          columns: {
            values: [0, 0, 1, 1, null, 5, 10, 10] as unknown as number[],
          },
          meta: { nrows: 4, ncols: 2 },
        },
      }),
    );
    const na = Array.from(el.querySelectorAll("svg text")).find(
      (t) => t.textContent === "NA",
    ) as SVGTextElement;
    const b = na.getBBox();
    expect(b.x + b.width).toBeLessThanOrEqual(300);
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

  it("draws labels only where it made room for them", () => {
    const el = container(800, 560);
    const nrows = 50;
    const ncols = 70;
    instances.push(
      createClustermap(el, {
        data: {
          columns: {
            values: Array.from({ length: nrows * ncols }, (_, i) =>
              Math.sin(i * 0.37),
            ),
          },
          meta: {
            nrows,
            ncols,
            rowLabels: Array.from({ length: nrows }, (_, i) => `gene_${i}`),
            colLabels: Array.from({ length: ncols }, (_, j) => `sample_${j}`),
          },
        },
      }),
    );
    const box = el.getBoundingClientRect();
    const bar = Array.from(el.querySelectorAll("svg rect")).find((r) =>
      (r.getAttribute("fill") ?? "").startsWith("url("),
    ) as SVGRectElement;
    const barLeft = bar.getBoundingClientRect().left;
    const labels = Array.from(el.querySelectorAll("svg text")).filter((t) =>
      /^(gene|sample)|\u2026$/.test(t.textContent ?? ""),
    );
    for (const t of labels) {
      const r = t.getBoundingClientRect();
      // Before the fix one-letter stubs ran over the bar and off the bottom.
      expect(t.textContent).not.toMatch(/^.\u2026$/);
      expect(r.bottom).toBeLessThanOrEqual(box.bottom);
      if ((t.textContent ?? "").startsWith("gene")) {
        expect(r.right).toBeLessThanOrEqual(barLeft);
      }
    }
  });

  it("keeps a usable heatmap in a narrow widget with long row labels", () => {
    const el = container(250, 480);
    instances.push(
      createClustermap(el, {
        data: {
          columns: { values: Array.from({ length: 60 }, (_, i) => i % 7) },
          meta: {
            nrows: 10,
            ncols: 6,
            rowLabels: Array.from(
              { length: 10 },
              (_, i) => `ENSG00000141517.17_TP53_${i}`,
            ),
          },
        },
      }),
    );
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    // Before the fix the row labels took the width and left 1 px.
    expect(canvas.clientWidth).toBeGreaterThanOrEqual(60);
  });

  it("keeps a long legend title inside the widget, clear of the ticks", () => {
    const el = container(800, 560);
    const values = Array.from({ length: 24 }, (_, i) => -3000 + i * 87);
    instances.push(
      createClustermap(el, {
        data: { columns: { values }, meta: { nrows: 6, ncols: 4 } },
        options: {
          clusterCols: false,
          zScore: false,
          legendTitle: "log2 normalised expression across every sample",
        },
      }),
    );
    const texts = Array.from(el.querySelectorAll("svg text"));
    const title = texts.find((t) =>
      (t.textContent ?? "").startsWith("log2"),
    ) as SVGTextElement;
    const tr = title.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    expect(tr.top).toBeGreaterThanOrEqual(box.top);
    expect(tr.bottom).toBeLessThanOrEqual(box.bottom);
    expect(tr.right).toBeLessThanOrEqual(box.right);
    // The middle tick reads -2.0e+3, the widest of the three.
    const mid = texts.find(
      (t) => t.textContent === "-2.0e+3",
    ) as SVGTextElement;
    expect(mid.getBoundingClientRect().right + 2).toBeLessThanOrEqual(tr.left);
  });

  it("labels the middle of a symmetric colour range 0", () => {
    const el = container(600, 480);
    // Held in float32, the two ends are not exactly opposite, so before the
    // fix their middle printed as a tiny number such as -2.4e-7.
    const values = Array.from(
      { length: 3500 },
      (_, i) => Math.sin(i * 0.37) * 3,
    );
    instances.push(
      createClustermap(el, {
        data: { columns: { values }, meta: { nrows: 50, ncols: 70 } },
      }),
    );
    expect(svgTexts(el)).toContain("0");
  });
});
