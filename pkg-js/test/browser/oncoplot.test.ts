import { afterEach, describe, expect, it } from "vitest";
import { createOncoplot } from "../../src/components/oncoplot.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

const CLASSES = [
  "Missense_Mutation",
  "Nonsense_Mutation",
  "Frame_Shift_Del",
  "Frame_Shift_Ins",
  "Splice_Site",
  "In_Frame_Del",
  "Amplification",
  "Deep_Deletion",
];

/** Two genes by three samples, with a Subtype strip. */
function smallData(tmb = [2, 1, 1]) {
  return {
    columns: {
      codes: [1, 0, 2, 0, 3, 0],
      tmb,
      freq: [66.7, 33.3],
    },
    meta: {
      nrows: 2,
      ncols: 3,
      genes: ["TP53", "KRAS"],
      samples: ["S1", "S2", "S3"],
      classes: CLASSES,
      annotations: [
        { name: "Subtype", levels: ["Basal", "LumA"], codes: [1, 0, -1] },
        { name: "Stage", levels: ["I", "II"], codes: [0, 1, 1] },
      ],
    },
  };
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
  return (
    Array.from(el.children).find((c) => c.tagName === "DIV")?.textContent ?? ""
  );
}

function svgTexts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("oncoplot in a browser", () => {
  it("wraps a long legend inside the element", () => {
    const el = container(500, 400);
    instances.push(createOncoplot(el, { data: smallData() }));
    const legend = svgTexts(el).filter((t) =>
      CLASSES.includes(t.textContent ?? ""),
    );
    expect(legend).toHaveLength(CLASSES.length);
    const rows = new Set(legend.map((t) => t.getAttribute("y")));
    expect(rows.size).toBeGreaterThan(1);
    for (const t of legend) {
      const b = t.getBBox();
      expect(b.x + b.width).toBeLessThanOrEqual(500);
      expect(b.y + b.height).toBeLessThanOrEqual(400);
    }
  });

  it("keys each annotation strip and names its value on hover", () => {
    const el = container(600, 400);
    const plot = createOncoplot(el, { data: smallData() });
    instances.push(plot);
    const heading = svgTexts(el).find((t) => t.textContent === "Subtype:");
    expect(heading).toBeDefined();
    expect(svgTexts(el).some((t) => t.textContent === "Basal")).toBe(true);
    expect(svgTexts(el).some((t) => t.textContent === "LumA")).toBe(true);

    // The strip sits under the grid; the grid's bottom is the last gene row.
    const kras = svgTexts(el).find(
      (t) => t.textContent === "KRAS",
    ) as SVGTextElement;
    const tp53 = svgTexts(el).find(
      (t) => t.textContent === "TP53",
    ) as SVGTextElement;
    const rowH =
      Number(kras.getAttribute("y")) - Number(tp53.getAttribute("y"));
    const gridBottom = Number(kras.getAttribute("y")) + rowH / 2;
    const left = Number(tp53.getAttribute("x")) + 6;
    // The swatches beside "Basal" and "LumA" give the strip's colours.
    const swatch = (label: string) => {
      const t = svgTexts(el).find(
        (n) => n.textContent === label,
      ) as SVGTextElement;
      const x = Number(t.getAttribute("x"));
      const rect = Array.from(el.querySelectorAll("svg rect")).find(
        (r) => Math.abs(Number(r.getAttribute("x")) + 13 - x) < 0.5,
      );
      return rect?.getAttribute("fill");
    };
    // Strips use their own palette, and the second strip continues it, so no
    // level shares a colour with a class or with the first strip.
    const classColours = CLASSES.map(swatch);
    const levels = ["Basal", "LumA", "I", "II"].map(swatch);
    expect(levels.every((c) => c !== undefined)).toBe(true);
    expect(new Set(levels).size).toBe(4);
    for (const c of levels) expect(classColours).not.toContain(c);

    // Hover the second sample's cell in the strip: S2 is Basal (code 0).
    const gridW = 600 - left - 96;
    const x = left + gridW * (1.5 / 3);
    const tip = hoverAt(el, x, gridBottom + 6 + 6);
    expect(tip).toContain("S2");
    expect(tip).toContain("Subtype: Basal");
    // S3 has no value.
    expect(hoverAt(el, left + gridW * (2.5 / 3), gridBottom + 12)).toContain(
      "Subtype: NA",
    );
  });

  it("prints a float burden maximum without float32 noise", () => {
    const el = container();
    const tmb = Float32Array.from([12.3, 1, 2]);
    instances.push(createOncoplot(el, { data: smallData(Array.from(tmb)) }));
    const labels = svgTexts(el).map((t) => t.textContent);
    expect(labels).toContain("12.3");
    expect(labels.some((s) => s?.startsWith("12.30000"))).toBe(false);
  });

  it("labels every k-th gene when rows are too short for all", () => {
    const n = 120;
    const genes = Array.from({ length: n }, (_, i) => `G${i}`);
    const el = container(600, 400);
    instances.push(
      createOncoplot(el, {
        data: {
          columns: {
            codes: new Array(n * 3).fill(1),
            tmb: [n, n, n],
            freq: new Array(n).fill(100),
          },
          meta: {
            nrows: n,
            ncols: 3,
            genes,
            samples: ["S1", "S2", "S3"],
            classes: ["Missense"],
          },
        },
      }),
    );
    const shown = svgTexts(el).filter((t) =>
      /^G\d+$/.test(t.textContent ?? ""),
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(n);
    expect(shown[0]?.textContent).toBe("G0");
    // Neighbouring labels keep a gap of at least 9 px.
    const ys = shown.map((t) => Number(t.getAttribute("y")));
    for (let i = 1; i < ys.length; i += 1) {
      expect((ys[i] as number) - (ys[i - 1] as number)).toBeGreaterThanOrEqual(
        9,
      );
    }
  });
});
