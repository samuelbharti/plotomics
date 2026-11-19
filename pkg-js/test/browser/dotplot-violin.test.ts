import { afterEach, describe, expect, it } from "vitest";
import { createDotplot } from "../../src/components/dotplot.js";
import { createViolin } from "../../src/components/violin.js";
import type { PlotomicsData, PlotomicsInstance } from "../../src/core/index.js";

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
    // B in x is the missing one: its centre is background, its rim is ink.
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const b = labels.find((t) => t.textContent === "B") as SVGTextElement;
    const x = labels.find((t) => t.textContent === "x") as SVGTextElement;
    const cy = Number(b.getAttribute("y")) - 3;
    const cx = Number(x.getAttribute("x"));
    expect(pixel(el, cx, cy)).toEqual([255, 255, 255]);
    // The rim of the ring carries ink: scan right from the centre.
    let rim = false;
    for (let dx = 1; dx < 30 && !rim; dx += 1) {
      const [r, g, b] = pixel(el, cx + dx, cy);
      rim = !(r === 255 && g === 255 && b === 255);
    }
    expect(rim).toBe(true);
    expect(hoverAt(el, cx, cy)).toContain("value NA");
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
    const texts = svgTexts(el);
    expect(texts).toContain("1.0");
    expect(texts).toContain("5.0");
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
   * Six features by five groups, as in the violin demo of pkg-js/dev. In
   * each row one violin peaks at density 1 and the other four at 0.5.
   */
  function panel(): PlotomicsData {
    const feats = ["CD3D", "MS4A1", "LYZ", "COL1A1", "EPCAM", "NKG7"];
    const groups = ["T cell", "B cell", "Myeloid", "Fibroblast", "Tumour"];
    const grid = Array.from({ length: 61 }, (_, k) => k / 10);
    const feature: string[] = [];
    const group: string[] = [];
    const density: number[] = [];
    for (let i = 0; i < feats.length; i += 1) {
      const centre = 1 + (i % 5);
      for (let j = 0; j < groups.length; j += 1) {
        feature.push(feats[i] as string);
        group.push(groups[j] as string);
        const peak = j === i % 5 ? 1 : 0.5;
        for (const v of grid) {
          density.push(peak * Math.exp(-((v - centre) ** 2) / (2 * 0.5 ** 2)));
        }
      }
    }
    return { columns: { feature, group }, meta: { grid, density } };
  }

  /**
   * The height of each row and the width in px of each violin in it. Each
   * row's value axis runs from 2 px under the top of the row to 2 px over
   * its bottom, the band the violins are drawn in; the group labels sit
   * under the column centres.
   */
  function shapes(el: HTMLElement): { rowH: number; widths: number[] }[] {
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
      return { rowH: at(axis, "y2") - at(axis, "y1") + 4, widths };
    });
  }

  it.each([
    [800, 560],
    [1440, 900],
  ])(
    "draws the widest violin 0.8 times as wide as its row is tall, %i x %i px",
    (width, height) => {
      // Filling 85% of its column, the widest violin here was 121 px wide
      // in an 84 px row at 800 x 560, and 229 px wide in a 140 px row at
      // 1440 x 900.
      const el = container(width, height);
      instances.push(createViolin(el, { data: panel() }));
      const rows = shapes(el);
      expect(rows).toHaveLength(6);
      for (const { rowH, widths } of rows) {
        const widest = Math.max(...widths);
        // One px of antialiasing on each side.
        expect(widest).toBeLessThanOrEqual(0.8 * rowH + 2);
        expect(widest).toBeGreaterThanOrEqual(0.8 * rowH - 2);
      }
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
});
