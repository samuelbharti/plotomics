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

/** Hover at (x, y) of the plot, which starts inside the theme padding. */
function hoverAt(el: HTMLElement, x: number, y: number): string {
  const r = (el.querySelector("svg") as SVGSVGElement).getBoundingClientRect();
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
    // The grid starts after the 96 px gene label column.
    const left = 96;
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

  it("draws a Multi-hit cell in dark grey without given colours", () => {
    const el = container(600, 400);
    const data = smallData();
    // Eight classes fill the palette; Multi-hit comes ninth.
    data.meta.classes = [...CLASSES, "Multi-hit"];
    data.columns.codes = [9, 1, 9, 1, 9, 1];
    instances.push(createOncoplot(el, { data }));
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    const tp53 = svgTexts(el).find(
      (t) => t.textContent === "TP53",
    ) as SVGTextElement;
    // Centre of the first cell: TP53 in S1.
    const left = 96;
    const gridW = 600 - left - 96;
    const x = left + gridW / 6;
    const y = Number(tp53.getAttribute("y")) - 3;
    const [r, g, b] = ctx.getImageData(
      Math.floor(x * ratio),
      Math.floor(y * ratio),
      1,
      1,
    ).data;
    expect([r, g, b]).toEqual([0x3a, 0x3a, 0x3a]);
  });

  it("keeps a legend with hundreds of levels inside the element", () => {
    const n = 1000;
    const samples = Array.from({ length: n }, (_, i) => `S${i}`);
    const genes = Array.from({ length: 20 }, (_, i) => `G${i}`);
    const el = container(800, 560);
    instances.push(
      createOncoplot(el, {
        data: {
          columns: {
            codes: new Array(20 * n).fill(1),
            tmb: new Array(n).fill(20),
            freq: new Array(20).fill(100),
          },
          meta: {
            nrows: 20,
            ncols: n,
            genes,
            samples,
            classes: ["Missense"],
            annotations: [
              {
                name: "Age",
                levels: samples.map((_, i) => String(30 + i)),
                codes: samples.map((_, i) => i),
              },
            ],
          },
        },
      }),
    );
    for (const t of svgTexts(el))
      expect(t.getBBox().y).toBeGreaterThanOrEqual(0);
    // Every gene keeps its label, so the grid kept its height.
    const shown = svgTexts(el).filter((t) =>
      /^G\d+$/.test(t.textContent ?? ""),
    );
    expect(shown).toHaveLength(20);
    expect(
      svgTexts(el).some((t) => /^\+\d+ more$/.test(t.textContent ?? "")),
    ).toBe(true);
  });

  it("prints a small float burden maximum without rounding it to 0", () => {
    const el = container();
    const tmb = Float32Array.from([0.004, 0.002, 0.001]);
    instances.push(createOncoplot(el, { data: smallData(Array.from(tmb)) }));
    expect(svgTexts(el).map((t) => t.textContent)).toContain("0.004");
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

describe("oncoplot sample count", () => {
  /** The text under the grid that counts the samples. */
  const countText = (el: HTMLElement) =>
    Array.from(el.querySelectorAll("svg text"))
      .map((t) => t.textContent ?? "")
      .find((s) => /^\d+ /.test(s));

  const make = (ncols: number, xLabel?: string) => {
    const el = document.createElement("div");
    el.style.cssText = "width:600px;height:400px;";
    document.body.appendChild(el);
    const plot = createOncoplot(el, {
      data: {
        columns: { codes: Array.from({ length: 2 * ncols }, (_, i) => i % 2) },
        meta: {
          nrows: 2,
          ncols,
          genes: ["TP53", "KRAS"],
          samples: Array.from({ length: ncols }, (_, i) => `S${i + 1}`),
          classes: ["Missense_Mutation"],
        },
      },
      options: xLabel === undefined ? {} : { xLabel },
    });
    const text = countText(el);
    plot.destroy();
    el.remove();
    return text;
  };

  it("reads 1 sample for one column with the default label", () => {
    // Before the fix: "1 samples".
    expect(make(1)).toBe("1 sample");
    expect(make(2)).toBe("2 samples");
  });

  it("writes a label the caller set as given", () => {
    expect(make(1, "tumours")).toBe("1 tumours");
    expect(make(3, "patients")).toBe("3 patients");
  });
});
