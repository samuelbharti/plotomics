import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createProfile } from "../../src/components/profile.js";
import { createUpset } from "../../src/components/upset.js";
import {
  DEFAULT_PADDING,
  type PlotomicsInstance,
  defaultTheme,
  textSizes,
} from "../../src/core/index.js";

// Profile and UpSet behaviour that needs a real browser: the gridlines under
// the bars, and a profile with values that are not finite.

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function texts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
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

const GRID = [0xe5, 0xe7, 0xeb];
const LABEL = textSizes(defaultTheme).label;

/** The y tick label that reads `value`: its x and the y of its tick. */
function tick(el: HTMLElement, value: string) {
  const t = texts(el).find(
    (s) => s.textContent === value && s.getAttribute("text-anchor") === "end",
  ) as SVGTextElement;
  // A tick label's baseline is 0.35 of the label size below its tick.
  return {
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")) - 0.35 * LABEL,
  };
}

/**
 * Whether the gridline at `y` is drawn under a bar in `png`: the pixels
 * across the gridline at `barX` have the bar's colour, and the gridline
 * shows at `gapX`, between two bars.
 */
async function gridUnderBar(
  el: HTMLElement,
  png: Blob,
  cssWidth: number,
  at: { y: number; barX: number; gapX: number },
) {
  const fill = pixel(el, at.barX, at.y - 5);
  const row = Math.round(at.y);
  // The plot box sits inside the theme padding, which the PNG keeps.
  const box = (
    el.querySelector("svg") as SVGSVGElement
  ).getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const [ox, oy] = [box.left - e.left, box.top - e.top];
  let across = 0;
  let beside = 255;
  for (let dy = -1; dy <= 1; dy += 1) {
    const p = await pngPixel(png, cssWidth, at.barX + ox, row + dy + oy);
    across = Math.max(across, far(p, fill));
    const g = await pngPixel(png, cssWidth, at.gapX + ox, row + dy + oy);
    beside = Math.min(beside, far(g, GRID));
  }
  return { across, beside, fill };
}

/** Whether an SVG export draws any gridline over the image of the canvas. */
function gridOverImage(svg: string): Element[] {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const nodes = Array.from(doc.documentElement.children);
  const image = nodes.findIndex((n) => n.localName === "image");
  expect(image).toBeGreaterThanOrEqual(0);
  return nodes
    .slice(image + 1)
    .filter((n) => n.getAttribute("stroke") === "#e5e7eb");
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("profile gridlines", () => {
  const data = { columns: { value: [10, 2, 7, 4] } };
  const W = 500;

  /** The gridline at 4: it crosses the first bar, of 10. */
  function where(el: HTMLElement) {
    const t = tick(el, "4");
    // Tick labels end 8 px left of the bars; the plot keeps 4 px on the
    // right of its box, and each of the four bars sits in the middle of
    // its slot.
    const left = t.x + 8;
    const slot = (boxWidth(el) - left - 4) / 4;
    return { y: t.y, barX: left + slot / 2, gapX: left + slot };
  }

  it("draws the gridlines under the bars, on screen and in the PNG", async () => {
    // Before the fix the gridlines were SVG lines over the canvas, so a
    // pale line crossed every bar.
    const el = container(W, 300);
    const plot = createProfile(el, { data });
    instances.push(plot);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const r = await gridUnderBar(el, png as Blob, W, where(el));
      // The bar is drawn, not the white page.
      expect(far(r.fill, [255, 255, 255])).toBeGreaterThan(60);
      expect(r.across).toBeLessThan(12);
      expect(r.beside).toBeLessThan(12);
    }
  });

  it("keeps the gridlines under the bars in the SVG export", () => {
    const el = container(W, 300);
    const plot = createProfile(el, { data });
    instances.push(plot);
    expect(gridOverImage(plot.exportSVG?.() ?? "")).toEqual([]);
  });
});

describe("upset gridlines", () => {
  const data = {
    columns: { size: [124, 50, 30] },
    meta: { sets: ["A", "B"], membership: [1, 0, 0, 1, 1, 1] },
  };
  const W = 500;

  /** The gridline at 40: it crosses the first bar, of 124. */
  function where(el: HTMLElement) {
    const t = tick(el, "40");
    // Tick labels end 6 px left of the bars; the plot keeps 2 px on the
    // right of its box, and each of the three bars sits in the middle of
    // its column.
    const left = t.x + 6;
    const col = (boxWidth(el) - left - 2) / 3;
    return { y: t.y, barX: left + col / 2, gapX: left + col };
  }

  it("draws the gridlines under the bars, on screen and in the PNG", async () => {
    // Before the fix the gridlines were SVG lines over the canvas, so a
    // pale line crossed every bar.
    const el = container(W, 400);
    const plot = createUpset(el, { data });
    instances.push(plot);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const r = await gridUnderBar(el, png as Blob, W, where(el));
      expect(far(r.fill, [255, 255, 255])).toBeGreaterThan(60);
      expect(r.across).toBeLessThan(12);
      expect(r.beside).toBeLessThan(12);
    }
  });

  it("keeps the gridlines under the bars in the SVG export", () => {
    const el = container(W, 400);
    const plot = createUpset(el, { data });
    instances.push(plot);
    expect(gridOverImage(plot.exportSVG?.() ?? "")).toEqual([]);
  });

  it("still draws the gridlines with no data", () => {
    const el = container(W, 400);
    instances.push(createUpset(el, { data: { columns: {} } }));
    const t = tick(el, "1.0");
    expect(far(pixel(el, W - 40, Math.round(t.y)), GRID)).toBeLessThan(12);
  });
});

/** The y tick labels of a profile, top to bottom. */
function yTicks(el: HTMLElement): string[] {
  return texts(el)
    .filter((t) => t.getAttribute("text-anchor") === "end")
    .map((t) => t.textContent ?? "");
}

/**
 * x of the middle of bar `i` of `n` in a profile `width` px wide, from the
 * x of its y tick labels, which end 8 px left of the bars.
 */
/**
 * The x of the middle of bar `i` of `n` in a profile: the bars run from 8 px
 * right of the tick labels to 4 px from the right edge of the plot box,
 * the element `width` px wide less the theme padding.
 */
function profileBarX(
  el: HTMLElement,
  i: number,
  n: number,
  width: number,
  zero = "0",
) {
  const left = tick(el, zero).x + 8;
  const box = width - 2 * DEFAULT_PADDING;
  return left + ((box - left - 4) / n) * (i + 0.5);
}

/** The width of the plot box: the element less the theme padding. */
function boxWidth(el: HTMLElement): number {
  return Number(
    (el.querySelector("svg") as SVGSVGElement).getAttribute("width"),
  );
}

describe("profile with values that are not finite, as shares", () => {
  // Python sends NaN as it is; R sends NA, NaN and Inf as null.
  const python = { columns: { value: Float32Array.from([3, Number.NaN, 5]) } };
  const r = { columns: { value: [3, null, 5] as unknown as number[] } };
  const W = 500;

  /** x of the middle of bar `i` of three. */
  function barX(el: HTMLElement, i: number) {
    return profileBarX(el, i, 3, W, "0%");
  }

  it("leaves a NaN out of the total, so the bars and the percent axis agree", () => {
    // Before the fix the NaN made the total NaN: the bars kept their raw
    // values and the axis read up to 500%.
    const el = container(W, 300);
    instances.push(
      createProfile(el, { data: python, options: { asFraction: true } }),
    );
    const ticks = yTicks(el);
    expect(ticks).toContain("60%");
    expect(ticks.every((s) => Number.parseFloat(s) <= 100)).toBe(true);
    // The bar of 5 is 62.5% of the total of 8: it passes the 60% tick and
    // stops short of the next one.
    const x = barX(el, 2);
    const ink = (y: number) => far(pixel(el, x, y), [255, 255, 255]) > 60;
    const at60 = tick(el, "60%").y;
    const top = tick(el, ticks[ticks.length - 1] as string).y;
    expect(ink(at60 + 2)).toBe(true);
    expect(ink(top + 2)).toBe(false);
  });

  it("draws a NaN from Python as R's missing value", () => {
    const fromPy = container(W, 300);
    const fromR = container(W, 300);
    instances.push(
      createProfile(fromPy, { data: python, options: { asFraction: true } }),
      createProfile(fromR, { data: r, options: { asFraction: true } }),
    );
    expect(yTicks(fromPy)).toEqual(yTicks(fromR));
    const image = (el: HTMLElement) =>
      (el.querySelector("canvas") as HTMLCanvasElement).toDataURL();
    expect(image(fromPy)).toBe(image(fromR));
  });

  it("gives the share of the finite total on hover, and no value for a missing one", () => {
    // Before the fix every share read 0.0% with a NaN in the data, and a
    // missing value from R threw on hover.
    for (const data of [python, r]) {
      const el = container(W, 300);
      instances.push(
        createProfile(el, { data, options: { asFraction: true } }),
      );
      const y = tick(el, "0%").y - 5;
      expect(hoverAt(el, barX(el, 2), y)).toContain("5 (62.5%)");
      expect(hoverAt(el, barX(el, 1), y)).toContain("no value");
    }
  });
});

describe("profile shares that are not defined", () => {
  const W = 500;

  it("draws the values on a plain number axis, with no share on hover", () => {
    // Shares of a total with mixed signs, or of a total of 0, are not
    // defined. Before the fix [2, -2, 1, -1] read 0% to 200% with a tooltip
    // of "2 (0.0%)", and [3, -1] drew bars of 150% and -50%.
    for (const value of [
      [2, -2, 1, -1],
      [3, -1],
      [0, 0],
    ]) {
      const el = container(W, 300);
      instances.push(
        createProfile(el, {
          data: { columns: { value } },
          options: { asFraction: true },
        }),
      );
      const ticks = yTicks(el);
      expect(ticks).toContain("0");
      expect(ticks.filter((s) => s.endsWith("%"))).toEqual([]);
      const x = profileBarX(el, 0, value.length, W);
      const tip = hoverAt(el, x, tick(el, "0").y - 5);
      expect(tip).toContain(String(value[0]));
      expect(tip).not.toContain("%");
    }
  });
});

describe("profile with negative values", () => {
  const W = 500;
  const data = { columns: { value: [5, -3, 2], label: ["a", "b", "c"] } };

  it("keeps a negative bar inside the plot, down from the zero line", () => {
    // Before the fix the axis started at 0, and the bar of -3 ran from the
    // bottom of the plot down through the bar labels and off the canvas.
    const el = container(W, 300);
    instances.push(createProfile(el, { data }));
    // The bar labels are right-aligned too; the tick labels are numbers.
    const values = yTicks(el).map(Number).filter(Number.isFinite);
    expect(values).toContain(0);
    const lowest = Math.min(...values);
    expect(lowest).toBeLessThanOrEqual(-3);
    const zero = tick(el, "0").y;
    const bottom = tick(el, String(lowest)).y;
    // y of -3, on the line from the zero line to the lowest tick.
    const at3 = zero + ((bottom - zero) * -3) / lowest;
    const ink = (x: number, y: number) =>
      far(pixel(el, x, y), [255, 255, 255]) > 60;
    const neg = profileBarX(el, 1, 3, W);
    expect(ink(neg, zero + 3)).toBe(true);
    expect(ink(neg, at3 - 3)).toBe(true);
    expect(ink(neg, at3 + 3)).toBe(false);
    // Nothing below the plot: the band of bar labels and the bottom row
    // of the plot box, inside the theme padding.
    expect(ink(neg, bottom + 3)).toBe(false);
    expect(ink(neg, 300 - 2 * DEFAULT_PADDING - 1)).toBe(false);
    // A positive bar rises from the zero line and stops there.
    const pos = profileBarX(el, 0, 3, W);
    expect(ink(pos, zero - 3)).toBe(true);
    expect(ink(pos, zero + 3)).toBe(false);
  });

  it("draws the same with asFraction, since shares are not defined", () => {
    const plain = container(W, 300);
    const shares = container(W, 300);
    instances.push(
      createProfile(plain, { data }),
      createProfile(shares, { data, options: { asFraction: true } }),
    );
    expect(yTicks(shares)).toEqual(yTicks(plain));
    const image = (el: HTMLElement) =>
      (el.querySelector("canvas") as HTMLCanvasElement).toDataURL();
    expect(image(shares)).toBe(image(plain));
  });
});

describe("profile tooltip of a negative zero", () => {
  it("reads 0, not -0", () => {
    // Python sends -0 for a tiny negative value that float32 rounds. Before
    // the fix the tooltip read "-0 (0.0%)".
    const el = container(500, 300);
    instances.push(
      createProfile(el, {
        data: { columns: { value: Float32Array.from([-0, 4]) } },
      }),
    );
    const tip = hoverAt(el, profileBarX(el, 0, 2, 500), tick(el, "0").y - 5);
    expect(tip).toContain("0 (0.0%)");
    expect(tip).not.toContain("-0");
  });
});
