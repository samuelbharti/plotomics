import { afterEach, describe, expect, it } from "vitest";
import { createVolcano } from "../../src/components/volcano.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { canvasPNG, type MarkBox, markBox } from "./helpers.js";

// Volcano behaviour that needs a real browser: framing with p = 0 and missing
// values, label placement, and a theme change reaching the canvas.

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
    const box = el.getBoundingClientRect();
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
