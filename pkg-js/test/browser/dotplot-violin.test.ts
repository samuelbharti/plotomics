import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createDotplot } from "../../src/components/dotplot.js";
import {
  type ViolinOptions,
  createViolin,
} from "../../src/components/violin.js";
import {
  type PlotomicsData,
  type PlotomicsInstance,
  defaultTheme,
  ramp,
  textSizes,
} from "../../src/core/index.js";

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function hoverAt(el: HTMLElement, x: number, y: number): string {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

function svgTexts(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("svg text")).map(
    (t) => t.textContent ?? "",
  );
}

function pixel(el: HTMLElement, x: number, y: number): number[] {
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const ratio = canvas.width / canvas.clientWidth;
  const d = ctx.getImageData(
    Math.floor(x * ratio),
    Math.floor(y * ratio),
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

describe("dotplot with missing values", () => {
  // R sends NA and NaN as null.
  const data = {
    columns: {
      gene: ["A", "B", "A", "B"],
      cluster: ["x", "x", "y", "y"],
      pct: [80, 100, 20, 90],
      value: [1, null, 2, 3] as unknown as number[],
    },
  };

  it("renders, keeps the scale finite and draws the missing dot as a ring", () => {
    const el = container();
    instances.push(createDotplot(el, { data }));
    const texts = svgTexts(el);
    // The colour bar runs from the finite minimum to the maximum.
    expect(texts).toContain("1.0");
    expect(texts).toContain("3.0");
    expect(texts).toContain("no value");
    // B in x is the missing one: inside it is background, its rim is ink.
    // The gridline runs through its centre, so look 4 px above it.
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const b = labels.find((t) => t.textContent === "B") as SVGTextElement;
    const x = labels.find((t) => t.textContent === "x") as SVGTextElement;
    const cy = Number(b.getAttribute("y")) - 3;
    const cx = Number(x.getAttribute("x"));
    expect(pixel(el, cx, cy - 4)).toEqual([255, 255, 255]);
    // The rim of the ring carries ink: scan right from inside it.
    let rim = false;
    for (let dx = 1; dx < 30 && !rim; dx += 1) {
      const [r, g, b] = pixel(el, cx + dx, cy - 4);
      rim = !(r === 255 && g === 255 && b === 255);
    }
    expect(rim).toBe(true);
    expect(hoverAt(el, cx, cy)).toContain("mean expression NA");
  });
});

describe("dotplot with a given domain that has a missing end", () => {
  it("falls back to the data for that end and still draws", () => {
    const el = container();
    const data = {
      columns: {
        gene: ["A", "B"],
        cluster: ["x", "x"],
        pct: [80, 100],
        value: [1, 3],
      },
    };
    instances.push(
      createDotplot(el, {
        data,
        options: { valueDomain: [null, 5] as unknown as [number, number] },
      }),
    );
    // The colour bar runs from 1 to 5, labelled 1, 2, 3, 4 and 5.
    const texts = svgTexts(el);
    expect(texts).toContain("1");
    expect(texts).toContain("5");
  });
});

/** The colour bar's labels: numbers in the SVG that are not percentages. */
function barLabels(el: HTMLElement): SVGTextElement[] {
  return (
    Array.from(el.querySelectorAll("svg text")) as SVGTextElement[]
  ).filter((t) => /^-?\d+(\.\d+)?$/.test(t.textContent ?? ""));
}

/** RGB of a PNG at a point given in CSS px of a widget `cssWidth` wide. */
async function pngPixel(
  png: Blob,
  cssWidth: number,
  x: number,
  y: number,
): Promise<number[]> {
  const bitmap = await createImageBitmap(png);
  const k = bitmap.width / cssWidth;
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

/** The widget as the screen shows it, as a PNG. */
async function screenPNG(el: HTMLElement): Promise<Blob> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

const far = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));

describe("dotplot colour bar", () => {
  const four = (value: number[]) => ({
    columns: {
      gene: ["A", "B", "A", "B"],
      cluster: ["x", "x", "y", "y"],
      pct: [100, 100, 100, 100],
      value,
    },
  });

  it("labels round values with the decimals the step needs", () => {
    // Before the fix a domain of [0, 0.004] read "0.00" at both ends.
    const el = container();
    instances.push(createDotplot(el, { data: four([0, 0.001, 0.003, 0.004]) }));
    const labels = barLabels(el).map((t) => t.textContent);
    expect(labels).toEqual(["0.000", "0.001", "0.002", "0.003", "0.004"]);
  });

  it("gives every label of a bar the same decimals", () => {
    // Before the fix the bar from 0 to 3 read "3.0" and "0.00".
    const el = container();
    instances.push(
      createDotplot(el, {
        data: four([0.2, 1, 2, 2.9]),
        options: { valueDomain: [0, 3] },
      }),
    );
    const labels = barLabels(el).map((t) => t.textContent ?? "");
    expect(labels).toEqual(["0", "1", "2", "3"]);
    const decimals = labels.map((s) => s.split(".")[1]?.length ?? 0);
    expect(new Set(decimals).size).toBe(1);
  });

  it("centres each label on its value along the bar", () => {
    const el = container();
    instances.push(createDotplot(el, { data: four([1, 2, 3, 5]) }));
    const at = (s: string) =>
      Number(
        barLabels(el)
          .find((t) => t.textContent === s)
          ?.getAttribute("y"),
      );
    expect(at("3")).toBeCloseTo((at("1") + at("5")) / 2, 6);
    expect(at("2")).toBeCloseTo((3 * at("1") + at("5")) / 4, 6);
  });

  it("titles the bar mean expression when no label is given, as R and Python do", () => {
    const el = container();
    instances.push(createDotplot(el, { data: four([1, 2, 3, 4]) }));
    const texts = svgTexts(el);
    expect(texts).toContain("mean expression");
    expect(texts).not.toContain("value");
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const a = labels.find((t) => t.textContent === "A") as SVGTextElement;
    const x = labels.find((t) => t.textContent === "x") as SVGTextElement;
    const tip = hoverAt(
      el,
      Number(x.getAttribute("x")),
      Number(a.getAttribute("y")) - 3,
    );
    expect(tip).toContain("mean expression 1.00");
  });

  /** Colour of a dot of group x, 4 px above its centre, off the gridline. */
  const dotColour = (el: HTMLElement, gene: string) => {
    const labels = Array.from(
      (el.querySelector("svg") as SVGSVGElement).querySelectorAll("text"),
    );
    const at = (s: string) =>
      labels.find((t) => t.textContent === s) as SVGTextElement;
    return pixel(
      el,
      Number(at("x").getAttribute("x")),
      Number(at(gene).getAttribute("y")) - 0.35 * 11 - 4,
    );
  };
  const two = (value: number[]) => ({
    columns: {
      gene: ["A", "B"],
      cluster: ["x", "x"],
      pct: [100, 100],
      value,
    },
  });

  it("draws values too close for a round step as it draws equal values", {
    timeout: 10_000,
  }, () => {
    // The tick loop for 0.3 to 0.1 + 0.2 once never ended. After that fix
    // the bar had one label at an end, and the two dots took the two ends
    // of the ramp.
    for (const [a, b] of [
      [0.3, 0.1 + 0.2],
      // As R sends 8 and 8 + 2e-15.
      [8, 8.000000000000002],
    ] as const) {
      const near = container();
      const same = container();
      instances.push(
        createDotplot(near, { data: two([a, b]) }),
        createDotplot(same, { data: two([a, a]) }),
      );
      const placed = (el: HTMLElement) =>
        barLabels(el).map((t) => [t.textContent, t.getAttribute("y")]);
      expect(placed(near).length).toBeGreaterThan(1);
      expect(placed(near)).toEqual(placed(same));
      expect(far(dotColour(near, "A"), dotColour(near, "B"))).toBeLessThan(4);
    }
  });

  it("puts the one label of a flat domain in the middle of the bar", () => {
    // Before the fix a valueDomain of 0.3 to 0.1 + 0.2 put "0.3" at the top
    // of the bar and the two dots at the two ends of the ramp.
    const el = container();
    instances.push(
      createDotplot(el, {
        data: two([0.3, 0.1 + 0.2]),
        options: { valueDomain: [0.3, 0.1 + 0.2] },
      }),
    );
    const only = barLabels(el);
    expect(only.map((t) => t.textContent)).toEqual(["0.3"]);
    // The bar is 40 rects 10 px wide, each 0.6 px taller than its share.
    const rects = Array.from(el.querySelectorAll('svg rect[width="10"]'));
    const top = Number(rects[0]?.getAttribute("y"));
    const end = rects[rects.length - 1] as Element;
    const bottom =
      Number(end.getAttribute("y")) + Number(end.getAttribute("height")) - 0.6;
    const centre = Number(only[0]?.getAttribute("y")) - 0.35 * 11;
    expect(centre).toBeCloseTo((top + bottom) / 2, 0);
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const middle = rgb(ramp("viridis")(0.5));
    expect(far(dotColour(el, "A"), middle)).toBeLessThan(4);
    expect(far(dotColour(el, "B"), middle)).toBeLessThan(4);
  });

  it("follows a reversed domain with the labels and the dots", () => {
    // Before the fix every label sat at the middle of the bar and every
    // dot took the middle colour.
    const el = container();
    instances.push(
      createDotplot(el, {
        data: four([1, 2, 3, 5]),
        options: { valueDomain: [5, 1] },
      }),
    );
    const at = (s: string) =>
      Number(
        barLabels(el)
          .find((t) => t.textContent === s)
          ?.getAttribute("y"),
      );
    // The top of the bar is the high end of the domain, here 1.
    expect(at("1")).toBeLessThan(at("3"));
    expect(at("3")).toBeLessThan(at("5"));
    expect(at("3")).toBeCloseTo((at("1") + at("5")) / 2, 6);
    // Gene A in x has the value 1, gene B in y the value 5. Look 4 px above
    // each centre, off the gridline.
    const labels = Array.from(
      (el.querySelector("svg") as SVGSVGElement).querySelectorAll("text"),
    );
    const place = (s: string) =>
      labels.find((t) => t.textContent === s) as SVGTextElement;
    const dot = (gene: string, group: string) =>
      pixel(
        el,
        Number(place(group).getAttribute("x")),
        Number(place(gene).getAttribute("y")) - 0.35 * 11 - 4,
      );
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const paint = ramp("viridis");
    expect(far(dot("A", "x"), rgb(paint(1)))).toBeLessThan(4);
    expect(far(dot("B", "y"), rgb(paint(0)))).toBeLessThan(4);
  });
});

describe("dotplot gridlines", () => {
  const data = {
    columns: {
      gene: ["A", "B", "A", "B"],
      cluster: ["x", "x", "y", "y"],
      pct: [100, 100, 100, 100],
      value: [1, 2, 3, 4],
    },
  };

  /** Centre of the dot of gene A in group x, in CSS px. */
  function centreA(el: HTMLElement): { cx: number; cy: number } {
    const labels = Array.from(
      (el.querySelector("svg") as SVGSVGElement).querySelectorAll("text"),
    );
    const a = labels.find((t) => t.textContent === "A") as SVGTextElement;
    const x = labels.find((t) => t.textContent === "x") as SVGTextElement;
    // The row label's baseline is 0.35 of the 11 px label size below it.
    return {
      cx: Number(x.getAttribute("x")),
      cy: Number(a.getAttribute("y")) - 0.35 * 11,
    };
  }

  /**
   * Whether the gridline is drawn under the dot in `png`: the pixels across
   * the dot's centre, where the gridline runs, have the dot's colour, and
   * the gridline shows beside the dot.
   */
  async function gridUnderDot(el: HTMLElement, png: Blob) {
    const { cx, cy } = centreA(el);
    const fill = pixel(el, cx, cy - 5);
    const across = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      across.push(far(await pngPixel(png, 400, cx, cy + dy), fill));
    }
    let beside = 255;
    for (let dy = -2; dy <= 2; dy += 1) {
      const p = await pngPixel(png, 400, cx + 30, cy + dy);
      beside = Math.min(beside, far(p, [0xe5, 0xe7, 0xeb]));
    }
    return { across: Math.max(...across), beside };
  }

  it("draws the gridlines under the dots on screen and in the PNG", async () => {
    // Before the fix the gridlines were SVG lines over the canvas, so a
    // pale line crossed every dot.
    const el = container(400, 300);
    const plot = createDotplot(el, { data, options: { showLegend: false } });
    instances.push(plot);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const r = await gridUnderDot(el, png as Blob);
      expect(r.across).toBeLessThan(12);
      expect(r.beside).toBeLessThan(12);
    }
  });

  it("keeps the gridlines under the dots in the SVG export", () => {
    const el = container(400, 300);
    const plot = createDotplot(el, { data, options: { showLegend: false } });
    instances.push(plot);
    const doc = new DOMParser().parseFromString(
      plot.exportSVG?.() ?? "",
      "image/svg+xml",
    );
    const nodes = Array.from(doc.documentElement.children);
    const image = nodes.findIndex((n) => n.localName === "image");
    expect(image).toBeGreaterThanOrEqual(0);
    const gridAfter = nodes
      .slice(image + 1)
      .filter((n) => n.getAttribute("stroke") === "#e5e7eb");
    expect(gridAfter).toEqual([]);
  });

  it("draws no gridline with showGrid off", async () => {
    const el = container(400, 300);
    const plot = createDotplot(el, {
      data,
      options: { showLegend: false, showGrid: false },
    });
    instances.push(plot);
    const { cx, cy } = centreA(el);
    for (let dy = -2; dy <= 2; dy += 1) {
      expect(pixel(el, cx + 30, cy + dy)).toEqual([255, 255, 255]);
    }
  });
});

describe("violin value axis and missing medians", () => {
  const data = {
    columns: {
      feature: ["CD3E", "CD3E", "MS4A1", "MS4A1"],
      group: ["T", "B", "T", "B"],
    },
    meta: {
      grid: [0, 1, 2],
      // Each row has its own range: 0 to 10 and 0 to 2.5.
      grids: [0, 5, 10, 0, 1.25, 2.5],
      density: [0, 1, 0, 0, 0.5, 0, 0, 1, 0, 0, 0.2, 0],
      median: [5, null, 1, 1.5] as unknown as number[],
    },
  };

  it("labels each row with its own range", () => {
    const el = container();
    instances.push(createViolin(el, { data }));
    const texts = svgTexts(el);
    expect(texts).toContain("10");
    expect(texts).toContain("2.5");
    expect(texts.filter((t) => t === "0")).toHaveLength(2);
  });

  it("says no data for a missing median and does not throw", () => {
    const el = container();
    instances.push(createViolin(el, { data }));
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const row = labels.find((t) => t.textContent === "CD3E") as SVGTextElement;
    const grp = labels.find((t) => t.textContent === "B") as SVGTextElement;
    const tip = hoverAt(
      el,
      Number(grp.getAttribute("x")),
      Number(row.getAttribute("y")) - 3,
    );
    expect(tip).toContain("CD3E");
    expect(tip).toContain("no data");
  });

  it("draws no median tick for a missing median", () => {
    // A null median used to draw a background-coloured tick at value 0,
    // the bottom of the row. The bottom of B's violin must keep its colour.
    const el = container(400, 300);
    const one = {
      columns: { feature: ["CD3E", "CD3E"], group: ["T", "B"] },
      meta: {
        grid: [0, 1, 2],
        density: [1, 1, 1, 1, 1, 1],
        median: [1, null] as unknown as number[],
      },
    };
    instances.push(createViolin(el, { data: one }));
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const b = labels.find((n) => n.textContent === "B") as SVGTextElement;
    const zero = labels.find((n) => n.textContent === "0") as SVGTextElement;
    const yBot = Number(zero.getAttribute("y"));
    const xb = Number(b.getAttribute("x"));
    const inside = pixel(el, xb, yBot - 20);
    const bottom = pixel(el, xb, yBot - 1);
    for (let k = 0; k < 3; k += 1) {
      expect(
        Math.abs((bottom[k] as number) - (inside[k] as number)),
      ).toBeLessThan(30);
    }
  });

  it("keeps long axis values inside the element and thins tight rows", () => {
    const n = 100;
    const feats = Array.from({ length: n }, (_, i) => `G${i}`);
    const el = container(800, 480);
    instances.push(
      createViolin(el, {
        data: {
          columns: { feature: feats, group: feats.map(() => "T") },
          meta: {
            grid: [-0.0000456, 123456789],
            density: feats.flatMap(() => [1, 1]),
          },
        },
      }),
    );
    const axis = Array.from(el.querySelectorAll("svg text")).filter((t) =>
      /e[+-]/.test(t.textContent ?? ""),
    ) as SVGTextElement[];
    expect(axis.length).toBeGreaterThan(0);
    for (const t of axis) {
      const b = t.getBBox();
      expect(b.x + b.width).toBeLessThanOrEqual(800);
    }
    // 100 rows of 4 px: labels only on every 3rd row.
    expect(axis.length).toBeLessThanOrEqual(Math.ceil(n / 3));
  });

  it("can hide the value axis", () => {
    const el = container();
    instances.push(
      createViolin(el, { data, options: { showValueAxis: false } }),
    );
    expect(svgTexts(el)).not.toContain("10");
  });
});

describe("violin shape", () => {
  /**
   * Features by groups, by default six by five as in the violin demo of
   * pkg-js/dev. In each row one violin peaks at density 1 and the others
   * at 0.5.
   */
  function panel(nFeatures = 6, nGroups = 5): PlotomicsData {
    const feats = ["CD3D", "MS4A1", "LYZ", "COL1A1", "EPCAM", "NKG7"];
    const groups = ["T cell", "B cell", "Myeloid", "Fibroblast", "Tumour"];
    const featName = (i: number) => feats[i] ?? `GENE${i + 1}`;
    const groupName = (j: number) => groups[j] ?? `Cluster ${j + 1}`;
    const grid = Array.from({ length: 61 }, (_, k) => k / 10);
    const feature: string[] = [];
    const group: string[] = [];
    const density: number[] = [];
    for (let i = 0; i < nFeatures; i += 1) {
      const centre = 1 + (i % 5);
      for (let j = 0; j < nGroups; j += 1) {
        feature.push(featName(i));
        group.push(groupName(j));
        const peak = j === i % 5 ? 1 : 0.5;
        for (const v of grid) {
          density.push(peak * Math.exp(-((v - centre) ** 2) / (2 * 0.5 ** 2)));
        }
      }
    }
    return { columns: { feature, group }, meta: { grid, density } };
  }

  interface RowShape {
    rowH: number;
    cellW: number;
    widths: number[];
  }

  /**
   * The height of each row, the width of a column and the width in px of
   * each violin in the row. Each row's value axis runs from 2 px under
   * the top of the row to 2 px over its bottom, the band the violins are
   * drawn in; the group labels sit under the column centres.
   */
  function shapes(el: HTMLElement): RowShape[] {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const inked = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4;
      return img[i] !== 255 || img[i + 1] !== 255 || img[i + 2] !== 255;
    };
    const svg = el.querySelector("svg") as SVGSVGElement;
    const at = (n: Element, name: string) => Number(n.getAttribute(name));
    const axes = Array.from(svg.querySelectorAll("line")).filter(
      (l) => at(l, "x1") === at(l, "x2"),
    );
    const centres = Array.from(svg.querySelectorAll("text"))
      .filter((t) => (t.getAttribute("transform") ?? "").startsWith("rotate"))
      .map((t) => at(t, "x"));
    const cellW = (centres[1] as number) - (centres[0] as number);
    return axes.map((axis) => {
      const y0 = Math.floor(at(axis, "y1") * ratio);
      const y1 = Math.ceil(at(axis, "y2") * ratio);
      const widths = centres.map((cx) => {
        const x0 = Math.ceil((cx - cellW / 2) * ratio);
        const x1 = Math.floor((cx + cellW / 2) * ratio);
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            if (!inked(x, y)) continue;
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
        return hi < lo ? 0 : (hi - lo + 1) / ratio;
      });
      return { rowH: at(axis, "y2") - at(axis, "y1") + 4, cellW, widths };
    });
  }

  /**
   * Draw a violin plot and check that the widest violin of every row is
   * `want(row)` px wide, within one px of antialiasing on each side.
   */
  function expectWidest(
    width: number,
    height: number,
    data: PlotomicsData,
    options: Partial<ViolinOptions>,
    want: (row: RowShape) => number,
  ): RowShape[] {
    const el = container(width, height);
    instances.push(createViolin(el, { data, options }));
    const rows = shapes(el);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const widest = Math.max(...row.widths);
      expect(Math.abs(widest - want(row)), `widest ${widest}`).toBeLessThan(
        2.5,
      );
    }
    return rows;
  }

  it.each([
    [800, 560],
    [1440, 900],
    [1920, 560],
    [2560, 560],
  ])(
    "draws the widest violin 0.8 times as wide as its row is tall, %i x %i px",
    (width, height) => {
      // Filling 85% of its column, the widest violin here was 121 px wide
      // in an 84 px row at 800 x 560, and 229 px wide in a 140 px row at
      // 1440 x 900. A floor of 0.4 times that width outgrew the cap in
      // wide widgets: 122 px in an 84 px row at 1920 x 560.
      const rows = expectWidest(
        width,
        height,
        panel(),
        {},
        (r) => 0.8 * r.rowH,
      );
      expect(rows).toHaveLength(6);
    },
  );

  it("keeps one density scale across a row", () => {
    const el = container(1440, 900);
    instances.push(createViolin(el, { data: panel() }));
    for (const { widths } of shapes(el)) {
      const widest = Math.max(...widths);
      // Half the density of the widest violin, half its width.
      const rest = widths.filter((w) => w !== widest);
      expect(rest).toHaveLength(4);
      for (const w of rest) {
        expect(Math.abs(w - widest / 2)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("fills violinWidth of a column narrower than the cap", () => {
    // 20 groups at 800 px: columns of about 34 px, rows of about 88 px.
    const rows = expectWidest(
      800,
      560,
      panel(6, 20),
      {},
      (r) => 0.85 * r.cellW,
    );
    for (const r of rows) expect(0.85 * r.cellW).toBeLessThan(0.8 * r.rowH);
  });

  it("takes violinWidth when it is under the cap", () => {
    const rows = expectWidest(
      800,
      560,
      panel(),
      { violinWidth: 0.3 },
      (r) => 0.3 * r.cellW,
    );
    for (const r of rows) expect(0.3 * r.cellW).toBeLessThan(0.8 * r.rowH);
  });

  it("never caps a violin under four times the label size", () => {
    // 20 features at 1440 x 560: rows of about 25 px, so the cap of 0.8
    // times the row is under the floor of 4 x 11 = 44 px.
    const rows = expectWidest(1440, 560, panel(20, 5), {}, () => 44);
    expect(rows).toHaveLength(20);
    for (const r of rows) expect(0.8 * r.rowH).toBeLessThan(44 - 5);
  });

  it("grows the floor with the label size", () => {
    const theme = { fontSize: 16 };
    const floor = 4 * textSizes({ ...defaultTheme, ...theme }).label;
    const rows = expectWidest(800, 560, panel(20, 5), { theme }, () => floor);
    for (const r of rows) expect(0.8 * r.rowH).toBeLessThan(floor - 5);
  });

  it("keeps the floor within violinWidth of a narrow column", () => {
    // 20 features by 20 groups: columns of about 33 px.
    const rows = expectWidest(
      800,
      560,
      panel(20, 20),
      {},
      (r) => 0.85 * r.cellW,
    );
    for (const r of rows) expect(0.85 * r.cellW).toBeLessThan(44 - 5);
  });

  it("takes the cap from violinAspect", () => {
    expectWidest(800, 560, panel(), { violinAspect: 1.2 }, (r) => 1.2 * r.rowH);
  });

  it.each([
    ["null", null],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("turns the cap off with violinAspect %s", (_, violinAspect) => {
    expectWidest(800, 560, panel(), { violinAspect }, (r) => 0.85 * r.cellW);
  });

  it("goes back to the default cap when violinAspect is unset", () => {
    const el = container(800, 560);
    const plot = createViolin(el, {
      data: panel(),
      options: { violinAspect: null },
    });
    instances.push(plot);
    plot.setOptions({ violinAspect: undefined });
    const rows = shapes(el);
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(Math.abs(Math.max(...r.widths) - 0.8 * r.rowH)).toBeLessThan(2.5);
    }
  });
});
