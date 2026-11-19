import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createDotplot } from "../../src/components/dotplot.js";
import { createKm } from "../../src/components/km.js";
import { createProfile } from "../../src/components/profile.js";
import { createUpset } from "../../src/components/upset.js";
import {
  type PlotomicsInstance,
  defaultTheme,
  textSizes,
} from "../../src/core/index.js";
import {
  colourAlpha,
  resolveColour,
  setCanvasColour,
} from "../../src/core/paint.js";

// Gridlines drawn on a canvas: a grid colour that paints nothing draws no
// line, and the KM gridlines sit under its bands and curves.

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function texts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

/** RGB of the canvas at a point in CSS px. */
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

const WHITE = [255, 255, 255];
const GRID = [0xe5, 0xe7, 0xeb];
const LABEL = textSizes(defaultTheme).label;

/**
 * The label that reads `value`, with `anchor` unless that is null: its x and
 * the y of its line.
 */
function label(el: HTMLElement, value: string, anchor: string | null = "end") {
  const t = texts(el).find(
    (s) =>
      s.textContent === value &&
      (anchor === null || s.getAttribute("text-anchor") === anchor),
  ) as SVGTextElement;
  // A label's baseline is 0.35 of the label size below its line.
  return {
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")) - 0.35 * LABEL,
  };
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

// Values a grid colour may take that paint nothing. A canvas ignores each of
// them and keeps its last stroke style.
const NOTHING = ["none", "", "transparent", "#e5e7eb00", "not a colour"];

/**
 * Make a plot with the default grid, check `isClear` (a pixel on a gridline
 * between the marks is the background) is false, then for each grid colour
 * that paints nothing, on a new plot and after setOptions on the first one,
 * check it is true.
 */
function checkNoGrid(
  make: (el: HTMLElement, grid?: string) => PlotomicsInstance<unknown>,
  isClear: (el: HTMLElement) => boolean,
) {
  const el = container(500, 400);
  const plot = make(el);
  instances.push(plot);
  expect(isClear(el)).toBe(false);
  for (const grid of NOTHING) {
    plot.setOptions({ theme: { grid } });
    expect(isClear(el), `setOptions grid "${grid}"`).toBe(true);
    const fresh = container(500, 400);
    instances.push(make(fresh, grid));
    expect(isClear(fresh), `new plot, grid "${grid}"`).toBe(true);
  }
}

describe("a grid colour that paints nothing", () => {
  // Before the fix a canvas kept its last stroke style for such a colour,
  // so the gridline was drawn in black, or in the colour of the last line.

  it("draws no profile gridline", () => {
    checkNoGrid(
      (el, grid) =>
        createProfile(el, {
          data: { columns: { value: [10, 2, 7, 4] } },
          options: grid === undefined ? {} : { theme: { grid } },
        }),
      (el) => {
        // Between the first two bars, on the gridline at 4.
        const t = label(el, "4");
        const left = t.x + 8;
        const slot = (500 - left - 14) / 4;
        return far(pixel(el, left + slot, Math.round(t.y)), WHITE) === 0;
      },
    );
  });

  it("draws no upset gridline, row band or empty dot", () => {
    checkNoGrid(
      (el, grid) =>
        createUpset(el, {
          data: {
            columns: { size: [124, 50, 30] },
            meta: { sets: ["A", "B"], membership: [1, 0, 0, 1, 1, 1] },
          },
          options: grid === undefined ? {} : { theme: { grid } },
        }),
      (el) => {
        const t = label(el, "40");
        const left = t.x + 6;
        const col = (500 - left - 12) / 3;
        const a = label(el, "A");
        const b = label(el, "B");
        return (
          // Between the first two bars, on the gridline at 40.
          far(pixel(el, left + col, Math.round(t.y)), WHITE) === 0 &&
          // The band of row A, between two dots.
          far(pixel(el, left + col, Math.round(a.y)), WHITE) === 0 &&
          // The empty dot of set B in the first column.
          far(pixel(el, left + col / 2, Math.round(b.y)), WHITE) === 0
        );
      },
    );
  });

  it("draws no dotplot gridline", () => {
    checkNoGrid(
      (el, grid) =>
        createDotplot(el, {
          data: {
            columns: {
              gene: ["A", "B", "A", "B"],
              cluster: ["x", "x", "y", "y"],
              pct: [100, 100, 100, 100],
              value: [1, 2, 3, 4],
            },
          },
          options: {
            showLegend: false,
            ...(grid === undefined ? {} : { theme: { grid } }),
          },
        }),
      (el) => {
        // 30 px right of the dot of gene A in group x, on its gridline.
        const a = label(el, "A");
        const x = label(el, "x", null);
        return far(pixel(el, x.x + 30, Math.round(a.y)), WHITE) === 0;
      },
    );
  });

  it("draws no KM gridline", () => {
    checkNoGrid(
      (el, grid) =>
        createKm(el, {
          data: {
            columns: { time: [0, 10, 30], surv: [1, 0.5, 0.5] },
            meta: { riskTimes: [0, 10, 20, 30] },
          },
          options: {
            showLegend: false,
            ...(grid === undefined ? {} : { theme: { grid } }),
          },
        }),
      (el) => {
        // On the 50% gridline at time 5, where the curve is still at 100%.
        const x0 = label(el, "0", "middle").x;
        const x10 = label(el, "10", "middle").x;
        const y = Math.round(label(el, "50%").y);
        return far(pixel(el, (x0 + x10) / 2, y), WHITE) === 0;
      },
    );
  });
});

describe("KM gridlines", () => {
  // One curve at 50% from time 10, in a band from 15% to 85%: the 25% and
  // 75% gridlines cross the band, the 50% one runs under the curve.
  const data = {
    columns: {
      time: [0, 10, 30],
      surv: [1, 0.5, 0.5],
      lower: [1, 0.15, 0.15],
      upper: [1, 0.85, 0.85],
    },
    meta: { riskTimes: [0, 10, 20, 30] },
  };
  const W = 500;

  /** x of a time, from the labels at 0 and 10. */
  function xAt(el: HTMLElement, t: number) {
    const x0 = label(el, "0", "middle").x;
    const x10 = label(el, "10", "middle").x;
    return x0 + (t / 10) * (x10 - x0);
  }

  it("draws them under the band and the curve, on screen and in the PNG", async () => {
    // Before the fix they were SVG lines over the canvas, so the 50% line
    // crossed the curve and the 25% and 75% lines showed over the band.
    const el = container(W, 400);
    const plot = createKm(el, { data, options: { showLegend: false } });
    instances.push(plot);
    const x = xAt(el, 20);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      // Nothing is drawn over the canvas on and next to the gridlines: the
      // widget shows the canvas pixel, where the band and the curve are
      // drawn over the line.
      let over = 0;
      for (const value of ["25%", "50%", "75%"]) {
        const row = Math.round(label(el, value).y);
        for (let dy = -1; dy <= 1; dy += 1) {
          const shown = await pngPixel(png as Blob, W, x, row + dy);
          over = Math.max(over, far(shown, pixel(el, x, row + dy)));
        }
      }
      expect(over).toBeLessThanOrEqual(2);
      // The curve covers the 50% gridline.
      const row = Math.round(label(el, "50%").y);
      const curve = await pngPixel(png as Blob, W, x, row);
      expect(far(curve, GRID)).toBeGreaterThan(60);
      // Where no mark is, the gridline shows.
      const open = await pngPixel(png as Blob, W, xAt(el, 5), row);
      expect(far(open, GRID)).toBeLessThan(12);
    }
  });

  it("keeps them under the band and the curve in the SVG export", () => {
    const el = container(W, 400);
    const plot = createKm(el, { data, options: { showLegend: false } });
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
});

describe("grid colours that depend on the page", () => {
  // The SVG gridlines of main took a custom property and the text colour.
  // Before the fix a canvas could not read var(), so the gridline was left
  // out, and it drew currentColor in black.
  const RED = [255, 0, 0];
  const GREEN = [0, 160, 0];

  /** A plot in a container that sets --rvgrid to red and text to green. */
  function inPage(make: (el: HTMLElement) => PlotomicsInstance<unknown>) {
    const el = container(500, 400);
    el.style.setProperty("--rvgrid", "#ff0000");
    el.style.color = "rgb(0, 160, 0)";
    instances.push(make(el));
    return el;
  }

  /** The profile pixel between its first two bars, on the gridline at 4. */
  function profileGrid(el: HTMLElement) {
    const t = label(el, "4");
    const left = t.x + 8;
    const slot = (500 - left - 14) / 4;
    return pixel(el, left + slot, Math.round(t.y));
  }

  /** The KM pixel on the 50% gridline at time 5, clear of the curve. */
  function kmGrid(el: HTMLElement) {
    const x0 = label(el, "0", "middle").x;
    const x10 = label(el, "10", "middle").x;
    return pixel(el, (x0 + x10) / 2, Math.round(label(el, "50%").y));
  }

  for (const [grid, colour] of [
    ["var(--rvgrid)", RED],
    ["currentColor", GREEN],
  ] as const) {
    it(`draws a ${grid} profile gridline in the colour the page gives`, () => {
      const el = inPage((e) =>
        createProfile(e, {
          data: { columns: { value: [10, 2, 7, 4] } },
          options: { theme: { grid } },
        }),
      );
      expect(far(profileGrid(el), [...colour])).toBeLessThanOrEqual(2);
    });

    it(`draws a ${grid} KM gridline in the colour the page gives`, () => {
      const el = inPage((e) =>
        createKm(e, {
          data: {
            columns: { time: [0, 10, 30], surv: [1, 0.5, 0.5] },
            meta: { riskTimes: [0, 10, 20, 30] },
          },
          options: { showLegend: false, theme: { grid } },
        }),
      );
      expect(far(kmGrid(el), [...colour])).toBeLessThanOrEqual(2);
    });
  }

  it("draws no gridline for a custom property the page does not set", () => {
    const el = inPage((e) =>
      createProfile(e, {
        data: { columns: { value: [10, 2, 7, 4] } },
        options: { theme: { grid: "var(--not-set)" } },
      }),
    );
    expect(profileGrid(el)).toEqual(WHITE);
  });
});

describe("setCanvasColour", () => {
  const ctx = document
    .createElement("canvas")
    .getContext("2d") as CanvasRenderingContext2D;

  it("paints nothing with a colour whose alpha is 0, in any syntax", () => {
    // Before the fix only the rgba(r, g, b, 0) form was caught, so these
    // returned true though nothing painted.
    for (const colour of [
      "color(display-p3 1 0 0 / 0)",
      "oklch(0.7 0.1 200 / 0)",
      "oklch(0.7 0.1 200 / 0%)",
      "rgb(255 0 0 / 0)",
      "hsl(120 50% 50% / 0)",
      "rgba(255, 0, 0, 0)",
      "transparent",
    ]) {
      expect(setCanvasColour(ctx, "strokeStyle", colour), colour).toBe(false);
    }
  });

  it("paints with an opaque or a translucent colour", () => {
    for (const colour of [
      "#e5e7eb",
      "rgb(255, 0, 0)",
      "rgb(0, 0, 0)",
      "rgba(0, 0, 0, 0.2)",
      "rgb(255 0 0 / 50%)",
      "oklch(0.7 0.1 200)",
      "color(display-p3 1 0 0)",
    ]) {
      expect(setCanvasColour(ctx, "strokeStyle", colour), colour).toBe(true);
    }
  });

  it("reads the alpha of each syntax", () => {
    expect(colourAlpha("#e5e7eb")).toBe(1);
    expect(colourAlpha("rgb(255, 0, 0)")).toBe(1);
    expect(colourAlpha("rgba(255, 0, 0, 0.25)")).toBe(0.25);
    expect(colourAlpha("oklch(0.7 0.1 200 / 40%)")).toBeCloseTo(0.4, 10);
    expect(colourAlpha("color(display-p3 1 0 0 / 0)")).toBe(0);
  });

  it("resolves var() and currentColor against the plot's element", () => {
    const el = container(100, 100);
    el.style.setProperty("--rvgrid", "#ff0000");
    el.style.color = "rgb(0, 160, 0)";
    expect(resolveColour("var(--rvgrid)", el)).toBe("rgb(255, 0, 0)");
    expect(resolveColour("currentColor", el)).toBe("rgb(0, 160, 0)");
    expect(resolveColour("var(--not-set)", el)).toBe("none");
    // The probe leaves nothing behind.
    expect(el.children.length).toBe(0);
    expect(setCanvasColour(ctx, "strokeStyle", "var(--rvgrid)", el)).toBe(true);
    expect(ctx.strokeStyle).toBe("#ff0000");
    // Out of the document nothing resolves, and the colour is kept as given.
    const loose = document.createElement("div");
    expect(resolveColour("#123456", loose)).toBe("#123456");
  });
});
