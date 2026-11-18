import { afterEach, describe, expect, it } from "vitest";
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
    // B in x is the missing one: its centre is background, its rim is ink.
    const svg = el.querySelector("svg") as SVGSVGElement;
    const labels = Array.from(svg.querySelectorAll("text"));
    const b = labels.find((t) => t.textContent === "B") as SVGTextElement;
    const x = labels.find((t) => t.textContent === "x") as SVGTextElement;
    const cy = Number(b.getAttribute("y")) - 3;
    const cx = Number(x.getAttribute("x"));
    expect(pixel(el, cx, cy)).toEqual([255, 255, 255]);
    expect(hoverAt(el, cx, cy)).toContain("value NA");
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

  it("can hide the value axis", () => {
    const el = container();
    instances.push(
      createViolin(el, { data, options: { showValueAxis: false } }),
    );
    expect(svgTexts(el)).not.toContain("10");
  });
});
