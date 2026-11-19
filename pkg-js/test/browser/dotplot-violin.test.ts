import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createDotplot } from "../../src/components/dotplot.js";
import { createViolin } from "../../src/components/violin.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

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
