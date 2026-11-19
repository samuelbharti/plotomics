import { afterEach, describe, expect, it } from "vitest";
import { buildRampLUT, createHeatmap } from "../../src/components/heatmap.js";
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

/** The colour of the colour bar's low end. */
function lowStop(el: HTMLElement): string | null {
  return (
    el.querySelector("linearGradient stop")?.getAttribute("stop-color") ?? null
  );
}

/**
 * Runs of pixels down one column of the plot canvas, at a fraction of its
 * width, whose colour passes `hit`.
 */
function colourRuns(
  el: HTMLElement,
  fx: number,
  hit: (rgb: number[]) => boolean,
): number {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const c = document.createElement("canvas");
  c.width = gl.width;
  c.height = gl.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(gl, 0, 0);
  const x = Math.min(c.width - 1, Math.floor(fx * c.width));
  const d = ctx.getImageData(x, 0, 1, c.height).data;
  let runs = 0;
  let inRun = false;
  for (let y = 0; y < c.height; y += 1) {
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

/** Any colour but that of 0 in viridis or the white of an empty canvas. */
function lit(rgb: number[]): boolean {
  const [r, g, b] = rgb;
  return (
    !(r === 68 && g === 1 && b === 84) && !(r === 255 && g === 255 && b === 255)
  );
}

/** A matrix of 0 with `fill` in the given rows. */
function withRows(nrows: number, ncols: number, rows: number[], fill = 1) {
  const values = new Float32Array(nrows * ncols);
  for (const r of rows) values.fill(fill, r * ncols, (r + 1) * ncols);
  return values;
}

/** The height in device pixels of the plot of a heatmap in `container()`. */
function plotHeight(): number {
  const el = container();
  const plot = createHeatmap(el, {
    data: {
      columns: { values: new Float32Array(40) },
      meta: { nrows: 10, ncols: 4 },
    },
  });
  const h = (el.querySelector("canvas") as HTMLCanvasElement).height;
  plot.destroy();
  el.remove();
  return h;
}

/** Zoom by `factor` (below 1 zooms in) about a point of the plot canvas. */
function zoom(el: HTMLElement, factor: number, fy = 0.5) {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const r = gl.getBoundingClientRect();
  gl.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: Math.log(factor) * 1000,
      clientX: r.left + r.width / 2,
      clientY: r.top + fy * r.height,
      bubbles: true,
      cancelable: true,
    }),
  );
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

  it("draws a matrix wider than the GPU texture limit", () => {
    const ncols = 20000;
    const values = new Float32Array(ncols * 2);
    for (let c = 0; c < ncols; c += 1) {
      values[c] = c;
      values[ncols + c] = c;
    }
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows: 2, ncols } },
      }),
    );
    const left = glPixel(el, 0.01, 0.5);
    const right = glPixel(el, 0.99, 0.5);
    expect(left).not.toEqual([255, 255, 255]);
    expect(right[0] as number).toBeGreaterThan(left[0] as number);
    expect(hoverAt(el, 0.9999, 0.5)).toMatch(/col 199\d\d/);
  });

  it("clears an earlier matrix when the next one cannot be drawn", () => {
    const el = container();
    const plot = createHeatmap(el, {
      data: { columns: { values: [1, 2, 3, 4] }, meta: { nrows: 2, ncols: 2 } },
    });
    instances.push(plot);
    expect(glPixel(el, 0.25, 0.25)).not.toEqual([255, 255, 255]);
    // Three values for a 2 x 2 matrix: the GPU refuses the texture.
    plot.setData({
      columns: { values: [1, 2, 3] },
      meta: { nrows: 2, ncols: 2 },
    });
    expect(glPixel(el, 0.25, 0.25)).toEqual([255, 255, 255]);
    expect(svgTexts(el).map((t) => t.textContent)).toContain(
      "The matrix could not be drawn with WebGL here.",
    );
  });

  it("draws nothing of an earlier matrix after empty values", () => {
    const el = container();
    const meta = { nrows: 2, ncols: 2, rowLabels: ["a", "b"] };
    const plot = createHeatmap(el, {
      data: {
        columns: { values: [1, null, 3, 5] as unknown as number[] },
        meta,
      },
    });
    instances.push(plot);
    expect(svgTexts(el).map((t) => t.textContent)).toContain("NA");
    plot.setData({ columns: { values: [] }, meta });
    expect(glPixel(el, 0.25, 0.25)).toEqual([255, 255, 255]);
    // No row labels, colour bar values or NA key are left from the first.
    expect(svgTexts(el)).toHaveLength(0);
  });

  it("keeps lone outlier rows when rows outnumber the plot's pixels", () => {
    // 5000 rows in about 420 px: about 12 rows to a pixel.
    const nrows = 5000;
    const ncols = 4;
    const outliers = [1500, 2001, 2502, 3003, 3504];
    const values = new Float32Array(nrows * ncols);
    for (const r of outliers) values.fill(1, r * ncols, (r + 1) * ncols);
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows, ncols } },
      }),
    );
    // Each pixel shows the mean of its rows: an outlier row fades with the
    // rows it shares a pixel with, but does not take the colour of 0.
    expect(colourRuns(el, 0.5, lit)).toBe(outliers.length);
    // Zoomed in on the middle, fewer rows share a pixel; all still show.
    zoom(el, Math.exp(-0.5));
    expect(colourRuns(el, 0.5, lit)).toBe(outliers.length);
  });

  it("keeps lone outlier rows when rows are 1 to 2 times the pixels", () => {
    // Odd rows come second in a block of two rows.
    const nrows = plotHeight() + 40;
    const rows = [101, 203, 305];
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 4, rows) },
          meta: { nrows, ncols: 4 },
        },
      }),
    );
    expect(colourRuns(el, 0.5, lit)).toBe(rows.length);
  });

  it("keeps lone outlier rows zoomed in to about 1.5 rows a pixel", () => {
    const nrows = 5000;
    const rows = [2401, 2451, 2501, 2551];
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 4, rows) },
          meta: { nrows, ncols: 4 },
        },
      }),
    );
    const h = (el.querySelector("canvas") as HTMLCanvasElement).height;
    zoom(el, (1.5 * h) / nrows);
    expect(colourRuns(el, 0.5, lit)).toBe(rows.length);
  });

  it("draws the last row when it is alone past the last full block", () => {
    // 16 rows to a pooled block at most, and one row more.
    const nrows = 16 * (Math.ceil(plotHeight() / 2) + 10) + 1;
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 4, [nrows - 1]) },
          meta: { nrows, ncols: 4 },
        },
      }),
    );
    expect(colourRuns(el, 0.5, lit)).toBe(1);
  });

  it("keeps an outlier row past the texture limit at every zoom", () => {
    const probe = document
      .createElement("canvas")
      .getContext("webgl") as WebGLRenderingContext;
    const maxTex = probe.getParameter(probe.MAX_TEXTURE_SIZE) as number;
    // Nearly twice the limit, so the base texture pools rows two by two.
    // The odd middle row is second in a block of two that starts at an even
    // row, and the zoom below stays centred on it.
    const nrows = 2 * maxTex - 1;
    const row = maxTex - 1;
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 2, [row]) },
          meta: { nrows, ncols: 2 },
        },
      }),
    );
    const seen = [colourRuns(el, 0.5, lit)];
    // Zoom in on the middle, step by step, down to a row or two in view.
    for (let i = 0; i < 6; i += 1) {
      zoom(el, Math.exp(-1.5));
      seen.push(colourRuns(el, 0.5, lit));
    }
    expect(seen).toEqual([1, 1, 1, 1, 1, 1, 1]);
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
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows, ncols } },
      }),
    );
    // Each pixel is an entry of the colour lookup table; find its level.
    const lut = buildRampLUT("viridis");
    const levelOf = new Map<number, number>();
    for (let i = 1; i < 256; i += 1) {
      const key =
        (lut[i * 4] as number) * 65536 +
        (lut[i * 4 + 1] as number) * 256 +
        (lut[i * 4 + 2] as number);
      levelOf.set(key, i);
    }
    const gl = el.querySelector("canvas") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = gl.width;
    c.height = gl.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(gl, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let ends = 0;
    let unknown = 0;
    for (let i = 0; i < d.length; i += 4) {
      const key =
        (d[i] as number) * 65536 +
        (d[i + 1] as number) * 256 +
        (d[i + 2] as number);
      const level = levelOf.get(key);
      if (level === undefined) {
        unknown += 1;
        continue;
      }
      const t = (level - 1) / 254;
      n += 1;
      if (t <= 0.05 || t >= 0.95) ends += 1;
    }
    expect(unknown).toBe(0);
    // In the data, the outer 5% at each end of the range hold 10% of the
    // cells; pooled to their means, fewer pixels reach those ends.
    expect(ends / n).toBeLessThan(0.1);
  });

  it("draws z-scores with rdbu, centred on white, when no colormap is given", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values: [1, 2, 3] }, meta: { nrows: 1, ncols: 3 } },
        options: { zScore: true },
      }),
    );
    // The middle cell has z = 0, the neutral middle of rdbu.
    expect(glPixel(el, 0.5, 0.5)).toEqual([247, 247, 247]);
    expect(lowStop(el)).toBe("#2166ac");
  });

  it("keeps an explicit colormap when z-scores are on", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values: [1, 2, 3] }, meta: { nrows: 1, ncols: 3 } },
        options: { zScore: true, colormap: "viridis" },
      }),
    );
    expect(lowStop(el)).toBe("#440154");
  });

  it("centres ltcdiv on 0, as rdbu is", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: [0, 1, 2, 3] },
          meta: { nrows: 1, ncols: 4 },
        },
        options: { colormap: "ltcdiv" },
      }),
    );
    // The 0 cell takes the cream middle of the ramp, not its teal low end.
    expect(glPixel(el, 1 / 8, 0.5)).toEqual([244, 238, 224]);
  });

  it("keeps 0 at the middle of rdbu when only vmax is set", () => {
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values: [-3, 0, 1] }, meta: { nrows: 1, ncols: 3 } },
        options: { colormap: "rdbu", vmax: 2 },
      }),
    );
    expect(glPixel(el, 0.5, 0.5)).toEqual([247, 247, 247]);
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
