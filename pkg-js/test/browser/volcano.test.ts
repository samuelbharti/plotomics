import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createVolcano } from "../../src/components/volcano.js";
import { type PlotomicsInstance, darkTheme } from "../../src/core/index.js";
import {
  HOST_BACKGROUNDS,
  canvasPNG,
  drawnPixels,
  gradientPixels,
  type MarkBox,
  markBox,
} from "./helpers.js";

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

  it("paints the theme background, also when the theme changes later", async () => {
    const el = container(600, 400);
    const v = createVolcano(el, {
      data: { columns: { x: spread(200, -3, 3, 8), y: spread(200, 0, 5, 9) } },
    });
    instances.push(v);
    // regl-scatterplot leaves its canvas transparent; the plot's frame
    // paints the colour behind it, over the whole element, here in the
    // theme padding.
    expect(await pngPixel(await screenPNG(el), 600, 3, 3)).toEqual([
      255, 255, 255,
    ]);
    v.setOptions({ theme: { background: "#000000" } });
    expect(await pngPixel(await screenPNG(el), 600, 3, 3)).toEqual([0, 0, 0]);
    // The element's own background is left as it is.
    expect(el.style.backgroundColor).toBe("");
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

describe("volcano tick labels", () => {
  /** Numeric tick labels with `anchor`, in order along their axis. */
  function axisLabels(el: HTMLElement, anchor: string) {
    const x = anchor === "middle";
    return (
      Array.from(
        el.querySelectorAll(`svg text[text-anchor="${anchor}"]`),
      ) as SVGTextElement[]
    )
      .filter((t) => /^-?[\d.]+$/.test(t.textContent ?? ""))
      .map((t) => ({
        text: t.textContent ?? "",
        at: Number(t.getAttribute(x ? "x" : "y")) * (x ? 1 : -1),
      }))
      .sort((a, b) => a.at - b.at);
  }

  /**
   * Labels that each state a different value, one step from the next, at
   * one spacing along the axis.
   */
  function expectExact(labels: { text: string; at: number }[]) {
    expect(labels.length).toBeGreaterThan(1);
    const values = labels.map((l) => Number(l.text));
    expect(new Set(labels.map((l) => l.text)).size).toBe(labels.length);
    const step = (values[1] as number) - (values[0] as number);
    const gap = (labels[1]?.at as number) - (labels[0]?.at as number);
    expect(step).toBeGreaterThan(0);
    for (let i = 1; i < labels.length; i += 1) {
      expect((values[i] as number) - (values[i - 1] as number)).toBeCloseTo(
        step,
        9,
      );
      expect(
        (labels[i]?.at as number) - (labels[i - 1]?.at as number),
      ).toBeCloseTo(gap, 0);
    }
  }

  it("labels a narrow range once per tick, in one format", async () => {
    // Before the fix the y axis over 0 to 0.03 read "0, 5.0e-3, 0.01,
    // 0.01, 0.02, 0.03, 0.03", and an x axis over -0.03 to 0.03 also
    // repeated its labels.
    const n = 40;
    const narrowY = container(800, 480);
    instances.push(
      createVolcano(narrowY, {
        data: {
          columns: {
            x: Array.from({ length: n }, (_, i) => -0.5 + i / n),
            y: Array.from({ length: n }, (_, i) => (i / n) * 0.03),
          },
        },
        // The y axis reaches a threshold line it draws, here at 1.3.
        options: { labelTopN: 0, showThresholdLines: false },
      }),
    );
    const narrowX = container(800, 480);
    instances.push(
      createVolcano(narrowX, {
        data: {
          columns: {
            x: Array.from({ length: n }, (_, i) => -0.03 + (i / n) * 0.06),
            y: Array.from({ length: n }, (_, i) => i / 4),
          },
        },
        options: { labelTopN: 0 },
      }),
    );
    await expect
      .poll(() => axisLabels(narrowY, "end").map((l) => l.text), poll)
      .toEqual(["0.000", "0.005", "0.010", "0.015", "0.020", "0.025", "0.030"]);
    expectExact(axisLabels(narrowY, "end"));
    await expect
      .poll(() => axisLabels(narrowX, "middle").map((l) => l.text), poll)
      .toEqual(["-0.03", "-0.02", "-0.01", "0.00", "0.01", "0.02", "0.03"]);
    expectExact(axisLabels(narrowX, "middle"));
  });

  it("keeps the labels exact after a deep zoom", async () => {
    // 20,000 genes, zoomed in with 20 wheel steps. Before the fix the x
    // axis read "-0.01, -0.01, -5.0e-3, 0, 5.0e-3, 0.01, 0.01".
    let s = 3;
    const r = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const n = 20000;
    const x = Array.from(
      { length: n },
      () => (r() - 0.5) * 2 * (r() < 0.05 ? 6 : 0.6),
    );
    const y = Array.from(
      { length: n },
      () => -Math.log10(Math.max(1e-60, r() ** (r() < 0.03 ? 40 : 1))),
    );
    const el = container(800, 480);
    instances.push(
      createVolcano(el, {
        data: { columns: { x, y } },
        options: { labelTopN: 0 },
      }),
    );
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(1000);
    await frame();
    await frame();
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    for (let i = 0; i < 20; i += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height * 0.95,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    // The x axis has zoomed to a step of a hundredth or less.
    await expect
      .poll(() => {
        const l = axisLabels(el, "middle");
        return Math.abs(Number(l[1]?.text) - Number(l[0]?.text));
      }, slow)
      .toBeLessThanOrEqual(0.01);
    await new Promise((res) => setTimeout(res, 300));
    expectExact(axisLabels(el, "middle"));
    expectExact(axisLabels(el, "end"));
  });
});

describe("volcano tick labels deep in a zoom", () => {
  it("keeps every tick label clear of the axis titles and inside the plot", async () => {
    // The 20,000 genes of the zoom test above, zoomed 40 and then 60 wheel
    // steps. Before the fix the exact y labels, such as "0.85630" and
    // "0.8562928", ran under the y title, as the margin held about five
    // characters.
    let s = 3;
    const r = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const n = 20000;
    const x = Array.from(
      { length: n },
      () => (r() - 0.5) * 2 * (r() < 0.05 ? 6 : 0.6),
    );
    const y = Array.from(
      { length: n },
      () => -Math.log10(Math.max(1e-60, r() ** (r() < 0.03 ? 40 : 1))),
    );
    const el = container(800, 480);
    instances.push(
      createVolcano(el, {
        data: { columns: { x, y } },
        options: { labelTopN: 0 },
      }),
    );
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(1000);
    await frame();
    await frame();

    const all = () =>
      Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
    const numeric = (anchor: string) =>
      all().filter(
        (t) =>
          t.getAttribute("text-anchor") === anchor &&
          /^-?[\d.]+(e[+-]\d+)?$/.test(t.textContent ?? ""),
      );
    const titleBox = (label: string) =>
      (
        all().find((t) => t.textContent === label) as SVGTextElement
      ).getBoundingClientRect();
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;

    let steps = 0;
    for (const target of [40, 60]) {
      for (; steps < target; steps += 1) {
        const box = (
          el.querySelector("canvas") as HTMLCanvasElement
        ).getBoundingClientRect();
        (el.querySelector("canvas") as HTMLCanvasElement).dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -120,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height * 0.95,
            bubbles: true,
            cancelable: true,
          }),
        );
        await frame();
      }
      // The y labels carry six or more characters at this zoom.
      await expect
        .poll(
          () =>
            Math.max(
              0,
              ...numeric("end").map((t) => t.textContent?.length ?? 0),
            ),
          slow,
        )
        .toBeGreaterThanOrEqual(target === 40 ? 6 : 8);
      await new Promise((res) => setTimeout(res, 300));
      const yTitle = titleBox("-log10 p-value");
      const xTitle = titleBox("log2 fold change");
      const plot = (
        el.querySelector("svg") as SVGSVGElement
      ).getBoundingClientRect();
      const ys = numeric("end");
      const xs = numeric("middle");
      expect(ys.length, `${target} steps`).toBeGreaterThan(1);
      expect(xs.length, `${target} steps`).toBeGreaterThan(1);
      for (const t of [...ys, ...xs]) {
        const b = t.getBoundingClientRect();
        const what = `${t.textContent} after ${target} steps`;
        expect(overlap(b, yTitle), what).toBe(false);
        expect(overlap(b, xTitle), what).toBe(false);
        expect(b.left, what).toBeGreaterThanOrEqual(plot.left);
        expect(b.right, what).toBeLessThanOrEqual(plot.right);
      }
      // The labels stay exact: none repeats.
      const values = ys.map((t) => Number(t.textContent)).sort((a, b) => a - b);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("volcano zoomed past the precision of its numbers", () => {
  it("draws no tick label off its axis", async () => {
    // At 250 px, about 70 wheel steps leave the view no width. Before the
    // fix its one tick had no place and its label went to the corner.
    const n = 2000;
    let s = 3;
    const r = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const x = Array.from({ length: n }, () => (r() - 0.5) * 4);
    const y = Array.from({ length: n }, () => r() * 10);
    const el = container(250, 300);
    instances.push(
      createVolcano(el, {
        data: { columns: { x, y } },
        options: { labelTopN: 0 },
      }),
    );
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(100);
    await frame();
    await frame();
    for (let i = 0; i < 80; i += 1) {
      const canvas = el.querySelector("canvas") as HTMLCanvasElement;
      const b = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          clientX: b.left + b.width / 2,
          clientY: b.top + b.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    await new Promise((res) => setTimeout(res, 300));
    const plot = (
      el.querySelector("svg") as SVGSVGElement
    ).getBoundingClientRect();
    for (const t of Array.from(el.querySelectorAll("svg text"))) {
      expect(t.getAttribute("x")).not.toBe("NaN");
      expect(t.getAttribute("y")).not.toBe("NaN");
      const b = t.getBoundingClientRect();
      expect(b.left, t.textContent ?? "").toBeGreaterThanOrEqual(plot.left);
      expect(b.top, t.textContent ?? "").toBeGreaterThanOrEqual(plot.top);
    }
  });
});

describe("volcano p = 0 and the threshold line", () => {
  /** Where the up and down points, and the grey ones, sit on the canvas. */
  async function pointRows(el: HTMLElement) {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const png = (await canvasPNG(el)) as Blob;
    const bitmap = await createImageBitmap(png);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const ratio = c.height / canvas.clientHeight;
    // Rows in CSS px from the top of the canvas.
    const hit = { top: Number.POSITIVE_INFINITY, bottom: -1 };
    const ns = { top: Number.POSITIVE_INFINITY, bottom: -1 };
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]] as number[];
      if ((a as number) < 128) continue;
      const y = Math.floor(i / 4 / c.width);
      // Up points are orange and down points blue; the others grey, on
      // the white background.
      const box =
        Math.abs((r as number) - (b as number)) > 60
          ? hit
          : Math.abs((r as number) - (g as number)) < 20 && (r as number) < 230
            ? ns
            : null;
      if (!box) continue;
      box.top = Math.min(box.top, y / ratio);
      box.bottom = Math.max(box.bottom, (y + 1) / ratio);
    }
    return { hit, ns };
  }

  /** The y of the dashed threshold line from the top of the point canvas. */
  function thresholdY(el: HTMLElement): number | null {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const line = Array.from(
      el.querySelectorAll("svg line[stroke-dasharray]"),
    ).find((l) => l.getAttribute("y1") === l.getAttribute("y2"));
    if (!line) return null;
    return (
      Number(line.getAttribute("y1")) - Number.parseFloat(canvas.style.top)
    );
  }

  async function draw(y: number[]) {
    const el = container(800, 480);
    instances.push(
      createVolcano(el, {
        data: { columns: { x: [2, -2, 3], y, label: ["a", "b", "c"] } },
      }),
    );
    await expect
      .poll(async () => (await pointRows(el)).hit.bottom, poll)
      .toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    return { rows: await pointRows(el), line: thresholdY(el) };
  }

  it("draws p = 0 above the threshold line when every gene has it", async () => {
    const { rows, line } = await draw([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]);
    // Before the fix the genes sat at y 1.0, under the line at 1.3.
    expect(line).not.toBeNull();
    expect(rows.hit.bottom).toBeLessThan(line as number);
  });

  it("keeps room above p = 0 next to a high finite y", async () => {
    const { rows } = await draw([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      20,
    ]);
    // Before the fix p = 0 sat at 21 with the axis top at 21.04, so the
    // top of the plot cut the points.
    expect(rows.hit.top).toBeGreaterThan(6);
  });

  it("keeps the threshold line in view, between p = 0 and the finite genes", async () => {
    const { rows, line } = await draw([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      0.5,
    ]);
    // Before the fix the y axis ended at about 0.54, so the line at 1.3
    // was out of view and p = 0 sat at about 0.52.
    expect(line).not.toBeNull();
    expect(rows.hit.bottom).toBeLessThan(line as number);
    expect(rows.ns.top).toBeGreaterThan(line as number);
  });
});

describe("volcano tooltip after the view moves", () => {
  /**
   * A volcano whose middle gene sits at the centre of the plot (x is
   * centred on 0, and y runs from 0 to 8 with the same room above and
   * below), with the tooltip naming it.
   */
  async function hovered() {
    const el = container(800, 400);
    instances.push(
      createVolcano(el, {
        data: {
          columns: { x: [-3, 0, 3], y: [0, 4, 8], label: ["G1", "G2", "G3"] },
        },
        options: { labelTopN: 0, pointSize: 8 },
      }),
    );
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(0);
    await frame();
    await frame();
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const centre = {
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    const tip = () =>
      Array.from(el.children).find((c) => c.tagName === "DIV") as HTMLElement;
    const move = async () => {
      canvas.dispatchEvent(
        new MouseEvent("mousemove", { ...centre, bubbles: true }),
      );
      await frame();
      await frame();
    };
    await move();
    expect(tip().style.opacity).toBe("1");
    expect(tip().textContent).toContain("G2");
    return { el, canvas, centre, tip, move };
  }

  /** Press at the centre, drag 80 px right and 40 px down, and let go. */
  async function drag(
    canvas: HTMLCanvasElement,
    centre: { clientX: number; clientY: number },
    extra: MouseEventInit = {},
  ) {
    const at = (dx: number) => ({
      clientX: centre.clientX + dx,
      clientY: centre.clientY + dx / 2,
      bubbles: true,
      buttons: 1,
      ...extra,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0)));
    // The moves go to the canvas under the pointer, as a browser sends
    // them, and reach the window the scatterplot listens on.
    for (let k = 1; k <= 10; k += 1) {
      canvas.dispatchEvent(new MouseEvent("mousemove", at(8 * k)));
      await new Promise((res) => setTimeout(res, 20));
    }
    canvas.dispatchEvent(new MouseEvent("mouseup", { ...at(80), buttons: 0 }));
  }

  it("hides the tooltip after a zoom, and shows it again on a move", async () => {
    const { el, canvas, centre, tip, move } = await hovered();
    const start = yTicks(el).join(",");
    for (let i = 0; i < 5; i += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          ...centre,
          deltaY: -120,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    await expect.poll(() => yTicks(el).join(","), slow).not.toBe(start);
    await new Promise((res) => setTimeout(res, 300));
    // Before the fix the tooltip stayed until the pointer moved.
    expect(tip().style.opacity).not.toBe("1");
    // The gene is still under the pointer, and a move names it again. A
    // slow machine can still be settling the view, which hides it again,
    // so the move is made until the tooltip stays.
    await expect
      .poll(async () => {
        await move();
        return tip().style.opacity;
      }, poll)
      .toBe("1");
    expect(tip().textContent).toContain("G2");
  });

  it("hides the tooltip after a drag pan, and shows it again on a move", async () => {
    const { el, canvas, centre, tip } = await hovered();
    const start = yTicks(el).join(",");
    await drag(canvas, centre);
    await expect.poll(() => yTicks(el).join(","), slow).not.toBe(start);
    await new Promise((res) => setTimeout(res, 300));
    // Before the fix the tooltip stayed where the drag began, naming G2.
    expect(tip().style.opacity).not.toBe("1");
    // The gene moved with the drag, to where it ended, and a move there
    // names it again, once the view has settled.
    await expect
      .poll(async () => {
        canvas.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: centre.clientX + 80,
            clientY: centre.clientY + 40,
            bubbles: true,
          }),
        );
        await frame();
        await frame();
        return tip().style.opacity;
      }, poll)
      .toBe("1");
    expect(tip().textContent).toContain("G2");
  });

  it("hides the tooltip when a lasso starts", async () => {
    const { canvas, centre, tip } = await hovered();
    // Shift and a drag draw a lasso, which stops the hover.
    await drag(canvas, centre, { shiftKey: true });
    await new Promise((res) => setTimeout(res, 300));
    // Before the fix the tooltip stayed through the lasso.
    expect(tip().style.opacity).not.toBe("1");
  });
});

describe("volcano refit for a new threshold", () => {
  /** The highest y tick. */
  const top = (el: HTMLElement) => Math.max(...yTicks(el));

  it("fits the threshold line at the start view and keeps a zoomed view", async () => {
    const el = container(800, 400);
    const v = createVolcano(el, {
      data: { columns: { x: [-2, 1, 2], y: [0.1, 0.3, 0.5] } },
      options: { labelTopN: 0 },
    });
    instances.push(v);
    // The line at 1.3 is in view.
    await expect.poll(() => top(el), slow).toBeGreaterThanOrEqual(1.2);
    // Hidden lines leave the axis to the points.
    v.setOptions({ showThresholdLines: false });
    await expect.poll(() => top(el), slow).toBeLessThan(0.7);
    v.setOptions({ showThresholdLines: true });
    await expect.poll(() => top(el), slow).toBeGreaterThanOrEqual(1.2);
    // Before the fix a new threshold kept the old range, and its line at 3
    // was out of view.
    v.setOptions({ pThreshold: 0.001 });
    await expect.poll(() => top(el), slow).toBeGreaterThanOrEqual(3);

    // A view the person zoomed stays as it is.
    await frame();
    await frame();
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const start = yTicks(el).join(",");
    for (let i = 0; i < 4; i += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height * 0.9,
          deltaY: -120,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    await expect.poll(() => yTicks(el).join(","), slow).not.toBe(start);
    await new Promise((res) => setTimeout(res, 300));
    const zoomed = yTicks(el).join(",");
    v.setOptions({ pThreshold: 0.05 });
    await new Promise((res) => setTimeout(res, 300));
    expect(yTicks(el).join(",")).toBe(zoomed);
    v.setOptions({ showThresholdLines: false });
    await new Promise((res) => setTimeout(res, 300));
    expect(yTicks(el).join(",")).toBe(zoomed);
  });
});

describe("volcano background", () => {
  it("covers the element's own background, and leaves it as it was", async () => {
    for (const [name, setup] of HOST_BACKGROUNDS) {
      const el = container(600, 400);
      setup(el);
      const style = getComputedStyle(el);
      const [image, colour] = [style.backgroundImage, style.backgroundColor];
      const v = createVolcano(el, {
        data: { columns: { x: [-0.5, 0.5], y: [0.5, 1] } },
        options: { labelTopN: 0 },
      });
      await expect
        .poll(async () => {
          const png = await canvasPNG(el);
          return png ? drawnPixels(png) : 0;
        }, poll)
        .toBeGreaterThan(0);
      // The plot's frame paints the theme background over the element.
      expect(await gradientPixels(el), name).toBeLessThan(50);
      v.destroy();
      // Before the fix a var() shorthand followed by a colour came back
      // with no image: the browser reads such a shorthand back as empty.
      expect(style.backgroundImage, name).toBe(image);
      expect(style.backgroundColor, name).toBe(colour);
      el.remove();
    }
  });
});

describe("volcano large points", () => {
  it("fits a new point size at the start view, and keeps a zoomed view", async () => {
    const el = container(600, 240);
    const v = createVolcano(el, {
      data: { columns: { x: [2, -2, 3], y: [5, 10, 20] } },
      options: { pointSize: 3, labelTopN: 0 },
    });
    instances.push(v);
    await expect
      .poll(async () => {
        const png = await canvasPNG(el);
        return png ? drawnPixels(png) : 0;
      }, poll)
      .toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    v.setOptions({ pointSize: 30 });
    await new Promise((r) => setTimeout(r, 500));
    const box = (await markBox((await canvasPNG(el)) as Blob)) as MarkBox;
    // Before the fix the plot kept the room of 3 px points, and the 30 px
    // points ran to the edges.
    expect(box.top).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThan(1);
    expect(box.right).toBeLessThan(1);

    // A view the person zoomed stays as it is.
    await frame();
    await frame();
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const start = yTicks(el).join(",");
    for (let i = 0; i < 4; i += 1) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          deltaY: -120,
          bubbles: true,
          cancelable: true,
        }),
      );
      await frame();
    }
    await expect.poll(() => yTicks(el).join(","), slow).not.toBe(start);
    await new Promise((res) => setTimeout(res, 300));
    const zoomed = yTicks(el).join(",");
    v.setOptions({ pointSize: 10 });
    await new Promise((res) => setTimeout(res, 300));
    expect(yTicks(el).join(",")).toBe(zoomed);
  });

  it("keeps a large point inside the plot at every side", async () => {
    const inf = Number.POSITIVE_INFINITY;
    for (const y of [
      [inf, inf, 20],
      [5, 10, 20],
    ]) {
      const el = container(600, 240);
      instances.push(
        createVolcano(el, {
          data: { columns: { x: [2, -2, 3], y } },
          options: { pointSize: 20, labelTopN: 0 },
        }),
      );
      await expect
        .poll(async () => {
          const png = await canvasPNG(el);
          return png ? drawnPixels(png) : 0;
        }, poll)
        .toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 300));
      const box = (await markBox((await canvasPNG(el)) as Blob)) as MarkBox;
      // Before the fix the top point touched row 0: the 4% of room above
      // it was less than its radius of 10 px.
      const at = JSON.stringify(y.map(String));
      expect(box.top, at).toBeGreaterThan(0);
      expect(box.left, at).toBeGreaterThan(0);
      expect(box.bottom, at).toBeLessThan(1);
      expect(box.right, at).toBeLessThan(1);
    }
  });
});
