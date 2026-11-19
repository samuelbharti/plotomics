import { afterEach, describe, expect, it } from "vitest";
import { createLollipop } from "../../src/components/lollipop.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

function container(width = 900, height = 440) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
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
  // A hidden tooltip keeps its last text, so read it only while shown.
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

function svgTexts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Canvas pixel at a CSS-pixel point, as [r, g, b]. */
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

/** Head fills are drawn at 92% opacity, so match the hue, not the exact value. */
const isRed = ([r, g, b]: number[]) =>
  (r as number) > 180 && (g as number) < 120 && (b as number) < 120;
const isBlue = ([r, g, b]: number[]) =>
  (b as number) > 180 && (r as number) < 120 && (g as number) < 120;

/** TP53-like hotspots, listed by count (not by position). */
const HOTSPOTS = {
  columns: {
    position: [175, 248, 273, 248, 245, 249],
    count: [25, 20, 18, 19, 9, 8],
    class: [
      "Missense",
      "Missense",
      "Missense",
      "Missense",
      "Missense",
      "Missense",
    ],
    label: ["R175H", "R248Q", "R273H", "R248W", "G245S", "R249S"],
  },
  meta: {
    length: 393,
    gene: "TP53",
    classes: ["Missense"],
    classColors: ["#ff0000"],
    labelIndex: [0, 1, 2, 3, 4, 5],
  },
};

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("lollipop labels without meta.labelIndex", () => {
  const { labelIndex: _, ...meta } = HOTSPOTS.meta;
  const drawn = (el: HTMLElement) =>
    svgTexts(el)
      .map((t) => t.textContent ?? "")
      .filter((s) => HOTSPOTS.columns.label.includes(s))
      .sort();

  it("labels the most recurrent variants, as the wrappers do", () => {
    const el = container();
    instances.push(
      createLollipop(el, {
        data: { columns: HOTSPOTS.columns, meta },
        options: { labelTopN: 3 },
      }),
    );
    // Counts 25, 20 and 19.
    expect(drawn(el)).toEqual(["R175H", "R248Q", "R248W"]);
  });

  it("labels up to 12 by default, and none for an empty labelIndex", () => {
    const el = container();
    instances.push(
      createLollipop(el, { data: { columns: HOTSPOTS.columns, meta } }),
    );
    expect(drawn(el)).toEqual([...HOTSPOTS.columns.label].sort());

    const none = container();
    instances.push(
      createLollipop(none, {
        data: { columns: HOTSPOTS.columns, meta: { ...meta, labelIndex: [] } },
      }),
    );
    expect(drawn(none)).toEqual([]);
  });
});

describe("lollipop in a browser", () => {
  it("draws every label clear of the others and of every head", () => {
    const el = container();
    instances.push(createLollipop(el, { data: HOTSPOTS }));
    const names = HOTSPOTS.columns.label;
    const labels = svgTexts(el).filter((t) =>
      names.includes(t.textContent ?? ""),
    );
    // All six are drawn, although the rows are not in position order.
    expect(labels.map((t) => t.textContent).sort()).toEqual([...names].sort());
    const boxes = labels.map((t) => t.getBBox());
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i] as DOMRect;
      expect(b.y).toBeGreaterThanOrEqual(0);
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(b, boxes[j] as DOMRect)).toBe(false);
      }
      // No head ink under a label.
      for (let x = Math.ceil(b.x); x < b.x + b.width; x += 2) {
        for (let y = Math.ceil(b.y); y < b.y + b.height; y += 2) {
          expect(isRed(pixel(el, x, y))).toBe(false);
        }
      }
    }
  });

  it("stacks variants at one residue and names the head on top", () => {
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [248, 248],
            count: [1, 1],
            class: ["Missense", "Nonsense"],
            label: ["R248Q", "R248*"],
          },
          meta: {
            length: 393,
            classes: ["Missense", "Nonsense"],
            classColors: ["#ff0000", "#0000ff"],
          },
        },
      }),
    );
    // x of residue 248 and y of counts 1 and 2 (the stem holds both).
    const x = 52 + ((248 - 1) / (393 - 1)) * (900 - 52 - 16);
    const zero = svgTexts(el).find(
      (t) => t.textContent === "0",
    ) as SVGTextElement;
    const two = svgTexts(el).find(
      (t) => t.textContent === "2",
    ) as SVGTextElement;
    const y0 = Number(zero.getAttribute("y")) - 3;
    const y2 = Number(two.getAttribute("y")) - 3;
    const y1 = (y0 + y2) / 2;
    expect(isRed(pixel(el, x, y1))).toBe(true);
    expect(isBlue(pixel(el, x, y2))).toBe(true);
    const top = hoverAt(el, x, y2);
    expect(top).toContain("R248*");
    expect(top).toContain("residue 248: 2 samples in total");
    expect(hoverAt(el, x, y1)).toContain("R248Q");
  });

  it("labels a head low in a stack beside itself", () => {
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [175, 248, 248, 248, 248, 248],
            count: [25, 20, 1, 1, 1, 1],
            class: [
              "Missense",
              "Missense",
              "Nonsense",
              "Nonsense",
              "Nonsense",
              "Nonsense",
            ],
            label: ["R175H", "R248Q", "R248*", "R248fs", "R248X", "R248Y"],
          },
          meta: {
            length: 393,
            classes: ["Missense", "Nonsense"],
            classColors: ["#ff0000", "#0000ff"],
            labelIndex: [0, 1],
          },
        },
      }),
    );
    const texts = svgTexts(el);
    const r248q = texts.find(
      (t) => t.textContent === "R248Q",
    ) as SVGTextElement;
    expect(texts.some((t) => t.textContent === "R175H")).toBe(true);
    expect(r248q).toBeDefined();
    // Its baseline sits by its own head (count 20), not above the stack.
    const zero = texts.find((t) => t.textContent === "0") as SVGTextElement;
    const top = texts.find((t) => t.textContent === "25") as SVGTextElement;
    const y0 = Number(zero.getAttribute("y")) - 3;
    const y25 = Number(top.getAttribute("y")) - 3;
    const head = y0 - (20 / 25) * (y0 - y25);
    expect(Math.abs(Number(r248q.getAttribute("y")) - 3 - head)).toBeLessThan(
      4,
    );
    expect(["start", "end"]).toContain(r248q.getAttribute("text-anchor"));
  });

  it("names the head drawn on top wherever it shows", () => {
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [175, 248, 248],
            count: [100, 20, 1],
            class: ["Missense", "Missense", "Nonsense"],
            label: ["R175H", "R248Q", "R248*"],
          },
          meta: {
            length: 393,
            classes: ["Missense", "Nonsense"],
            classColors: ["#ff0000", "#0000ff"],
          },
        },
      }),
    );
    const x = 52 + ((248 - 1) / (393 - 1)) * (900 - 52 - 16);
    let blue = 0;
    for (let y = 200; y < 420; y += 1) {
      if (!isBlue(pixel(el, x, y))) continue;
      blue += 1;
      expect(hoverAt(el, x, y)).toContain("R248*");
    }
    expect(blue).toBeGreaterThan(0);
  });

  it("draws the other variants at a residue when one count is missing", () => {
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [248, 248, 175],
            count: [Number.NaN, 5, 3],
            class: ["Missense", "Missense", "Missense"],
            label: ["R248Q", "R248W", "R175H"],
          },
          meta: {
            length: 393,
            classes: ["Missense"],
            classColors: ["#ff0000"],
            labelIndex: [0, 1, 2],
          },
        },
      }),
    );
    const x = 52 + ((248 - 1) / (393 - 1)) * (900 - 52 - 16);
    let red = 0;
    for (let y = 0; y < 440; y += 1) if (isRed(pixel(el, x, y))) red += 1;
    expect(red).toBeGreaterThan(0);
    const ys = svgTexts(el).map((t) => t.getAttribute("y"));
    expect(ys).not.toContain("NaN");
    expect(svgTexts(el).some((t) => t.textContent === "R248Q")).toBe(false);
  });

  it("caps the legend in a small widget and keeps room for the stems", () => {
    const classes = Array.from({ length: 10 }, (_, i) => `Variant_Class_${i}`);
    const el = container(250, 200);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [10, 20],
            count: [10, 1],
            class: [classes[0] as string, classes[1] as string],
          },
          meta: { length: 100, classes },
        },
      }),
    );
    const texts = svgTexts(el);
    expect(texts.some((t) => /^\+\d+ more$/.test(t.textContent ?? ""))).toBe(
      true,
    );
    const zero = texts.find((t) => t.textContent === "0") as SVGTextElement;
    const ten = texts.find((t) => t.textContent === "10") as SVGTextElement;
    expect(
      Number(zero.getAttribute("y")) - Number(ten.getAttribute("y")),
    ).toBeGreaterThan(30);
    for (const t of texts) {
      const b = t.getBBox();
      expect(b.y + b.height).toBeLessThanOrEqual(200);
    }
  });

  it("keeps the axis text clear of a wrapped legend, inside the element", () => {
    const classes = [
      "Missense_Mutation",
      "Nonsense_Mutation",
      "Frame_Shift_Del",
      "Frame_Shift_Ins",
      "Splice_Site",
      "In_Frame_Del",
      "In_Frame_Ins",
      "Translation_Start_Site",
    ];
    const el = container(500, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: {
            position: [10, 20],
            count: [2, 1],
            class: [classes[0] as string, classes[1] as string],
          },
          meta: { length: 100, gene: "TP53", classes },
        },
      }),
    );
    const title = svgTexts(el).find(
      (t) => t.textContent === "TP53 - amino-acid position",
    ) as SVGTextElement;
    expect(title).toBeDefined();
    const legend = svgTexts(el).filter((t) =>
      classes.includes(t.textContent ?? ""),
    );
    expect(legend).toHaveLength(classes.length);
    expect(
      new Set(legend.map((t) => t.getAttribute("y"))).size,
    ).toBeGreaterThan(1);
    const tb = title.getBBox();
    const ticks = svgTexts(el).filter(
      (t) => t.textContent === "1" || t.textContent === "100",
    );
    for (const t of [...legend, ...ticks]) {
      const b = t.getBBox();
      expect(overlaps(tb, b)).toBe(false);
      expect(b.x + b.width).toBeLessThanOrEqual(500);
      expect(b.y + b.height).toBeLessThanOrEqual(440);
    }
  });

  it("keeps the axis text inside the element without a legend", () => {
    const el = container(600, 300);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [10], count: [1] },
          meta: { length: 100, uniprot: "P04637" },
        },
        options: { showLegend: false },
      }),
    );
    const title = svgTexts(el).find(
      (t) => t.textContent === "P04637 - amino-acid position",
    ) as SVGTextElement;
    expect(title).toBeDefined();
    const b = title.getBBox();
    expect(b.y + b.height).toBeLessThanOrEqual(300);
  });

  it("shows no domain tooltip when domains are hidden", () => {
    const el = container(600, 300);
    const data = {
      columns: { position: [10], count: [1] },
      meta: { length: 100, domains: [{ name: "DBD", start: 20, end: 80 }] },
    };
    const plot = createLollipop(el, { data });
    instances.push(plot);
    // Find the backbone band by its domain label, then hover it.
    const label = svgTexts(el).find(
      (t) => t.textContent === "DBD",
    ) as SVGTextElement;
    const x = Number(label.getAttribute("x"));
    const y = Number(label.getAttribute("y")) - 3;
    expect(hoverAt(el, x, y)).toContain("DBD");
    plot.setOptions({ showDomains: false });
    expect(hoverAt(el, x, y)).not.toContain("DBD");
  });
});
