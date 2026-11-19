import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import {
  type PlotomicsInstance,
  createTooltip,
  defaultTheme,
} from "../../src/core/index.js";

// A tooltip stays inside its widget: it flips to the other side of the
// pointer near the right and bottom edges, and long text wraps. Before the
// fix it always sat right of and below the pointer on one line, and ran up
// to 248 px past the edge of a heatmap with long names, which gave the page
// a horizontal scroll.

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

function container(width: number, height: number, css = "") {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;margin:30px;${css}`;
  document.body.appendChild(el);
  return el;
}

/** The tooltip of a plot: the first div in its element. */
const tipOf = (el: HTMLElement) =>
  Array.from(el.children).find((c) => c.tagName === "DIV") as HTMLElement;

/** How far `inner` runs past each side of the padding box of `outer`. */
function overrun(inner: Element, outer: HTMLElement) {
  const r = inner.getBoundingClientRect();
  const o = outer.getBoundingClientRect();
  const left = o.left + outer.clientLeft;
  const top = o.top + outer.clientTop;
  return Math.max(
    0,
    left - r.left,
    top - r.top,
    r.right - (left + outer.clientWidth),
    r.bottom - (top + outer.clientHeight),
  );
}

describe("createTooltip", () => {
  it("sits right of and below the pointer where it fits", () => {
    const el = container(400, 300);
    const tip = createTooltip(el, defaultTheme);
    const box = el.getBoundingClientRect();
    tip.show("<b>TP53</b><br/>value 1.2", box.left + 50, box.top + 40);
    const r = tipOf(el).getBoundingClientRect();
    expect(r.left).toBeCloseTo(box.left + 62, 0);
    expect(r.top).toBeCloseTo(box.top + 52, 0);
    tip.destroy();
  });

  it("flips left of and above the pointer near the right and bottom edges", () => {
    const el = container(400, 300);
    const tip = createTooltip(el, defaultTheme);
    const box = el.getBoundingClientRect();
    const x = box.right - 5;
    const y = box.bottom - 5;
    tip.show("<b>TP53</b><br/>value 1.2", x, y);
    const node = tipOf(el);
    const r = node.getBoundingClientRect();
    expect(overrun(node, el)).toBe(0);
    expect(r.right).toBeCloseTo(x - 12, 0);
    expect(r.bottom).toBeCloseTo(y - 12, 0);
    tip.destroy();
  });

  it("wraps long text inside 320 px and inside the widget", () => {
    const name = "HALLMARK_OXIDATIVE_PHOSPHORYLATION_".repeat(4);
    for (const width of [600, 200]) {
      const el = container(width, 300);
      const tip = createTooltip(el, defaultTheme);
      const box = el.getBoundingClientRect();
      tip.show(`<b>${name}</b> x <b>${name}</b>`, box.right - 20, box.top + 20);
      const node = tipOf(el);
      expect(node.offsetWidth).toBeLessThanOrEqual(Math.min(320, width));
      // No text runs past the edge of the tooltip.
      expect(node.scrollWidth).toBeLessThanOrEqual(node.clientWidth);
      expect(overrun(node, el)).toBe(0);
      tip.destroy();
    }
  });

  it("stays inside a container with a CSS border", () => {
    const el = container(300, 200, "border:9px solid #888;");
    const tip = createTooltip(el, defaultTheme);
    const box = el.getBoundingClientRect();
    tip.show("<b>CDKN2A</b><br/>value 0.4", box.right - 12, box.bottom - 12);
    expect(overrun(tipOf(el), el)).toBe(0);
    tip.show("<b>CDKN2A</b><br/>value 0.4", box.left + 20, box.top + 20);
    // 12 px from the pointer, measured inside the border too.
    expect(tipOf(el).getBoundingClientRect().left).toBeCloseTo(
      box.left + 32,
      0,
    );
    tip.destroy();
  });
});

describe("a heatmap tooltip with long names", () => {
  it("stays inside the widget, and the page gets no scroll", () => {
    const long = (s: string, i: number) =>
      `${s}_${String(i).padStart(2, "0")}_${"ENSG00000141510_TUMOR_PROTEIN_P53_".repeat(3)}`;
    const nrows = 12;
    const ncols = 8;
    const el = container(800, 480);
    instances.push(
      createHeatmap(el, {
        data: {
          columns: {
            values: Float64Array.from(
              { length: nrows * ncols },
              (_, k) => k % 7,
            ),
          },
          meta: {
            nrows,
            ncols,
            rowLabels: Array.from({ length: nrows }, (_, i) => long("gene", i)),
            colLabels: Array.from({ length: ncols }, (_, i) =>
              long("sample", i),
            ),
          },
        },
      }),
    );
    const pageWidth = document.documentElement.scrollWidth;
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const c = canvas.getBoundingClientRect();
    const node = tipOf(el);
    let shown = 0;
    let worst = 0;
    for (const fx of [0.05, 0.5, 0.8, 0.97]) {
      for (const fy of [0.05, 0.5, 0.97]) {
        const at = {
          clientX: c.left + fx * c.width,
          clientY: c.top + fy * c.height,
          bubbles: true,
        };
        canvas.dispatchEvent(new MouseEvent("mousemove", at));
        if (node.style.opacity !== "1") continue;
        shown += 1;
        worst = Math.max(worst, overrun(node, el));
        expect(document.documentElement.scrollWidth).toBe(pageWidth);
      }
    }
    expect(shown).toBeGreaterThan(6);
    expect(worst).toBe(0);
  });
});
