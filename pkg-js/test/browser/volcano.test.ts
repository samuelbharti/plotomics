import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createVolcano } from "../../src/components/volcano.js";
import { type PlotomicsInstance, darkTheme } from "../../src/core/index.js";
import { canvasPNG, drawnPixels, type MarkBox, markBox } from "./helpers.js";

// Volcano behaviour that needs a real browser: framing with p = 0 and missing
// values, label placement, a theme change reaching the canvas, and the
// gridlines under the points.

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** Deterministic values spread over [lo, hi]. */
function spread(n: number, lo: number, hi: number, seed: number) {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  });
}

const yTicks = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('svg text[text-anchor="end"]'))
    .map((t) => Number(t.textContent))
    .filter((v) => Number.isFinite(v));

/** The gene labels: 11 px text, placed left or right of a point. */
const geneLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")).filter(
    (t) =>
      t.getAttribute("font-size") === "11" &&
      /^G\d+$/.test(t.textContent ?? ""),
  ) as SVGTextElement[];

const poll = { timeout: 10_000, interval: 100 };
/** For a view change, which a slow machine can take a while to draw. */
const slow = { timeout: 30_000, interval: 100 };
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("volcano in a browser", () => {
  it("frames the data when some genes have p = 0 or a missing value", async () => {
    const el = container(800, 400);
    const x = spread(2000, -4, 4, 1);
    const y = spread(2000, 0, 20, 2);
    // p = 0 from Python arrives as Infinity; NA from R arrives as null.
    y[10] = Number.POSITIVE_INFINITY;
    (y as (number | null)[])[11] = null;
    (x as (number | null)[])[12] = null;
    const v = createVolcano(el, {
      data: { columns: { x, y } },
      options: { labelTopN: 0 },
    });
    instances.push(v);

    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? markBox(png) : null;
      }, poll)
      .toSatisfy(
        (b: MarkBox | null) => b !== null && b.top < 0.06 && b.bottom > 0.94,
      );
    // Before the fix, Infinity collapsed the y axis to 0..1.
    expect(Math.max(...yTicks(el))).toBeGreaterThanOrEqual(20);
  });

  it("draws the p = 0 gene at the top, where hovering finds it", async () => {
    const el = container(800, 400);
    const x = spread(300, -4, 4, 1);
    const y = spread(300, 0, 20, 2);
    x[10] = 3;
    y[10] = Number.POSITIVE_INFINITY;
    const v = createVolcano(el, {
      data: { columns: { x, y } },
      options: { labelTopN: 0 },
    });
    instances.push(v);
    await expect.poll(() => yTicks(el).length, poll).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));

    // x = 3 sits halfway between the "2" and "4" ticks.
    const tickX = (label: string) =>
      Number(
        Array.from(el.querySelectorAll('svg text[text-anchor="middle"]'))
          .find((t) => t.textContent === label)
          ?.getAttribute("x"),
      );
    const px = (tickX("2") + tickX("4")) / 2;
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    // The SVG holds the plot box, inside the theme padding.
    const box = (
      el.querySelector("svg") as SVGSVGElement
    ).getBoundingClientRect();
    const tip = () =>
      Array.from(el.children).find((c) => c.tagName === "DIV")?.textContent ??
      "";
    let found = false;
    // Walk down from the top of the plot until the tooltip names p = 0.
    for (let py = 16; py < 80 && !found; py += 2) {
      canvas.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: box.left + px,
          clientY: box.top + py,
          bubbles: true,
        }),
      );
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      found = tip().includes("Inf (p = 0)");
    }
    expect(found).toBe(true);
  });

  it("places gene labels inside the plot without overlap", async () => {
    const el = container(600, 400);
    // Twenty genes crowded into the two top corners, as in a strong DE result.
    const x = [
      ...spread(10, 5.8, 6, 3),
      ...spread(10, -6, -5.8, 4),
      ...spread(500, -2, 2, 5),
    ];
    const y = [...spread(20, 7.6, 7.8, 6), ...spread(500, 0, 3, 7)];
    const label = x.map((_, i) => `G${i}`);
    const v = createVolcano(el, {
      data: { columns: { x, y, label } },
      options: { labelTopN: 10 },
    });
    instances.push(v);

    await expect.poll(() => geneLabels(el).length, poll).toBeGreaterThan(0);
    const boxes = geneLabels(el).map((t) => t.getBBox());
    const plot = { left: 60, right: 600 - 18, top: 16, bottom: 400 - 46 };
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(plot.left - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(plot.right + 0.5);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i] as DOMRect;
        const b = boxes[j] as DOMRect;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it("paints the theme background, also when the theme changes later", () => {
    const el = container(600, 400);
    const v = createVolcano(el, {
      data: { columns: { x: spread(200, -3, 3, 8), y: spread(200, 0, 5, 9) } },
    });
    instances.push(v);
    // regl-scatterplot leaves its canvas transparent, so the colour sits on
    // the element behind it.
    expect(getComputedStyle(el).backgroundColor).toBe("rgb(255, 255, 255)");
    v.setOptions({ theme: { background: "#000000" } });
    expect(getComputedStyle(el).backgroundColor).toBe("rgb(0, 0, 0)");
    v.destroy();
    instances = [];
    expect(el.style.backgroundColor).toBe("");

    // A host's own background colour comes back after destroy.
    const host = container(600, 400);
    host.style.backgroundColor = "rgb(1, 2, 3)";
    createVolcano(host, { data: { columns: { x: [1], y: [1] } } }).destroy();
    expect(host.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });
});

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

describe("volcano gridlines", () => {
  // A dense block of large points, all called up, over log2 fold changes
  // from 1.5 to 4 and -log10 p from 2 to 10. The x axis runs from -4 to 4,
  // so the gridline at 3 runs through the block and the one at -2 through
  // empty space.
  function blockData() {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i <= 50; i += 1) {
      for (let j = 0; j <= 80; j += 1) {
        x.push(1.5 + (i / 50) * 2.5);
        y.push(2 + (j / 80) * 8);
      }
    }
    return { columns: { x, y } };
  }

  const options = {
    pointSize: 10,
    opacity: 1,
    labelTopN: 0,
    showThresholdLines: false,
  };
  const W = 500;

  async function ready(el: HTMLElement) {
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(10_000);
    await new Promise((r) => setTimeout(r, 300));
  }

  /** x of the gridline at an x tick, and a y in the block of points. */
  function gridAt(el: HTMLElement, value: string) {
    const label = Array.from(el.querySelectorAll("svg text")).find(
      (t) =>
        t.textContent === value && t.getAttribute("text-anchor") === "middle",
    ) as SVGTextElement;
    // In the element: the label's x is in the plot box, which sits inside
    // the theme padding.
    const e = el.getBoundingClientRect();
    const box = (
      el.querySelector("svg") as SVGSVGElement
    ).getBoundingClientRect();
    const plot = (
      el.querySelector("canvas") as HTMLCanvasElement
    ).getBoundingClientRect();
    return {
      x: Number(label.getAttribute("x")) + box.left - e.left,
      y: Math.round((plot.top + plot.bottom) / 2 - e.top),
    };
  }

  /**
   * How far the pixels on the gridline at 3, inside the block of points,
   * are from the points beside it; and how far the pixel on the gridline at
   * -2, in empty space, is from the grid colour.
   */
  async function gridOf(
    el: HTMLElement,
    png: Blob,
    gridColour = [0xe5, 0xe7, 0xeb],
  ) {
    const inside = gridAt(el, "3");
    const point = await pngPixel(png, W, inside.x + 3, inside.y);
    let across = 0;
    for (const dx of [-1, 0, 1]) {
      const p = await pngPixel(png, W, inside.x + dx, inside.y);
      across = Math.max(across, far(p, point));
    }
    const empty = gridAt(el, "-2");
    let grid = 255;
    for (const dx of [-1, 0, 1]) {
      const p = await pngPixel(png, W, empty.x + dx, empty.y);
      grid = Math.min(grid, far(p, gridColour));
    }
    return { across, grid, point };
  }

  it("draws the gridlines under the points, on screen and in the PNG", async () => {
    // Before the fix the gridlines were SVG lines over the canvas, so a
    // pale line crossed every point under it.
    const el = container(W, 400);
    const plot = createVolcano(el, { data: blockData(), options });
    instances.push(plot);
    await ready(el);
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const g = await gridOf(el, png as Blob);
      // The block of points is drawn, not the white page.
      expect(far(g.point, [255, 255, 255])).toBeGreaterThan(60);
      expect(g.across).toBeLessThan(12);
      expect(g.grid).toBeLessThan(12);
    }
  });

  it("draws the gridlines under the points in the dark theme", async () => {
    const el = container(W, 400);
    const plot = createVolcano(el, {
      data: blockData(),
      options: { ...options, theme: darkTheme },
    });
    instances.push(plot);
    await ready(el);
    // #0b0f19 and #1f2937: the dark background and its grid colour, which
    // differ by 30 in blue. A 1 px line between two pixels covers at least
    // half of one of them, so that pixel is within about 15 of the grid
    // colour, and more than 15 from the background.
    const background = [0x0b, 0x0f, 0x19];
    const grid = [0x1f, 0x29, 0x37];
    for (const png of [await screenPNG(el), await plot.exportPNG?.(1)]) {
      const g = await gridOf(el, png as Blob, grid);
      expect(far(g.point, background)).toBeGreaterThan(60);
      expect(g.across).toBeLessThan(12);
      expect(g.grid).toBeLessThan(0.6 * far(grid, background));
    }
  });

  /** The x of the x tick labels, joined, to see when the view moves. */
  function labelXs(el: HTMLElement): string {
    return Array.from(el.querySelectorAll('svg text[text-anchor="middle"]'))
      .filter((t) => Number.isFinite(Number(t.textContent)))
      .map((t) => t.getAttribute("x"))
      .join(",");
  }

  /**
   * Whether each gridline in the SVG under the points sits on a tick label:
   * a vertical line on the x of each x label, a horizontal line through the
   * middle of each y label.
   */
  function gridOnLabels(el: HTMLElement): void {
    const [under, over] = Array.from(el.querySelectorAll("svg"));
    const lines = Array.from((under as SVGSVGElement).querySelectorAll("line"));
    const labels = Array.from(
      (over as SVGSVGElement).querySelectorAll("text"),
    ).filter((t) => Number.isFinite(Number(t.textContent)));
    const at = (t: Element, name: string) => Number(t.getAttribute(name));
    const xs = labels
      .filter((t) => t.getAttribute("text-anchor") === "middle")
      .map((t) => at(t, "x"));
    // A y label's baseline is the rounded 0.35 of the 11 px label size below
    // its line.
    const ys = labels
      .filter((t) => t.getAttribute("text-anchor") === "end")
      .map((t) => at(t, "y") - 4);
    const vertical = lines
      .filter((l) => at(l, "x1") === at(l, "x2"))
      .map((l) => at(l, "x1"));
    const horizontal = lines
      .filter((l) => at(l, "y1") === at(l, "y2"))
      .map((l) => at(l, "y1"));
    expect(xs.length).toBeGreaterThan(2);
    expect(ys.length).toBeGreaterThan(2);
    // A y label is placed at its line plus 4 px, so taking the 4 px off
    // again can differ from the line in the last bit of a double.
    expect(vertical.length).toBe(xs.length);
    expect(horizontal.length).toBe(ys.length);
    for (const [i, x] of vertical.entries()) {
      expect(x).toBeCloseTo(xs[i] as number, 9);
    }
    for (const [i, y] of horizontal.entries()) {
      expect(y).toBeCloseTo(ys[i] as number, 9);
    }
  }

  it("keeps the gridlines on the tick labels after a zoom and a pan", async () => {
    const el = container(W, 400);
    instances.push(createVolcano(el, { data: blockData(), options }));
    // The points are drawn, and two more frames pass, so the scatterplot
    // has its listeners and its first view before the wheel turns.
    await ready(el);
    await frame();
    await frame();
    gridOnLabels(el);
    const start = labelXs(el);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

    // Zoom in at the centre with the mouse wheel, one step a frame: the
    // scatterplot moves its camera, and reports the new view, on its next
    // frame. A slow machine (CI) gets more time to redraw the axes.
    for (let i = 0; i < 5; i += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          clientX: centre.x,
          clientY: centre.y,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    await expect.poll(() => labelXs(el), slow).not.toBe(start);
    await new Promise((res) => setTimeout(res, 300));
    gridOnLabels(el);
    const zoomed = labelXs(el);

    // Drag the view 80 px to the right.
    const at = (dx: number) => ({
      clientX: centre.x + dx,
      clientY: centre.y,
      bubbles: true,
      buttons: 1,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0)));
    for (let s = 1; s <= 10; s += 1) {
      window.dispatchEvent(new MouseEvent("mousemove", at(8 * s)));
      await new Promise((res) => setTimeout(res, 10));
    }
    window.dispatchEvent(new MouseEvent("mouseup", at(80)));
    await expect.poll(() => labelXs(el), slow).not.toBe(zoomed);
    await new Promise((res) => setTimeout(res, 300));
    gridOnLabels(el);
  });

  it("keeps the gridlines under the points in the SVG export", async () => {
    const el = container(W, 400);
    const plot = createVolcano(el, { data: blockData(), options });
    instances.push(plot);
    await ready(el);
    const doc = new DOMParser().parseFromString(
      plot.exportSVG?.() ?? "",
      "image/svg+xml",
    );
    const nodes = Array.from(doc.documentElement.children);
    const image = nodes.findIndex((n) => n.localName === "image");
    const isGrid = (n: Element) => n.getAttribute("stroke") === "#e5e7eb";
    expect(image).toBeGreaterThan(0);
    expect(nodes.slice(0, image).filter(isGrid).length).toBeGreaterThan(4);
    expect(nodes.slice(image + 1).filter(isGrid)).toEqual([]);
  });

  it("removes both SVG layers on destroy", () => {
    const el = container(W, 400);
    createVolcano(el, { data: blockData(), options }).destroy();
    expect(el.querySelectorAll("svg").length).toBe(0);
  });
});
