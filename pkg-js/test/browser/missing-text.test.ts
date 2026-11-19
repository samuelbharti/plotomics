import { afterEach, describe, expect, it } from "vitest";
import { createClustermap } from "../../src/components/clustermap.js";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createProfile } from "../../src/components/profile.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

// R sends an NA name or group as null, and Python now does too.

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

const svgTexts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")).map((t) => t.textContent ?? "");

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

const matrix = {
  columns: { values: [1, 2, 3, 4] },
  meta: {
    nrows: 2,
    ncols: 2,
    rowLabels: ["r0", null],
    colLabels: [null, "c1"],
  },
};

describe("a missing row or column name", () => {
  it("is drawn as no text in a heatmap", () => {
    const el = container();
    instances.push(createHeatmap(el, { data: matrix }));
    const texts = svgTexts(el);
    expect(texts).toContain("r0");
    expect(texts).toContain("c1");
    expect(texts).not.toContain("null");
  });

  it("is drawn as no text in a clustermap", () => {
    const el = container();
    instances.push(
      createClustermap(el, {
        data: matrix,
        options: { clusterRows: false, clusterCols: false },
      }),
    );
    const texts = svgTexts(el);
    expect(texts).toContain("r0");
    expect(texts).toContain("c1");
    expect(texts).not.toContain("null");
  });
});

describe("a missing profile group", () => {
  it("colours its bars like its block in the banner", () => {
    const el = container();
    instances.push(
      createProfile(el, {
        data: {
          columns: {
            value: [4, 4],
            group: ["g", null] as unknown as string[],
          },
          meta: {
            groups: ["g", null] as unknown as string[],
            groupColors: ["#ff0000", "#0000ff"],
          },
        },
      }),
    );
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    // The banner is at the top; the bars fill the lower half.
    const half = Math.floor(canvas.height / 2);
    const d = ctx.getImageData(
      0,
      half,
      canvas.width,
      canvas.height - half,
    ).data;
    let blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (
        (d[i] as number) < 40 &&
        (d[i + 1] as number) < 40 &&
        (d[i + 2] as number) > 215
      ) {
        blue += 1;
      }
    }
    expect(blue).toBeGreaterThan(0);
    expect(svgTexts(el)).not.toContain("null");
  });
});
