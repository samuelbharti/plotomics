import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createHic } from "../../src/components/hic.js";
import {
  type PlotomicsInstance,
  compositePNG,
  darkTheme,
  padSVG,
} from "../../src/core/index.js";
import { PLOTS, settled } from "./plots.js";

// A theme background given as a custom property, var(--plot-bg), paints the
// colour the page gives it, as the same colour given directly does: on the
// canvases, in the PNG export and in the SVG export. A canvas cannot read
// var(), so before the fix such a background painted black, or white in the
// Hi-C map.

const BG = "#2a3f5c";
const RGB = [0x2a, 0x3f, 0x5c];

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  el.style.setProperty("--plot-bg", BG);
  document.body.appendChild(el);
  return el;
}

/** The pixels of a PNG, as RGBA bytes, with its size. */
async function pixels(png: Blob) {
  const bitmap = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    data: ctx.getImageData(0, 0, c.width, c.height).data,
    w: c.width,
    h: c.height,
  };
}

/** The share of the pixels of a PNG within 3 of `rgb` in every channel. */
async function shareOf(png: Blob, rgb: number[]): Promise<number> {
  const { data } = await pixels(png);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs((data[i] as number) - (rgb[0] as number)) <= 3 &&
      Math.abs((data[i + 1] as number) - (rgb[1] as number)) <= 3 &&
      Math.abs((data[i + 2] as number) - (rgb[2] as number)) <= 3 &&
      (data[i + 3] as number) === 255
    ) {
      n += 1;
    }
  }
  return n / (data.length / 4);
}

async function screenPNG(el: HTMLElement): Promise<Blob> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/** An exported SVG drawn as a PNG `w` x `h` px. */
async function svgPNG(text: string, w: number, h: number): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await image.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  (c.getContext("2d") as CanvasRenderingContext2D).drawImage(image, 0, 0, w, h);
  return new Promise((r) => c.toBlob((b) => r(b as Blob), "image/png"));
}

const W = 640;

describe.each(PLOTS)("$name with a var() background", (plot) => {
  it("paints the colour the page sets, as the colour itself does", async () => {
    const given = container(W, plot.height);
    const literal = plot.make(given, { background: BG });
    instances.push(literal);
    const viaVar = container(W, plot.height);
    const inst = plot.make(viaVar, { background: "var(--plot-bg)" });
    instances.push(inst);
    await settled(plot.name);
    await settled(plot.name);
    const want = await shareOf(await screenPNG(given), RGB);
    expect(want).toBeGreaterThan(0.05);
    const shares = {
      screen: await shareOf(await screenPNG(viaVar), RGB),
      png: await shareOf((await inst.exportPNG?.(1)) as Blob, RGB),
      svg: await shareOf(
        await svgPNG(inst.exportSVG?.() ?? "", W, plot.height),
        RGB,
      ),
    };
    for (const [where, share] of Object.entries(shares)) {
      expect(share, where).toBeGreaterThan(want - 0.02);
    }
  });
});

describe("the background of a WebGL matrix", () => {
  it("fills the Hi-C bins with no data with a var() background", async () => {
    // A 32-bin block with no data on the diagonal.
    const n = 64;
    const values = new Float64Array(n * n);
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        values[r * n + c] =
          r < 32 && c < 32 ? NaN : 1000 / (Math.abs(r - c) + 1);
      }
    }
    const make = (el: HTMLElement, background: string) =>
      createHic(el, {
        data: { columns: { values }, meta: { n, binSize: 10_000 } },
        options: { theme: { background } },
      });
    const given = container(W, 480);
    instances.push(make(given, BG));
    const viaVar = container(W, 480);
    instances.push(make(viaVar, "var(--plot-bg)"));
    await settled("hic");
    const want = await shareOf(await screenPNG(given), RGB);
    // The block, and the space around the map.
    expect(want).toBeGreaterThan(0.5);
    expect(await shareOf(await screenPNG(viaVar), RGB)).toBeGreaterThan(
      want - 0.02,
    );
  });

  it("clears an empty heatmap to the theme background, not white", async () => {
    // Before the fix the canvas was cleared white in every theme.
    const el = container(W, 480);
    instances.push(
      createHeatmap(el, {
        data: { columns: {}, meta: { nrows: 0, ncols: 0 } },
        options: { theme: darkTheme },
      }),
    );
    await settled("heatmap");
    const shot = await screenPNG(el);
    expect(await shareOf(shot, [255, 255, 255])).toBe(0);
    expect(await shareOf(shot, [0x0b, 0x0f, 0x19])).toBeGreaterThan(0.9);
  });
});

describe("compositePNG and padSVG", () => {
  it("leave the image clear for a background that paints nothing", async () => {
    // A canvas keeps black for a colour it cannot read.
    const el = container(40, 30);
    for (const background of ["none", "var(--not-set)", "transparent"]) {
      const png = (await compositePNG({
        width: 40,
        height: 30,
        background,
        element: el,
        layers: [],
        overlay: null,
      })) as Blob;
      const { data } = await pixels(png);
      expect(Math.max(...data), background).toBe(0);
      const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      ) as SVGSVGElement;
      const pad = { top: 2, right: 2, bottom: 2, left: 2 };
      padSVG(svg, 40, 30, pad, background, el);
      expect(svg.firstElementChild?.getAttribute("fill"), background).toBe(
        "none",
      );
    }
  });

  it("write a var() colour in an exported SVG as the colour the page sets", () => {
    const el = container(40, 30);
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    label.setAttribute("fill", "var(--plot-bg)");
    svg.appendChild(label);
    const pad = { top: 2, right: 2, bottom: 2, left: 2 };
    padSVG(svg, 40, 30, pad, "var(--plot-bg)", el);
    expect(svg.firstElementChild?.getAttribute("fill")).toBe(BG);
    expect(label.getAttribute("fill")).toBe("rgb(42, 63, 92)");
  });
});
