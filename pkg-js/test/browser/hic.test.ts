import { afterEach, describe, expect, it } from "vitest";
import {
  colormapLUT,
  createHic,
  cssColorToUnitRGB,
} from "../../src/components/hic.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { canvasPNG, drawnPixels } from "./helpers.js";

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

    const png = await canvasPNG(el);
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

    const png = (await canvasPNG(el)) as Blob;
    // Before the fix, every value at or below 0 was drawn as background.
    // The plot square is 318 px inside the default theme padding.
    expect(await drawnPixels(png)).toBeGreaterThan(318 * 318 * 0.9);
  });
});

/**
 * The colours down the column of the map at `fx` of its width, top to
 * bottom, one per device pixel row, as [r, g, b], and where each row sits as
 * a fraction of the map's height.
 */
async function mapColumn(el: HTMLElement, fx: number) {
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const frame = (
    el.querySelector('svg rect[fill="none"]') as SVGRectElement
  ).getBoundingClientRect();
  const box = canvas.getBoundingClientRect();
  const ratio = canvas.width / box.width;
  const bitmap = await createImageBitmap(canvas);
  const copy = document.createElement("canvas");
  copy.width = bitmap.width;
  copy.height = bitmap.height;
  const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  const x = Math.round((frame.left - box.left + frame.width * fx) * ratio);
  // One device pixel in from the frame on both ends.
  const y0 = Math.ceil((frame.top - box.top) * ratio) + 1;
  const y1 = Math.floor((frame.bottom - box.top) * ratio) - 1;
  const px = ctx.getImageData(x, y0, 1, y1 - y0).data;
  const colours: [number, number, number][] = [];
  for (let k = 0; k < px.length; k += 4) {
    colours.push([px[k] as number, px[k + 1] as number, px[k + 2] as number]);
  }
  const fraction = (row: number) =>
    ((y0 + row + 0.5) / ratio - (frame.top - box.top)) / frame.height;
  return { colours, fraction, pixel: 1 / (frame.height * ratio) };
}

const near = (a: number[], b: number[]) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) <= 3);

describe("hic missing bins", () => {
  /** 1000 bins of 100 contacts, with bins 500 to 500 + k - 1 missing. */
  function missingRows(k: number) {
    const n = 1000;
    const values: (number | null)[] = new Array(n * n).fill(100);
    for (let b = 500; b < 500 + k; b += 1) {
      for (let c = 0; c < n; c += 1) {
        values[b * n + c] = null; // R sends NA as null
        values[c * n + b] = null;
      }
    }
    return { columns: { values: values as number[] }, meta: { n } };
  }

  const lut = colormapLUT("viridis");
  // Every cell holds 100, the top of the scale.
  const top = [lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]] as number[];
  const white = [255, 255, 255];

  /** Wheel the map in about its centre `steps` times. */
  function zoomIn(el: HTMLElement, steps: number) {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const frame = (
      el.querySelector('svg rect[fill="none"]') as SVGRectElement
    ).getBoundingClientRect();
    for (let s = 0; s < steps; s += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          clientX: frame.left + frame.width / 2,
          clientY: frame.top + frame.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }

  it("draws no colour of the scale for a missing bin in the overview", async () => {
    const el = container(460, 460);
    instances.push(createHic(el, { data: missingRows(2) }));
    const { colours } = await mapColumn(el, 0.25);
    // Each pixel is a cell of 100 or the background, never a blend of the
    // two that reads as a smaller value.
    const other = colours.filter((c) => !near(c, top) && !near(c, white));
    expect(other).toEqual([]);
  });

  it("draws missing bins as background at every zoom", async () => {
    const el = container(460, 460);
    instances.push(createHic(el, { data: missingRows(6) }));
    for (let zoom = 0; zoom <= 20; zoom += 4) {
      if (zoom > 0) zoomIn(el, 4);
      const { colours, fraction, pixel } = await mapColumn(el, 0.25);
      const other = colours.filter((c) => !near(c, top) && !near(c, white));
      expect(other, `zoom step ${zoom}`).toEqual([]);
      // The view stays centred on bin 500, so the missing bins 500 to 505
      // run down from the middle of the map. Some rows there are background,
      // and no row anywhere else is.
      const span = 1000 / 1.15 ** zoom;
      const from = 0.5;
      const to = 0.5 + 6 / span;
      const blank = colours
        .map((c, i) => (near(c, white) ? fraction(i) : -1))
        .filter((f) => f >= 0);
      expect(blank.length, `zoom step ${zoom}`).toBeGreaterThan(0);
      for (const f of blank) {
        expect(f, `zoom step ${zoom}`).toBeGreaterThan(from - 2 * pixel);
        expect(f, `zoom step ${zoom}`).toBeLessThan(to + 2 * pixel);
      }
    }
  });
});

describe("hic axis text in narrow widgets", () => {
  /** 200 bins of 250 kb on chr1, 50 Mb in all. */
  const genome = {
    columns: { values: decay(200) },
    meta: { n: 200, binSize: 250_000, chrom: "chr1" },
  };

  const leftLabels = (el: HTMLElement) =>
    Array.from(
      el.querySelectorAll('svg text[text-anchor="end"]'),
    ) as SVGTextElement[];

  for (const fontSize of [12, 16]) {
    it(`writes each left tick label whole with its unit at font size ${fontSize}`, () => {
      for (let w = 300; w <= 700; w += 20) {
        const el = container(w, 480);
        const hic = createHic(el, {
          data: genome,
          options: { theme: { fontSize } },
        });
        const labels = leftLabels(el);
        expect(labels.length, `${w} px`).toBeGreaterThan(1);
        const box = el.getBoundingClientRect();
        for (const t of labels) {
          // "12.5Mb", not "12.5..." cut to fit a margin made for "10Mb".
          expect(t.textContent, `${w} px`).toMatch(/^(0|\d+(\.\d+)?(Mb|kb))$/);
          expect(t.getBoundingClientRect().left, `${w} px`).toBeGreaterThan(
            box.left,
          );
        }
        hic.destroy();
        el.remove();
      }
    });
  }

  it("keeps a long axis title clear of the other titles and labels", () => {
    const label = "chr1, GM12878 in situ, KR balanced";
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    for (const [w, h] of [
      [400, 480],
      [300, 480],
      [300, 700],
      [360, 600],
      [500, 900],
      [800, 480],
      [600, 300],
    ] as const) {
      for (const fontSize of [12, 16]) {
        const el = container(w, h);
        const hic = createHic(el, {
          data: genome,
          options: { label, theme: { fontSize } },
        });
        const texts = Array.from(el.querySelectorAll("svg text")).filter(
          (t) => t.textContent,
        );
        const titles = texts.filter((t) =>
          /^(chr1|contacts)/.test(t.textContent ?? ""),
        );
        expect(titles.length).toBeGreaterThan(0);
        for (const a of titles) {
          for (const b of texts) {
            if (a === b) continue;
            expect(
              overlap(a.getBoundingClientRect(), b.getBoundingClientRect()),
              `${w} x ${h}, font ${fontSize}: "${a.textContent}" and "${b.textContent}"`,
            ).toBe(false);
          }
        }
        hic.destroy();
        el.remove();
      }
    }
  });
});

describe("hic cells with no contacts", () => {
  /** A seeded random number in [0, 1). */
  function seeded(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Raw counts: a symmetric map of Poisson draws with a mean of
   * scale / (d + 1)^1.1 at d bins from the diagonal, so far contacts are
   * mostly zero.
   */
  function rawCounts(n: number, scale: number, seed: number) {
    const rand = seeded(seed);
    const poisson = (mean: number) => {
      if (mean > 30) {
        // Normal approximation for a large mean.
        const u = Math.max(rand(), 1e-12);
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
        return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
      }
      const floor = Math.exp(-mean);
      let k = 0;
      for (let p = rand(); p > floor; p *= rand()) k += 1;
      return k;
    };
    const values = new Float32Array(n * n);
    for (let r = 0; r < n; r += 1) {
      for (let c = r; c < n; c += 1) {
        const v = poisson(scale / (c - r + 1) ** 1.1);
        values[r * n + c] = v;
        values[c * n + r] = v;
      }
    }
    return { columns: { values }, meta: { n } };
  }

  /** The share of the map's pixels that are background, and their mean grey. */
  async function mapStats(el: HTMLElement) {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const frame = (
      el.querySelector('svg rect[fill="none"]') as SVGRectElement
    ).getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / box.width;
    const bitmap = await createImageBitmap(canvas);
    const copy = document.createElement("canvas");
    copy.width = bitmap.width;
    copy.height = bitmap.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    const x0 = Math.ceil((frame.left - box.left) * ratio) + 1;
    const y0 = Math.ceil((frame.top - box.top) * ratio) + 1;
    const x1 = Math.floor((frame.right - box.left) * ratio) - 1;
    const y1 = Math.floor((frame.bottom - box.top) * ratio) - 1;
    const px = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let blank = 0;
    let grey = 0;
    for (let k = 0; k < px.length; k += 4) {
      const [r, g, b] = [px[k], px[k + 1], px[k + 2]] as number[];
      if (r === 255 && g === 255 && b === 255) blank += 1;
      grey += ((r as number) + (g as number) + (b as number)) / 3;
    }
    const count = px.length / 4;
    return { blank: blank / count, grey: grey / count };
  }

  // A cell with no contacts is background, as a missing one is, but in the
  // overview it is blended into its neighbours as the value under the scale.
  // Drawn as missing, it took the whole pixel it fell on: far contacts
  // shrank to specks and single zeros near the diagonal turned to white
  // specks. The bounds hold the overview with zeros blended in (58.1%
  // background and a mean grey of 174.5; then 0.05% background) and leave
  // out the overview that drew zeros as missing (82.1% and 223.4; then 3.1%).
  it("dims the far contacts of raw counts, not blanks them", async () => {
    const el = container(700, 700);
    instances.push(createHic(el, { data: rawCounts(2000, 30, 1) }));
    const { blank, grey } = await mapStats(el);
    expect(blank).toBeGreaterThan(0.5);
    expect(blank).toBeLessThan(0.66);
    expect(grey).toBeGreaterThan(165);
    expect(grey).toBeLessThan(185);
  });

  it("draws no white specks for single zeros near the diagonal", async () => {
    const el = container(700, 700);
    instances.push(createHic(el, { data: rawCounts(800, 2000, 2) }));
    const { blank } = await mapStats(el);
    expect(blank).toBeLessThan(0.002);
  });
});

describe("hic axis units", () => {
  // Before the fix each label picked its own unit, so one axis read
  // "800kb, 1.0Mb". Each axis now labels every tick in one unit.
  const unitOf = (s: string) => /(Mb|kb)$/.exec(s)?.[1] ?? "";

  it("labels every tick of an axis in one unit", () => {
    for (const [n, binSize, w] of [
      [200, 10_000, 800],
      [200, 10_000, 400],
      [100, 5_000, 800],
      [300, 50_000, 800],
      [150, 1_000, 800],
      [64, 1_000_000, 600],
    ] as const) {
      const el = container(w, 480);
      const hic = createHic(el, {
        data: { columns: { values: decay(n) }, meta: { n, binSize } },
      });
      const bottom = xTicks(el);
      const left = Array.from(
        el.querySelectorAll('svg text[text-anchor="end"]'),
      )
        .map((t) => t.textContent ?? "")
        .filter((s) => s !== "");
      for (const labels of [bottom, left]) {
        const where = `${n} bins of ${binSize} bp at ${w} px: ${labels.join(", ")}`;
        expect(labels.length, where).toBeGreaterThan(1);
        const units = new Set(labels.filter((s) => s !== "0").map(unitOf));
        expect(units.size, where).toBe(1);
        // Exact: the labels step evenly in their unit.
        const values = labels.map((s) => Number.parseFloat(s));
        const steps = new Set(
          values.slice(1).map((v, i) => (v - (values[i] as number)).toFixed(6)),
        );
        expect(steps.size, where).toBe(1);
      }
      // The left axis states the same ticks, top to bottom.
      expect(left).toEqual(bottom);
      hic.destroy();
      el.remove();
    }
  });
});

describe("hic colour bar labels", () => {
  /** The colour bar labels, top to bottom, with their boxes. */
  const barLabels = (el: HTMLElement) =>
    (
      Array.from(
        el.querySelectorAll('svg text[text-anchor="start"]'),
      ) as SVGTextElement[]
    )
      .filter((t) => t.textContent)
      .sort(
        (a, b) => Number(a.getAttribute("y")) - Number(b.getAttribute("y")),
      );
  /** A label as the value it states: "5k" is 5000. */
  const valueStated = (s: string) =>
    Number.parseFloat(s) * (s.endsWith("M") ? 1e6 : s.endsWith("k") ? 1e3 : 1);

  for (const transform of ["linear", "log"] as const) {
    for (const [vmin, vmax] of [
      [5, 12_345.6],
      [5, 6_565.99],
      [0, 12_345.6],
      [0, 0.05],
      [0, 7],
    ] as const) {
      it(`labels round values in one format, ${transform} from ${vmin} to ${vmax}`, () => {
        for (const [w, h, fontSize] of [
          [600, 480, 12],
          [300, 240, 16],
        ] as const) {
          const el = container(w, h);
          const hic = createHic(el, {
            data: {
              columns: { values: decay(64) },
              meta: { n: 64, binSize: 10_000 },
            },
            options: { transform, vmin, vmax, theme: { fontSize } },
          });
          const labels = barLabels(el);
          const texts = labels.map((t) => t.textContent ?? "");
          const where = `${w} x ${h}: ${texts.join(", ")}`;
          expect(labels.length, where).toBeGreaterThan(0);
          // Before the fix: "1.2e+4" over "5", or "6565.99" over "5".
          for (const s of texts) {
            expect(s, where).toMatch(/^-?\d+(\.\d+)?[kM]?$/);
          }
          const units = new Set(
            texts
              .filter((s) => s !== "0")
              .map((s) => s.slice(-1))
              .filter((u) => u === "k" || u === "M"),
          );
          expect(units.size, where).toBeLessThanOrEqual(1);
          const decimals = new Set(
            texts
              .filter((s) => s !== "0")
              .map((s) => /\.(\d+)/.exec(s)?.[1]?.length ?? 0),
          );
          expect(decimals.size, where).toBeLessThanOrEqual(1);
          // Inside the scale, the high values at the top.
          const values = texts.map(valueStated);
          const lo = transform === "log" ? Math.max(0, vmin) : vmin;
          for (const v of values) {
            expect(v, where).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(v, where).toBeLessThanOrEqual(vmax + 1e-9);
          }
          for (let i = 1; i < values.length; i += 1) {
            expect(values[i] as number, where).toBeLessThan(
              values[i - 1] as number,
            );
          }
          // Inside the widget and clear of each other.
          const box = el.getBoundingClientRect();
          const rects = labels.map((t) => t.getBoundingClientRect());
          for (const r of rects) {
            expect(r.right, where).toBeLessThanOrEqual(box.right + 0.5);
          }
          for (let i = 1; i < rects.length; i += 1) {
            expect(rects[i]?.top as number, where).toBeGreaterThanOrEqual(
              (rects[i - 1]?.bottom as number) - 0.5,
            );
          }
          hic.destroy();
          el.remove();
        }
      });
    }
  }

  it("labels a log bar at powers of ten from 0", () => {
    const el = container(600, 480);
    instances.push(
      createHic(el, {
        data: {
          columns: { values: decay(64) },
          meta: { n: 64, binSize: 10_000 },
        },
        options: { transform: "log", vmin: 0, vmax: 12_345.6 },
      }),
    );
    expect(barLabels(el).map((t) => t.textContent)).toEqual([
      "10000",
      "1000",
      "100",
      "10",
      "1",
      "0",
    ]);
  });
});
