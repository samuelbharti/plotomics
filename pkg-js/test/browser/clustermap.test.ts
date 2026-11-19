import { agnes } from "ml-hclust";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import {
  type PlotomicsInstance,
  defaultTheme,
  textSizes,
  textWidth,
  viridis,
} from "../../src/core/index.js";

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

/** The colour bar's gradient stops, low end first. */
function stops(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("linearGradient stop")).map(
    (s) => s.getAttribute("stop-color") ?? "",
  );
}

function hex(rgb: number[]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Runs of pixels down column `x` of an image, from row `y0` up to row `y1`,
 * whose colour passes `hit`.
 */
function columnRuns(
  image: CanvasImageSource,
  width: number,
  height: number,
  x: number,
  hit: (rgb: number[]) => boolean,
  y0 = 0,
  y1 = height,
): number {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(image, 0, 0);
  const d = ctx.getImageData(Math.floor(x), 0, 1, height).data;
  let runs = 0;
  let inRun = false;
  for (let y = Math.floor(y0); y < Math.floor(y1); y += 1) {
    const on = hit([
      d[y * 4] as number,
      d[y * 4 + 1] as number,
      d[y * 4 + 2] as number,
    ]);
    if (on && !inRun) runs += 1;
    inRun = on;
  }
  return runs;
}

/** Any colour but that of 0 in viridis or white. */
function lit(rgb: number[]): boolean {
  const [r, g, b] = rgb;
  return (
    !(r === 68 && g === 1 && b === 84) && !(r === 255 && g === 255 && b === 255)
  );
}

/** A matrix of 0 with 1 in the given rows. */
function withRows(nrows: number, ncols: number, rows: number[]) {
  const values = new Float32Array(nrows * ncols);
  for (const r of rows) values.fill(1, r * ncols, (r + 1) * ncols);
  return values;
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
    // Rows tall enough for 11 px labels on their own, but not with the
    // column labels' gutter as well.
    const nrows = 40;
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
    expect(labels.length).toBeGreaterThan(0);
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
    // Every tick label of the colour bar, -3000 to -1000, ends left of it.
    const ticks = texts.filter((t) => /^-\d+$/.test(t.textContent ?? ""));
    expect(ticks.map((t) => t.textContent)).toContain("-2000");
    for (const t of ticks) {
      expect(t.getBoundingClientRect().right + 2).toBeLessThanOrEqual(tr.left);
    }
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

describe("clustermap colours in a browser", () => {
  const flat = { clusterRows: false, clusterCols: false };

  it("paints the cells with the colour bar's ramp", () => {
    for (const colormap of ["ltc", "ltcdiv"] as const) {
      const el = container();
      instances.push(
        createClustermap(el, {
          data: {
            columns: { values: [-3, -1, 1, 3] },
            meta: { nrows: 2, ncols: 2 },
          },
          options: { ...flat, colormap },
        }),
      );
      const s = stops(el);
      // The lowest cell is the bottom of the bar, the highest its top.
      expect(hex(cellPixel(el, 0.25, 0.25)), colormap).toBe(s[0]);
      expect(hex(cellPixel(el, 0.75, 0.75)), colormap).toBe(s[s.length - 1]);
    }
  });

  it("centres ltcdiv on 0, as rdbu is", () => {
    const el = container();
    instances.push(
      createClustermap(el, {
        data: {
          columns: { values: [0, 1, 2, 3] },
          meta: { nrows: 2, ncols: 2 },
        },
        options: { ...flat, colormap: "ltcdiv" },
      }),
    );
    // The 0 cell takes the cream middle of the ramp, and the scale runs
    // from -3 to 3, labelled at -2, 0 and 2.
    expect(cellPixel(el, 0.25, 0.25)).toEqual([244, 238, 224]);
    expect(svgTexts(el)).toContain("-2");
    expect(svgTexts(el)).toContain("2");
  });

  it("draws z-scores with rdbu unless a colormap is given", () => {
    const data = {
      columns: { values: [1, 2, 3, 4, 5, 6] },
      meta: { nrows: 2, ncols: 3 },
    };
    const a = container();
    const b = container();
    instances.push(
      createClustermap(a, { data, options: { ...flat, zScore: true } }),
      createClustermap(b, {
        data,
        options: { ...flat, zScore: true, colormap: "viridis" },
      }),
    );
    expect(stops(a)[0]).toBe("#2166ac");
    // The middle column has z = 0, the white middle of rdbu.
    expect(cellPixel(a, 0.5, 0.25)).toEqual([247, 247, 247]);
    expect(stops(b)[0]).toBe("#440154");
  });

  it("keeps lone outlier rows when rows outnumber the heatmap's pixels", async () => {
    // 3000 rows in about 450 px: about 7 rows to a pixel.
    const nrows = 3000;
    const ncols = 3;
    const outliers = [600, 1201, 1802, 2403];
    const values = new Float32Array(nrows * ncols);
    for (const r of outliers) values.fill(1, r * ncols, (r + 1) * ncols);
    const el = container();
    const plot = createClustermap(el, {
      data: { columns: { values }, meta: { nrows, ncols } },
      options: { ...flat, showLabels: false },
    });
    instances.push(plot);
    // Each pixel shows the mean of its rows: an outlier row fades with the
    // rows it shares a pixel with, but does not take the colour of 0.
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(
      columnRuns(canvas, canvas.width, canvas.height, canvas.width / 2, lit),
    ).toBe(outliers.length);
    // The exported image draws them too; the scan stays inside the frame.
    const blob = (await plot.exportPNG(1)) as Blob;
    const png = await createImageBitmap(blob);
    const k = png.width / el.clientWidth;
    // The canvas sits inside the theme padding, which the PNG keeps.
    const c = canvas.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const x = (c.left - e.left + c.width / 2) * k;
    const y0 = (c.top - e.top + 2) * k;
    const y1 = (c.bottom - e.top - 2) * k;
    expect(columnRuns(png, png.width, png.height, x, lit, y0, y1)).toBe(
      outliers.length,
    );
  });

  it("keeps lone outlier rows that come second in a block of two", () => {
    const probe = container();
    const p0 = createClustermap(probe, {
      data: {
        columns: { values: new Float32Array(30) },
        meta: { nrows: 10, ncols: 3 },
      },
      options: { ...flat, showLabels: false },
    });
    const h = (probe.querySelector("canvas") as HTMLCanvasElement).height;
    p0.destroy();
    probe.remove();
    // Almost two rows to a pixel: blocks of two rows, and a few of one.
    const nrows = 2 * h - 1;
    const rows: number[] = [];
    for (const i of [
      Math.floor(h / 5),
      Math.floor((2 * h) / 5),
      Math.floor((3 * h) / 5),
    ]) {
      const r0 = Math.floor((i * nrows) / h);
      const r1 = Math.floor(((i + 1) * nrows) / h);
      if (r1 - r0 === 2) rows.push(r0 + 1);
    }
    expect(rows.length).toBeGreaterThan(0);
    const el = container();
    instances.push(
      createClustermap(el, {
        data: {
          columns: { values: withRows(nrows, 3, rows) },
          meta: { nrows, ncols: 3 },
        },
        options: { ...flat, showLabels: false },
      }),
    );
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(
      columnRuns(canvas, canvas.width, canvas.height, canvas.width / 2, lit),
    ).toBe(rows.length);
  });

  it("draws noise as its average, not pushed to the ends of the ramp", () => {
    const nrows = 5000;
    const ncols = 400;
    const values = new Float32Array(nrows * ncols);
    let s = 7;
    for (let i = 0; i < values.length; i += 1) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    const el = container();
    instances.push(
      createClustermap(el, {
        data: { columns: { values }, meta: { nrows, ncols } },
        options: { ...flat, showLabels: false },
      }),
    );
    // Find each sampled pixel's place on the ramp from the nearest of 1001
    // colours along it.
    const ramp = Array.from({ length: 1001 }, (_, i) => viridis(i / 1000));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    let ends = 0;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const o = (y * canvas.width + x) * 4;
        let best = Infinity;
        let t = 0;
        for (let i = 0; i < ramp.length; i += 1) {
          const [r, g, b] = ramp[i] as [number, number, number];
          const dist =
            (r - (d[o] as number)) ** 2 +
            (g - (d[o + 1] as number)) ** 2 +
            (b - (d[o + 2] as number)) ** 2;
          if (dist < best) {
            best = dist;
            t = i / 1000;
          }
        }
        n += 1;
        if (t <= 0.05 || t >= 0.95) ends += 1;
      }
    }
    // In the data, the outer 5% at each end of the range hold 10% of the
    // cells; pooled to their means, fewer pixels reach those ends.
    expect(ends / n).toBeLessThan(0.1);
  });
});

describe("clustermap colour bar labels", () => {
  /** The colour bar's tick labels, top first, with the y of each. */
  function barLabels(el: HTMLElement): { text: string; y: number }[] {
    return (
      Array.from(
        el.querySelectorAll('svg text[text-anchor="start"]'),
      ) as SVGTextElement[]
    )
      .filter((t) => /^-?\d/.test(t.textContent ?? ""))
      .map((t) => ({
        text: t.textContent ?? "",
        y: Number(t.getAttribute("y")),
      }))
      .sort((a, b) => a.y - b.y);
  }

  it("labels round values in one format, each at its value", () => {
    // In R: clustermap(matrix(c(0.004, 3, 100, 1532, 7, 0.5, 22, 900, 1, 2,
    // 3, 4), 4, 3)), here row by row. Before the fix the bar read its raw
    // ends and middle in mixed formats: "1.5e+3", "766" and "4.0e-3".
    const el = container(600, 480);
    instances.push(
      createClustermap(el, {
        data: {
          columns: {
            values: [0.004, 7, 1, 3, 0.5, 2, 100, 22, 3, 1532, 900, 4],
          },
          meta: { nrows: 4, ncols: 3 },
        },
      }),
    );
    const bar = barLabels(el);
    expect(bar.map((b) => b.text)).toEqual(["1500", "1000", "500"]);
    // Equal steps in value are equal steps along the bar.
    const [a, b, c] = bar.map((l) => l.y) as [number, number, number];
    expect(b - a).toBeCloseTo(c - b, 6);
  });

  it("labels z-scores on round values about 0", () => {
    // Rows with one or two high values, whose z-scores reach 2.66. Before
    // the fix the bar read "2.66", "0" and "-2.66".
    const values: number[] = [];
    for (let r = 0; r < 4; r += 1) {
      const row = new Array(10).fill(0);
      row[r] = 2;
      row[r + 1] = 1;
      values.push(...row);
    }
    const el = container(600, 480);
    instances.push(
      createClustermap(el, {
        data: { columns: { values }, meta: { nrows: 4, ncols: 10 } },
        options: { zScore: true },
      }),
    );
    expect(barLabels(el).map((b) => b.text)).toEqual([
      "2",
      "1",
      "0",
      "-1",
      "-2",
    ]);
  });
});

describe("clustermap colour bar in a small widget", () => {
  /** A 6 x 4 matrix of evenly spread values from `lo` to `hi`. */
  const spread = (lo: number, hi: number) =>
    Array.from({ length: 24 }, (_, i) => lo + (i / 23) * (hi - lo));
  const make = (
    el: HTMLElement,
    values: number[],
    fontSize: number,
  ): PlotomicsInstance<unknown> =>
    createClustermap(el, {
      data: { columns: { values }, meta: { nrows: 6, ncols: 4 } },
      options: { theme: { fontSize } },
    });
  const tickLabels = (el: HTMLElement) =>
    (
      Array.from(
        el.querySelectorAll('svg text[text-anchor="start"]'),
      ) as SVGTextElement[]
    ).filter((t) => /^-?\d/.test(t.textContent ?? ""));
  const titleBox = (el: HTMLElement) =>
    (
      Array.from(el.querySelectorAll("svg text")).find(
        (t) => t.textContent === "value",
      ) as SVGTextElement
    ).getBoundingClientRect();

  it("keeps the heatmap and short exact labels for tiny values", () => {
    // Values of about 1e-15. Before the fix the labels were 17 characters
    // long, the colour bar gutter took the width, and at 300 x 300 px,
    // fontSize 20, the heatmap was 1 px wide.
    const values = spread(-3e-15, 6.2e-15);
    const small = container(300, 300);
    instances.push(make(small, values, 20));
    // The gutter takes at most its share in any font, and its labels end
    // left of the title.
    const canvas = small.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.clientWidth).toBeGreaterThanOrEqual(60);
    const title = titleBox(small);
    for (const t of tickLabels(small)) {
      expect(t.getBoundingClientRect().right + 2).toBeLessThanOrEqual(
        title.left,
      );
    }
    // With room for them, the labels are whole, in one power of ten.
    const wide = container(400, 300);
    instances.push(make(wide, values, 20));
    expect(tickLabels(wide).map((t) => t.textContent)).toEqual([
      "-2e-15",
      "0",
      "2e-15",
      "4e-15",
      "6e-15",
    ]);
  });

  it("cuts labels too long for its largest share, and keeps the heatmap", () => {
    // A narrow range far from 0 has long labels in any form.
    const el = container(300, 300);
    instances.push(make(el, spread(1000, 1000.0002), 20));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.clientWidth).toBeGreaterThanOrEqual(60);
    const title = titleBox(el);
    const box = el.getBoundingClientRect();
    expect(title.right).toBeLessThanOrEqual(box.right);
    for (const t of tickLabels(el)) {
      expect(t.textContent?.endsWith("\u2026")).toBe(true);
      expect(t.getBoundingClientRect().right + 2).toBeLessThanOrEqual(
        title.left,
      );
    }
  });

  it("keeps two labels on a short bar", () => {
    // 300 x 150 px, fontSize 16, values 850 to 1.2e6. Before the fix the
    // bar showed "500k" alone.
    const el = container(300, 150);
    instances.push(make(el, spread(850, 1.2e6), 16));
    expect(tickLabels(el).map((t) => t.textContent)).toEqual(["0.5M", "1.0M"]);
  });

  it("keeps the bottom label and the NA key inside a short widget", () => {
    // 300 x 120 px, fontSize 12, values 0 to 1. Before the fix the bar
    // kept its 40 px floor and its bottom label was cut at the last row.
    for (const values of [
      spread(0, 1),
      spread(0, 1).map((v, i) => (i === 5 ? Number.NaN : v)),
    ]) {
      const el = container(300, 120);
      instances.push(make(el, values, 12));
      const box = el.getBoundingClientRect();
      for (const t of Array.from(el.querySelectorAll("svg text, svg rect"))) {
        const r = t.getBoundingClientRect();
        expect(r.bottom, t.textContent || t.tagName).toBeLessThanOrEqual(
          box.bottom,
        );
      }
      expect(tickLabels(el).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("clustermap colour bar labels too long for the gutter", () => {
  /** 12 evenly spread values from `lo` to `hi`, in 4 rows of 3. */
  const spread = (lo: number, hi: number) =>
    Array.from({ length: 12 }, (_, i) => lo + (i / 11) * (hi - lo));
  const tickLabels = (el: HTMLElement) =>
    (
      Array.from(
        el.querySelectorAll('svg text[text-anchor="start"]'),
      ) as SVGTextElement[]
    )
      .map((t) => t.textContent ?? "")
      .filter((s) => /^-?\d/.test(s));

  /**
   * The width of a widget, with no theme padding, whose colour bar gutter
   * at its largest share, 45% of the widget, leaves `room` px for the tick
   * labels: the gutter less 27 px of bar and gaps and the title column.
   * Labels are measured in the plot's own font, so a case holds in any
   * font.
   */
  function widthFor(room: number, fontSize: number) {
    const sizes = textSizes({ fontSize });
    return Math.ceil((room + 27 + 1.4 * sizes.axisTitle) / 0.45);
  }
  const widest = (labels: string[], fontSize: number) =>
    Math.max(
      ...labels.map((s) =>
        textWidth(s, textSizes({ fontSize }).label, defaultTheme.fontFamily),
      ),
    );
  const make = (w: number, lo: number, hi: number, fontSize: number) => {
    const el = container(w, 300);
    instances.push(
      createClustermap(el, {
        data: {
          columns: { values: spread(lo, hi) },
          meta: { nrows: 4, ncols: 3 },
        },
        options: { theme: { fontSize, padding: 0 } },
      }),
    );
    return el;
  };

  it("takes a coarser step before it cuts the labels", () => {
    // 123456.7 to 123458.4 at fontSize 20, in a widget whose gutter holds
    // "123457" but not "123457.5". Before the fix all three labels were
    // cut to "12345\u2026".
    const coarse = ["123457", "123458"];
    const fine = ["123457.0", "123457.5", "123458.0"];
    const [a, b] = [widest(coarse, 20), widest(fine, 20)];
    expect(b - a).toBeGreaterThanOrEqual(6);
    const el = make(widthFor((a + b) / 2, 20), 123456.7, 123458.4, 20);
    expect(tickLabels(el)).toEqual(coarse);
  });

  const pairs: [number, number, number, string[]][] = [
    [1000, 1000.0001, 20, ["1000.0000", "1000.0001"]],
    [1000, 1000.0001, 16, ["1000.0000", "1000.0001"]],
    [0.5, 0.5001, 20, ["0.5000", "0.5001"]],
  ];
  for (const [lo, hi, fontSize, ends] of pairs) {
    it(`cuts only the end pair of ${lo} to ${hi} when even it does not fit, fontSize ${fontSize}`, () => {
      // Before the fix three to seven labels were cut to one prefix, such
      // as "1000.0\u2026".
      const el = make(
        widthFor(widest(ends, fontSize) - 6, fontSize),
        lo,
        hi,
        fontSize,
      );
      const labels = tickLabels(el);
      expect(labels.length).toBe(2);
      for (const s of labels) expect(s.endsWith("\u2026")).toBe(true);
    });
  }
});
