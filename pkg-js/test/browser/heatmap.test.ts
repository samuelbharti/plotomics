import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import { type PlotomicsInstance, ramp } from "../../src/core/index.js";

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
