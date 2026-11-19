import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRampLUT, createHeatmap } from "../../src/components/heatmap.js";
import { type PlotomicsInstance, ramp } from "../../src/core/index.js";
import { poolBlocks } from "../../src/core/pool.js";

// Count the poolings; the real pooling still runs.
vi.mock("../../src/core/pool.js", { spy: true });

/** Wait for the view to rest after a wheel or a drag. */
function rest(): Promise<void> {
  return new Promise((done) => setTimeout(done, 300));
}

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

/** The colours down the middle column of the plot canvas, as "r,g,b". */
function columnColours(el: HTMLElement): string[] {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const c = document.createElement("canvas");
  c.width = gl.width;
  c.height = gl.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(gl, 0, 0);
  const d = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
  return Array.from(
    { length: c.height },
    (_, y) => `${d[y * 4]},${d[y * 4 + 1]},${d[y * 4 + 2]}`,
  );
}

/** The level of the viridis lookup table that draws `colour` ("r,g,b"). */
function levelOf(colour: string): number {
  const lut = buildRampLUT("viridis");
  for (let i = 0; i < 256; i += 1) {
    if (colour === `${lut[i * 4]},${lut[i * 4 + 1]},${lut[i * 4 + 2]}`) {
      return i;
    }
  }
  return -1;
}

/** How often the colour changes from one pixel to the next. */
function changes(colours: string[]): number {
  let n = 0;
  for (let i = 1; i < colours.length; i += 1) {
    if (colours[i] !== colours[i - 1]) n += 1;
  }
  return n;
}

/** The row the tooltip names at device pixel row `y` of the plot canvas. */
function rowAt(el: HTMLElement, y: number): number {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  const r = gl.getBoundingClientRect();
  const k = r.height / gl.height;
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + r.width / 2,
      clientY: r.top + (y + 0.5) * k,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return Number(/row (\d+)/.exec(tip?.textContent ?? "")?.[1] ?? -1);
}

/** Zoom in on `row`, as the tooltip finds it, until `rows` or fewer show. */
function zoomOnRow(el: HTMLElement, row: number, rows: number) {
  const gl = el.querySelector("canvas") as HTMLCanvasElement;
  for (let i = 0; i < 12; i += 1) {
    const inView = rowAt(el, gl.height - 1) - rowAt(el, 0) + 1;
    if (inView <= rows) return;
    let y = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let yy = 0; yy < gl.height && best > 0; yy += 1) {
      const d = Math.abs(rowAt(el, yy) - row);
      if (d < best) {
        best = d;
        y = yy;
      }
    }
    const r = gl.getBoundingClientRect();
    gl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: Math.log(Math.max(rows / inView, 0.1)) * 1000,
        clientX: r.left + r.width / 2,
        clientY: r.top + ((y + 0.5) * r.height) / gl.height,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/** The GPU's texture limit in this browser. */
function textureLimit(): number {
  const gl = document
    .createElement("canvas")
    .getContext("webgl") as WebGLRenderingContext;
  return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
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

  it("keeps lone outlier rows when rows outnumber the plot's pixels", async () => {
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
    await rest();
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

  it("keeps lone outlier rows zoomed in to about 1.5 rows a pixel", async () => {
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
    await rest();
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

  it("keeps an outlier row past the texture limit at every zoom", async () => {
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
      // While the view moves and once it rests.
      seen.push(colourRuns(el, 0.5, lit));
      await rest();
      seen.push(colourRuns(el, 0.5, lit));
    }
    expect(seen).toEqual(Array(13).fill(1));
  });

  it("keeps alternating rows distinct when rows are 1 to 2 times the pixels", () => {
    const h = plotHeight();
    const nrows = h + 1;
    for (const period of [2, 4]) {
      // Rows 0, 1, 0, 1, ... and 0, 1, 2, 3, 0, 1, ...
      const values = new Float32Array(nrows * 4);
      for (let r = 0; r < nrows; r += 1) {
        values.fill(r % period, r * 4, (r + 1) * 4);
      }
      const el = container();
      instances.push(
        createHeatmap(el, {
          data: { columns: { values }, meta: { nrows, ncols: 4 } },
        }),
      );
      // Pooled to one texel a pixel, nearly every row keeps a pixel of its
      // own; halving the rows would draw one flat colour.
      const colours = columnColours(el);
      expect(changes(colours), `period ${period}`).toBeGreaterThan(0.9 * h);
      expect(new Set(colours).size, `period ${period}`).toBeGreaterThanOrEqual(
        period,
      );
    }
  });

  it("draws a lone outlier row at the strength its pixel allows", () => {
    // 5000 rows in about 420 px: 11 or 12 rows to a pixel, so the outlier
    // pixel is at least a twelfth of the way up the ramp.
    const nrows = 5000;
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 4, [2500]) },
          meta: { nrows, ncols: 4 },
        },
      }),
    );
    const top = Math.max(...columnColours(el).map((c) => levelOf(c)));
    expect(top).toBeGreaterThanOrEqual(1 + Math.round(254 / 12));
  });

  it("draws a row past the texture limit where the tooltip names it", async () => {
    const maxTex = textureLimit();
    // Rows pool two by two to fit the limit; this row is alone in an even
    // split of the rows, whose texels would sit up to a row away from it.
    const nrows = maxTex + 100;
    let row = -1;
    let off = -1;
    for (let i = (maxTex >> 1) - 200; i < (maxTex >> 1) + 200; i += 1) {
      const r0 = Math.floor((i * nrows) / maxTex);
      const r1 = Math.floor(((i + 1) * nrows) / maxTex);
      if (r1 - r0 === 1 && (i * nrows) / maxTex - r0 > off) {
        off = (i * nrows) / maxTex - r0;
        row = r0;
      }
    }
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: withRows(nrows, 2, [row]) },
          meta: { nrows, ncols: 2 },
        },
      }),
    );
    zoomOnRow(el, row, 8);
    await rest();
    const colours = columnColours(el);
    // The pixels of each row in view, as the tooltip names them.
    const spans = new Map<number, number[]>();
    colours.forEach((_, y) => {
      const at = rowAt(el, y);
      spans.set(at, [...(spans.get(at) ?? []), y]);
    });
    // The texel holding the row covers it and its partner in the block of
    // two, and nothing else: the centre pixel of each row whole in view is
    // lit exactly when the row is in that block. The edges of a texel in a
    // texture this tall can land a few pixels off in the browser's
    // renderer, with or without pooling, so they are not checked.
    const block = [row - (row % 2), row - (row % 2) + 1];
    let checked = 0;
    for (const [at, ys] of spans) {
      if (ys.includes(0) || ys.includes(colours.length - 1)) continue;
      const centre = colours[ys[Math.floor(ys.length / 2)] as number] as string;
      expect(lit(centre.split(",").map(Number)), `row ${at}`).toBe(
        block.includes(at),
      );
      checked += 1;
    }
    expect(spans.get(row)?.length ?? 0).toBeGreaterThan(20);
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it("never draws a row past the texture limit as its neighbour", async () => {
    const maxTex = textureLimit();
    const nrows = maxTex + 100;
    // Rows 0, 1, 0, 1, ...: each block of two holds a 0 and a 1.
    const values = new Float32Array(nrows * 2);
    for (let r = 0; r < nrows; r += 1) values.fill(r % 2, r * 2, (r + 1) * 2);
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows, ncols: 2 } },
      }),
    );
    zoomOnRow(el, Math.floor((nrows * 3) / 4), 8);
    await rest();
    const colours = columnColours(el);
    // The colour of the other value, at either end of the ramp.
    const lut = buildRampLUT("viridis");
    const end = (v: number) => {
      const i = 1 + Math.round(v * 254);
      return `${lut[i * 4]},${lut[i * 4 + 1]},${lut[i * 4 + 2]}`;
    };
    let wrong = 0;
    colours.forEach((c, y) => {
      if (c === end(1 - (rowAt(el, y) % 2))) wrong += 1;
    });
    expect(wrong).toBe(0);
  });

  it("pools no texture while the wheel turns, and the view once it rests", async () => {
    // Rows 1, 0, 1, 0, ...
    const nrows = 5000;
    const ncols = 20;
    const values = new Float32Array(nrows * ncols);
    for (let r = 0; r < nrows; r += 2)
      values.fill(1, r * ncols, (r + 1) * ncols);
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: { columns: { values }, meta: { nrows, ncols } },
      }),
    );
    const h = (el.querySelector("canvas") as HTMLCanvasElement).height;
    const pools = vi.mocked(poolBlocks);
    pools.mockClear();
    // Twenty wheel steps in, each to a new pooled size, as fast as a wheel
    // sends them: each step draws from a texture already built.
    for (let i = 0; i < 20; i += 1) zoom(el, Math.exp(-0.1));
    expect(pools).not.toHaveBeenCalled();
    // Once the view rests, its own texture is pooled, once, and draws the
    // rows at about a texel a pixel.
    await rest();
    expect(pools).toHaveBeenCalledTimes(1);
    expect(changes(columnColours(el))).toBeGreaterThan(0.5 * h);
    // Back out to the whole matrix, whose texture is kept.
    pools.mockClear();
    for (let i = 0; i < 20; i += 1) zoom(el, Math.exp(0.1));
    await rest();
    expect(pools).not.toHaveBeenCalled();
  });

  it("draws a flat matrix in the middle colour, however large its value", () => {
    // Past 2 ** 52, widening the flat domain by 0.5 did not move its ends,
    // and every cell took the lowest colour.
    const lut = buildRampLUT("viridis");
    const middle = [lut[128 * 4], lut[128 * 4 + 1], lut[128 * 4 + 2]];
    for (const v of [2e12, -7e15]) {
      const el = container();
      instances.push(
        createHeatmap(el, {
          data: {
            columns: { values: [v, v, v, v] },
            meta: { nrows: 2, ncols: 2 },
          },
        }),
      );
      expect(glPixel(el, 0.25, 0.25), String(v)).toEqual(middle);
      // The colour bar keeps one label, at its middle.
      const labels = svgTexts(el).filter(
        (t) => t.getAttribute("text-anchor") === "start",
      );
      expect(labels, String(v)).toHaveLength(1);
    }
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

describe("heatmap colour bar", () => {
  // A 2 x 2 matrix over -1.75 to 4.6, as in the dev demo of issue #101.
  const data = {
    columns: { values: [4.6, -1.75, 0.5, 2] },
    meta: { nrows: 2, ncols: 2 },
  };
  /** The colour bar's tick labels: the start-anchored texts. */
  const ticks = (el: HTMLElement) =>
    svgTexts(el).filter((t) => t.getAttribute("text-anchor") === "start");

  it("labels round values inside the colour range, each at its value", () => {
    // Before the fix the bar read the raw ends and middle: 4.6, 1.43, -1.75.
    const el = container();
    instances.push(createHeatmap(el, { data }));
    expect(ticks(el).map((t) => t.textContent)).toEqual(["0", "2", "4"]);
    const y = (s: string) =>
      Number(
        ticks(el)
          .find((t) => t.textContent === s)
          ?.getAttribute("y"),
      );
    expect(y("2")).toBeCloseTo((y("0") + y("4")) / 2, 6);
    expect(y("4")).toBeLessThan(y("0"));
  });

  it("widens a colour range too narrow for a round step, as for vmin = vmax", {
    timeout: 10_000,
  }, () => {
    // The tick loop for 0.3 to 0.1 + 0.2 once never ended. After that fix
    // the bar had one label, "0.3", at its top.
    const near = container();
    const same = container();
    instances.push(
      createHeatmap(near, { data, options: { vmin: 0.3, vmax: 0.1 + 0.2 } }),
      createHeatmap(same, { data, options: { vmin: 0.3, vmax: 0.3 } }),
    );
    const placed = (el: HTMLElement) =>
      ticks(el).map((t) => [t.textContent, t.getAttribute("y")]);
    expect(placed(near).length).toBeGreaterThan(1);
    expect(placed(near)).toEqual(placed(same));
  });

  it("colours cells at clamps that differ only in their last digits with the middle of the ramp", () => {
    // Before the fix the clamps 0.3 and 0.1 + 0.2 kept the colour domain
    // that narrow, and a cell of 0.3 took an end of the ramp. The values
    // reach the GPU as float32, so values alone cannot be this close.
    const el = container();
    instances.push(
      createHeatmap(el, {
        data: {
          columns: { values: [0.3, 0.3, 0.3, 0.3] },
          meta: { nrows: 2, ncols: 2 },
        },
        options: { vmin: 0.3, vmax: 0.1 + 0.2 },
      }),
    );
    const middle = [1, 3, 5].map((i) =>
      Number.parseInt(ramp("viridis")(0.5).slice(i, i + 2), 16),
    );
    for (const [fx, fy] of [
      [0.25, 0.25],
      [0.75, 0.25],
    ]) {
      const p = glPixel(el, fx as number, fy as number);
      const far = Math.max(...p.map((v, i) => Math.abs(v - (middle[i] ?? 0))));
      expect(far).toBeLessThan(3);
    }
  });

  // Values 0 to 6, with clamps that reverse the colour domain.
  const zeroToSix = {
    columns: { values: [0, 1, 2, 3, 4, 5, 6, 3] },
    meta: { nrows: 2, ncols: 4 },
  };
  for (const [what, options, top, bottom] of [
    ["vmin 5 and vmax 1", { vmin: 5, vmax: 1 }, 1, 5],
    ["only vmin 7, above the data", { vmin: 7 }, 6, 7],
    ["only vmax -1, below the data", { vmax: -1 }, -1, 0],
  ] as const) {
    it(`places each label at its value on a reversed domain: ${what}`, () => {
      // Before the fix every label sat at the middle of the bar.
      const el = container();
      instances.push(createHeatmap(el, { data: zeroToSix, options }));
      const placed = ticks(el)
        .map((t) => ({
          v: Number(t.textContent),
          y: Number(t.getAttribute("y")),
        }))
        .sort((a, b) => a.y - b.y);
      expect(placed.length).toBeGreaterThan(1);
      expect(new Set(placed.map((p) => p.y)).size).toBe(placed.length);
      // The top of the bar is vmax, the bottom vmin.
      expect(placed[0]?.v).toBe(top);
      expect(placed[placed.length - 1]?.v).toBe(bottom);
    });
  }

  it("titles the bar with legendTitle, and by the default otherwise", () => {
    const el = container();
    const plot = createHeatmap(el, { data });
    instances.push(plot);
    const titles = () =>
      svgTexts(el)
        .filter((t) => t.getAttribute("text-anchor") === "middle")
        .map((t) => t.textContent);
    expect(titles()).toEqual(["value"]);
    plot.setOptions({ zScore: true });
    expect(titles()).toEqual(["z-score"]);
    // Before the fix there was no option for it.
    plot.setOptions({ legendTitle: "log2 expression" });
    expect(titles()).toEqual(["log2 expression"]);
    // A title wider than the bar stays off the matrix and inside the widget.
    const title = svgTexts(el).find(
      (t) => t.textContent === "log2 expression",
    ) as SVGTextElement;
    const matrix = (
      el.querySelector("canvas") as HTMLCanvasElement
    ).getBoundingClientRect().right;
    expect(title.getBoundingClientRect().left).toBeGreaterThanOrEqual(matrix);
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.getBoundingClientRect().right,
    );
    // R drops a NULL title and Python sends None: both give the default.
    plot.setOptions({ legendTitle: null });
    expect(titles()).toEqual(["z-score"]);
  });
});
