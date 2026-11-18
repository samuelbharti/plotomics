import { afterEach, describe, expect, it } from "vitest";
import { createEmbedding } from "../../src/components/embedding.js";
import { createSpatial } from "../../src/components/spatial.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 500, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function svgTexts(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("svg text")).map(
    (t) => t.textContent ?? "",
  );
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

function pixel(el: HTMLElement, x: number, y: number): number[] {
  const c = el.querySelector("canvas") as HTMLCanvasElement;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const ratio = c.width / c.clientWidth;
  const d = ctx.getImageData(
    Math.floor(x * ratio),
    Math.floor(y * ratio),
    1,
    1,
  ).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

const poll = { timeout: 10_000, interval: 50 };

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("embedding with missing values", () => {
  it("reads a colour column that starts with NA as categories", async () => {
    const el = container();
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [0, 1, 2, 3],
            y: [0, 1, 0, 1],
            color: [null, "B cell", "T cell", "B cell"] as unknown as string[],
          },
        },
      }),
    );
    await expect
      .poll(() => svgTexts(el), poll)
      .toEqual(expect.arrayContaining(["B cell", "T cell", "NA"]));
  });

  it("sorts text categories, keeping cluster 2 before cluster 10", async () => {
    const el = container();
    const labels = ["cluster 10", "cluster 2", "cluster 1", "cluster 2"];
    instances.push(
      createEmbedding(el, {
        data: { columns: { x: [0, 1, 2, 3], y: [0, 1, 0, 1], color: labels } },
      }),
    );
    await expect
      .poll(() => svgTexts(el).filter((t) => t.startsWith("cluster")), poll)
      .toEqual(["cluster 1", "cluster 2", "cluster 10"]);
  });

  it("leaves a point with a missing coordinate off the axes", async () => {
    const el = container();
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [10, null, 12, 14] as unknown as number[],
            y: [1, 2, 3, 4],
          },
        },
        options: { showAxes: true },
      }),
    );
    // Data runs from 10 to 14; a null read as 0 stretched the axis to 0.
    await expect
      .poll(() => {
        const xs = Array.from(
          el.querySelectorAll('svg text[text-anchor="middle"]'),
        )
          .map((t) => Number(t.textContent))
          .filter((v) => Number.isFinite(v));
        return xs.length ? Math.min(...xs) : Number.NaN;
      }, poll)
      .toBeGreaterThanOrEqual(9);
  });

  it("drops the lasso selection when new data arrives", async () => {
    const el = container();
    const seen: number[][] = [];
    const plot = createEmbedding(el, {
      data: { columns: { x: [0, 1, 2, 3], y: [0, 1, 2, 3] } },
      options: { mouseMode: "lasso", onSelect: (rows) => seen.push(rows) },
    });
    instances.push(plot);
    await new Promise((r) => setTimeout(r, 300));
    // Lasso the whole plot area.
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      // regl-scatterplot starts a lasso only with the main button held.
      buttons: 1,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0.01, 0.01)));
    for (const [fx, fy] of [
      [0.99, 0.01],
      [0.99, 0.99],
      [0.01, 0.99],
      [0.01, 0.02],
    ] as const) {
      for (let s = 1; s <= 10; s += 1) {
        window.dispatchEvent(new MouseEvent("mousemove", at(fx, fy)));
        await new Promise((res) => setTimeout(res, 5));
      }
    }
    window.dispatchEvent(new MouseEvent("mouseup", at(0.01, 0.02)));
    await expect
      .poll(() => plot.selectedIndices.length, poll)
      .toBeGreaterThan(0);

    plot.setData({ columns: { x: [0, 1], y: [0, 1] } });
    expect(plot.selectedIndices).toEqual([]);
    expect(seen[seen.length - 1]).toEqual([]);
  });
});

describe("embedding legend and selection on re-render", () => {
  it("keeps the NA key in view with more than 20 categories", async () => {
    const el = container(600, 500);
    const labels = Array.from({ length: 22 }, (_, i) => `c${i + 1}`);
    instances.push(
      createEmbedding(el, {
        data: {
          columns: {
            x: [...labels.map((_, i) => i), 30],
            y: [...labels.map((_, i) => i), 30],
            color: [...labels, null] as unknown as string[],
          },
        },
      }),
    );
    await expect
      .poll(() => svgTexts(el), poll)
      .toEqual(expect.arrayContaining(["+2 more", "NA"]));
  });

  it("keeps the selection when the same points arrive again", async () => {
    const el = container();
    const pts = () => ({ columns: { x: [0, 1, 2, 3], y: [0, 1, 2, 3] } });
    const plot = createEmbedding(el, {
      data: pts(),
      options: { mouseMode: "lasso" },
    });
    instances.push(plot);
    await new Promise((r) => setTimeout(r, 300));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      buttons: 1,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0.01, 0.01)));
    for (const [fx, fy] of [
      [0.99, 0.01],
      [0.99, 0.99],
      [0.01, 0.99],
      [0.01, 0.02],
    ] as const) {
      for (let s = 1; s <= 10; s += 1) {
        window.dispatchEvent(new MouseEvent("mousemove", at(fx, fy)));
        await new Promise((res) => setTimeout(res, 5));
      }
    }
    window.dispatchEvent(new MouseEvent("mouseup", at(0.01, 0.02)));
    await expect
      .poll(() => plot.selectedIndices.length, poll)
      .toBeGreaterThan(0);
    const before = plot.selectedIndices;
    // A Shiny re-render: the same points, as a new object.
    plot.setData(pts());
    expect(plot.selectedIndices).toEqual(before);
  });
});

describe("spatial colours and missing values", () => {
  const base = {
    x: [20, 60, 100, 140],
    y: [50, 50, 50, 50],
  };
  const meta = { imgWidth: 160, imgHeight: 100, spotDiameter: 20 };

  it("colours numeric cluster ids against their levels", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: { ...base, color: [0, 1, 2, 0] },
          meta: { ...meta, levels: ["0", "1", "2"] },
        },
        options: { colorMode: "categorical", showImage: false, spotOpacity: 1 },
      }),
    );
    // 400 x 250 holds the 160 x 100 image at scale 2.5.
    const muted = [0x6b, 0x72, 0x80];
    expect(pixel(el, 20 * 2.5, 50 * 2.5)).not.toEqual(muted);
    expect(pixel(el, 60 * 2.5, 50 * 2.5)).not.toEqual(
      pixel(el, 20 * 2.5, 50 * 2.5),
    );
  });

  it("fills levels past a short colour list from the palette", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: { ...base, color: ["a", "b", "c", "a"] },
          meta: { ...meta, colors: ["#ff0000"] },
        },
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    const a = pixel(el, 20 * 2.5, 50 * 2.5);
    const b = pixel(el, 60 * 2.5, 50 * 2.5);
    const c = pixel(el, 100 * 2.5, 50 * 2.5);
    expect(a).toEqual([255, 0, 0]);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(b);
  });

  it("reads a leading NA, sorts levels naturally and says NA on hover", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            ...base,
            color: [null, "10", "2", "1"] as unknown as string[],
          },
          meta,
        },
        options: { showImage: false },
      }),
    );
    const texts = svgTexts(el);
    expect(texts.filter((t) => /^\d+$/.test(t))).toEqual(["1", "2", "10"]);
    expect(texts).toContain("NA");
    expect(hoverAt(el, 20 * 2.5, 50 * 2.5)).toContain("NA");
  });

  it("does not throw on hovering a spot with a missing number", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            ...base,
            color: [1, null, 3, 4] as unknown as number[],
          },
          meta,
        },
        options: { showImage: false },
      }),
    );
    expect(hoverAt(el, 60 * 2.5, 50 * 2.5)).toContain("NA");
    expect(svgTexts(el)).toContain("NA");
  });

  it("draws no spot for a missing coordinate", () => {
    const el = container(400, 250);
    instances.push(
      createSpatial(el, {
        data: {
          columns: {
            x: [null, 60] as unknown as number[],
            y: [null, 50] as unknown as number[],
          },
          meta,
        },
        options: { showImage: false, spotOpacity: 1 },
      }),
    );
    // A null read as 0 put the spot in the top-left corner of the image.
    expect(pixel(el, 2, 2)).toEqual([255, 255, 255]);
  });
});
