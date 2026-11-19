import { afterEach, describe, expect, it } from "vitest";
import { createDotplot } from "../../src/components/dotplot.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

// A dot plot with more genes or groups than its cells have room for. Before
// the fix the dot radius went to 0 or below, so no dot was drawn, and the
// size legend wrote a negative radius, which the browser logs as an error.

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

function manyData(ngenes: number, nclusters: number) {
  const gene: string[] = [];
  const cluster: string[] = [];
  const pct: number[] = [];
  const value: number[] = [];
  for (let i = 0; i < ngenes; i += 1) {
    for (let j = 0; j < nclusters; j += 1) {
      gene.push(`G${i}`);
      cluster.push(`C${j}`);
      pct.push(40 + ((i * 7 + j * 13) % 60));
      value.push(((i * 3 + j) % 10) / 3);
    }
  }
  return { columns: { gene, cluster, pct, value } };
}

describe("a dot plot of 300 genes and 30 groups at 800 x 560", () => {
  it("draws its dots, at a radius of at least 1 px", () => {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:560px;";
    document.body.appendChild(el);
    instances.push(createDotplot(el, { data: manyData(300, 30) }));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // A dot pixel is far from the white background and the light grey
    // gridlines.
    const far = (i: number, rgb: number[]) =>
      Math.max(
        Math.abs((d[i] as number) - (rgb[0] as number)),
        Math.abs((d[i + 1] as number) - (rgb[1] as number)),
        Math.abs((d[i + 2] as number) - (rgb[2] as number)),
      ) > 60;
    let dots = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (far(i, [255, 255, 255]) && far(i, [0xe5, 0xe7, 0xeb])) dots += 1;
    }
    expect(dots).toBeGreaterThan(5000);
  });

  it("gives every size legend swatch a radius of 0 or more", () => {
    const el = document.createElement("div");
    el.style.cssText = "width:800px;height:560px;";
    document.body.appendChild(el);
    instances.push(createDotplot(el, { data: manyData(300, 30) }));
    const radii = Array.from(el.querySelectorAll("svg circle")).map((c) =>
      Number(c.getAttribute("r")),
    );
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(r).toBeGreaterThanOrEqual(0);
  });
});
