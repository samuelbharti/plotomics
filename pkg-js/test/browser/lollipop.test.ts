import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createLollipop } from "../../src/components/lollipop.js";
import {
  DEFAULT_PADDING,
  OKABE_ITO,
  PALETTE_20,
  type PlotomicsInstance,
  defaultTheme,
  textSizes,
  textWidth,
} from "../../src/core/index.js";

/** Width of the plot box of a 900 px widget: less the theme padding. */
const BOX_W = 900 - 2 * DEFAULT_PADDING;

function container(width = 900, height = 440) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
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

/** The y tick labels: right-aligned numbers left of the stems. */
function yTicks(el: HTMLElement): SVGTextElement[] {
  return svgTexts(el).filter(
    (t) =>
      t.getAttribute("text-anchor") === "end" &&
      /^[\d.]+k?$/.test(t.textContent ?? ""),
  );
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

/** A base64 PNG as a Blob. */
function base64PNG(b64: string): Blob {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/** The widget as the screen shows it, as a PNG. */
async function screenPNG(el: HTMLElement): Promise<Blob> {
  return base64PNG(await page.screenshot({ element: el, save: false }));
}

/** The canvas image inside an SVG export, as a PNG. */
function svgImagePNG(svgText: string): Blob {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const image = doc.querySelector("image") as Element;
  const href = image.getAttribute("href") ?? "";
  return base64PNG(href.slice(href.indexOf(",") + 1));
}

const far = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));

/** WCAG contrast ratio of two colours given as [r, g, b]. */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hexRGB(hex: string): number[] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

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
    const x = 52 + ((248 - 1) / (393 - 1)) * (BOX_W - 52 - 16);
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
    const x = 52 + ((248 - 1) / (393 - 1)) * (BOX_W - 52 - 16);
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
    const x = 52 + ((248 - 1) / (393 - 1)) * (BOX_W - 52 - 16);
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
    // In the plot box, 20 px less than the widget with the default padding.
    for (const t of texts) {
      const b = t.getBBox();
      expect(b.y + b.height).toBeLessThanOrEqual(200 - 2 * DEFAULT_PADDING);
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

  it("labels the count axis with round whole numbers that fit", () => {
    // Before the fix the axis had two labels: 0 and the tallest stem.
    const small = {
      columns: {
        position: [100, 100, 200],
        count: [1, 1, 1],
        class: ["Missense", "Missense", "Missense"],
      },
      meta: { length: 393, classes: ["Missense"] },
    };
    // A tall widget, the default height of R and Python (440 px), and a
    // short widget.
    for (const [w, h] of [
      [800, 560],
      [900, 440],
      [800, 300],
    ] as const) {
      for (const [data, tallest] of [
        [HOTSPOTS, 39],
        [small, 2],
      ] as const) {
        const el = container(w, h);
        const plot = createLollipop(el, { data });
        const ticks = yTicks(el);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        const values = ticks.map((t) => t.textContent ?? "");
        // Whole numbers only: a count of samples has no halves.
        for (const v of values) expect(v).toMatch(/^\d+$/);
        const n = values.map(Number);
        expect(n[0]).toBe(0);
        const step = (n[1] as number) - (n[0] as number);
        expect(step).toBeGreaterThanOrEqual(1);
        // A round step: 1, 2 or 5 times a power of ten.
        const mantissa = step / 10 ** Math.floor(Math.log10(step));
        expect([1, 2, 5]).toContain(mantissa);
        for (let i = 1; i < n.length; i += 1) {
          expect((n[i] as number) - (n[i - 1] as number)).toBe(step);
        }
        // The axis covers the tallest stem.
        expect(n[n.length - 1]).toBeGreaterThanOrEqual(tallest);
        // Each label sits above the one before it, with no two touching.
        const boxes = ticks.map((t) => t.getBBox());
        for (let i = 1; i < boxes.length; i += 1) {
          const b = boxes[i] as DOMRect;
          const prev = boxes[i - 1] as DOMRect;
          expect(b.y + b.height).toBeLessThanOrEqual(prev.y);
          expect(b.y).toBeGreaterThanOrEqual(0);
        }
        plot.destroy();
        el.remove();
      }
    }
  });

  it("draws gridlines under the stems on screen and in both exports", async () => {
    // Before the fix there were no gridlines.
    const el = container(800, 440);
    const plot = createLollipop(el, {
      data: {
        columns: {
          position: [100, 300],
          count: [10, 20],
          class: ["Missense", "Missense"],
        },
        meta: { length: 393, classes: ["Missense"], classColors: ["#ff0000"] },
      },
    });
    instances.push(plot);
    const ticks = yTicks(el);
    expect(ticks.map((t) => t.textContent)).toEqual([
      "0",
      "5",
      "10",
      "15",
      "20",
    ]);
    // A label's baseline is 0.35 of the 11 px label size below its line.
    const lineY = (label: string) =>
      Number(
        ticks.find((t) => t.textContent === label)?.getAttribute("y") ?? 0,
      ) -
      0.35 * 11;
    // In the plot box, which starts inside the theme padding; the images
    // keep the padding around it.
    const P = DEFAULT_PADDING;
    const x = (residue: number) =>
      52 + ((residue - 1) / (393 - 1)) * (800 - 2 * P - 52 - 16);
    const grid = [0xe5, 0xe7, 0xeb];
    // Each image with the offset of the plot box in it and its width: the
    // canvas image in the SVG export is the plot box alone.
    const images: [Blob, number, number][] = [
      [await screenPNG(el), P, 800],
      [(await plot.exportPNG?.(1)) as Blob, P, 800],
      [svgImagePNG(plot.exportSVG?.() ?? ""), 0, 800 - 2 * P],
    ];
    for (const [png, o, w] of images) {
      for (const label of ["5", "10", "15", "20"]) {
        // The gridline shows where no stem stands, at residue 200.
        let nearest = 255;
        for (let dy = -2; dy <= 2; dy += 1) {
          const p = await pngPixel(png, w, x(200) + o, lineY(label) + dy + o);
          nearest = Math.min(nearest, far(p, grid));
        }
        expect(nearest).toBeLessThan(12);
      }
      // The head at count 10 sits on the line through 10 and covers it.
      for (let dy = -2; dy <= 2; dy += 1) {
        const p = await pngPixel(png, w, x(100) + o, lineY("10") + dy + o);
        expect(isRed(p)).toBe(true);
      }
      // The stem at residue 300 crosses the line through 5 and covers it.
      let crossing = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        const p = await pngPixel(png, w, x(300) + dx + o, lineY("5") + o);
        crossing = Math.max(crossing, far(p, grid));
      }
      expect(crossing).toBeGreaterThan(20);
    }
  });

  it("writes each domain name in a colour that reads on its fill", () => {
    // Before the fix every name was near-white, which is unreadable on the
    // yellow, orange and sky blue of the default palette.
    const names = ["TAD", "PRD", "DBD", "L2", "L3", "OD", "CTD", "NLS"];
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [10], count: [1] },
          meta: {
            length: 800,
            domains: names.map((name, i) => ({
              name,
              start: 1 + i * 100,
              end: 90 + i * 100,
            })),
          },
        },
      }),
    );
    const labels = svgTexts(el).filter((t) =>
      names.includes(t.textContent ?? ""),
    );
    expect(labels).toHaveLength(names.length);
    for (const t of labels) {
      // The canvas under the name holds the domain's fill.
      const fill = pixel(
        el,
        Number(t.getAttribute("x")),
        Number(t.getAttribute("y")) - 4,
      );
      const ink = hexRGB(t.getAttribute("fill") ?? "");
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(3);
    }
  });

  it("fills the domains from a palette of their own, not the class colours", () => {
    // Before the fix the domains took the class palette in order, so in a
    // TP53 plot the first domain was Missense blue and the DNA-binding
    // domain Frameshift green.
    const names = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];
    const hex = (c: number[]) =>
      `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    for (const nClasses of [4, 8, 12]) {
      const classes = Array.from({ length: nClasses }, (_, i) => `C${i + 1}`);
      const el = container(900, 440);
      const plot = createLollipop(el, {
        data: {
          columns: { position: [790], count: [1], class: ["C1"] },
          meta: {
            length: 800,
            classes,
            domains: names.map((name, i) => ({
              name,
              start: 1 + i * 95,
              end: 90 + i * 95,
            })),
          },
        },
      });
      // The default class colours: the palettes, and the legend dots drawn.
      const classFills = new Set(
        [
          ...OKABE_ITO,
          ...PALETTE_20,
          ...Array.from(el.querySelectorAll("svg circle")).map(
            (c) => c.getAttribute("fill") ?? "",
          ),
        ].map((c) => c.toLowerCase()),
      );
      const fills = names.map((name) => {
        const t = svgTexts(el).find(
          (s) => s.textContent === name,
        ) as SVGTextElement;
        return pixel(
          el,
          Number(t.getAttribute("x")),
          Number(t.getAttribute("y")) - 4,
        );
      });
      for (const f of fills) expect(classFills.has(hex(f))).toBe(false);
      for (let i = 1; i < fills.length; i += 1) {
        const a = fills[i - 1] as number[];
        const b = fills[i] as number[];
        const diff = a.reduce(
          (s, v, k) => s + Math.abs(v - (b[k] as number)),
          0,
        );
        expect(diff).toBeGreaterThanOrEqual(60);
      }
      plot.destroy();
      el.remove();
    }
  });

  it("cuts a narrow domain's name and leaves out one too narrow for three characters", () => {
    // Before the fix a name that did not fit whole was left out.
    const small = textSizes(defaultTheme).small;
    const w = (s: string) => textWidth(s, small, defaultTheme.fontFamily);
    // Room for "Tra" and the ellipsis, and for "Te" and the ellipsis only.
    const cut = Math.ceil(6 + w("Tra\u2026")) + 1;
    const tight = Math.ceil(6 + w("Te\u2026")) + 1;
    const el = container(852, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [700], count: [1] },
          meta: {
            length: 785,
            domains: [
              { name: "Proline rich", start: 20, end: 220 },
              { name: "Transactivation domain 2", start: 300, end: 300 + cut },
              { name: "Tetramerisation", start: 500, end: 500 + tight },
            ],
          },
        },
      }),
    );
    const texts = svgTexts(el);
    // x of a residue, from the first and last residue labels, which are
    // centred on their ticks (the y tick labels end at theirs).
    const at = (s: string) =>
      Number(
        texts
          .find(
            (t) =>
              t.textContent === s && t.getAttribute("text-anchor") === "middle",
          )
          ?.getAttribute("x"),
      );
    const x = (r: number) => at("1") + ((r - 1) / 784) * (at("785") - at("1"));
    expect(texts.some((t) => t.textContent === "Proline rich")).toBe(true);
    const short = texts.find((t) => t.textContent === "Tra\u2026");
    expect(short).toBeDefined();
    const b = (short as SVGTextElement).getBBox();
    expect(b.x).toBeGreaterThanOrEqual(x(300));
    expect(b.x + b.width).toBeLessThanOrEqual(x(300 + cut));
    expect(texts.some((t) => (t.textContent ?? "").startsWith("Te"))).toBe(
      false,
    );
    // The tooltip on the cut domain gives its full name.
    const y = Number((short as SVGTextElement).getAttribute("y")) - 3;
    expect(hoverAt(el, x(300 + cut / 2), y)).toContain(
      "Transactivation domain 2",
    );
  });

  it("draws no gridline for a grid colour that paints nothing, and reads var()", () => {
    // Before the fix the canvas kept its last stroke colour for a grid
    // colour it could not read: black on the first draw, the stem colour
    // after setOptions.
    const data = {
      columns: { position: [100, 300], count: [10, 20] },
      meta: { length: 393 },
    };
    /** The pixels across the gridline through 10, where no stem stands. */
    const acrossGrid = (el: HTMLElement) => {
      const ten = yTicks(el).find(
        (t) => t.textContent === "10",
      ) as SVGTextElement;
      const y = Number(ten.getAttribute("y")) - 0.35 * 11;
      const x = 52 + ((200 - 1) / (393 - 1)) * (800 - 52 - 16);
      return [-2, -1, 0, 1, 2].map((dy) => pixel(el, x, y + dy));
    };
    const white = [255, 255, 255];
    for (const grid of ["none", "grey90", "transparent", ""]) {
      const el = container(800, 440);
      instances.push(
        createLollipop(el, { data, options: { theme: { grid } } }),
      );
      for (const p of acrossGrid(el)) expect(p).toEqual(white);
    }
    const el = container(800, 440);
    const plot = createLollipop(el, { data });
    instances.push(plot);
    expect(acrossGrid(el).some((p) => far(p, white) > 12)).toBe(true);
    plot.setOptions({ theme: { grid: "none" } });
    for (const p of acrossGrid(el)) expect(p).toEqual(white);
    // A var() grid colour takes the custom property of the plot element.
    const styled = container(800, 440);
    styled.style.setProperty("--lollipop-grid", "#ff00ff");
    instances.push(
      createLollipop(styled, {
        data,
        options: { theme: { grid: "var(--lollipop-grid)" } },
      }),
    );
    expect(acrossGrid(styled).some((p) => far(p, [255, 0, 255]) < 12)).toBe(
      true,
    );
  });

  it("uses the given domain colours, with names that read on each", () => {
    // Before the fix a fill that was not a 3- or 6-digit hex colour, such
    // as "gold", kept the light name: 1.3 to 1 on gold.
    const fills = [
      "#1B2A41",
      "#F5E6A8",
      "gold",
      "yellow",
      "#FFD700CC",
      "rgb(20 30 60)",
    ];
    const names = fills.map((_, i) => `N${i + 1}`);
    const el = container(900, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [790], count: [1] },
          meta: {
            length: 800,
            domains: names.map((name, i) => ({
              name,
              start: 1 + i * 120,
              end: 100 + i * 120,
            })),
            domainColors: fills,
          },
        },
      }),
    );
    const label = (name: string) =>
      svgTexts(el).find((t) => t.textContent === name) as SVGTextElement;
    // The canvas under a name holds its domain's fill.
    const under = (name: string) =>
      pixel(
        el,
        Number(label(name).getAttribute("x")),
        Number(label(name).getAttribute("y")) - 4,
      );
    // Each opaque colour is drawn as given, not from the domain palette.
    for (const [name, rgb] of [
      ["N1", [0x1b, 0x2a, 0x41]],
      ["N2", [0xf5, 0xe6, 0xa8]],
      ["N3", [255, 215, 0]],
      ["N4", [255, 255, 0]],
      ["N6", [20, 30, 60]],
    ] as const) {
      expect(under(name)).toEqual(rgb);
    }
    // A dark fill takes the light name, a light one the dark name.
    for (const name of ["N1", "N6"]) {
      expect(label(name).getAttribute("fill")).toBe("#FBF7EF");
    }
    for (const name of ["N2", "N3", "N4", "N5"]) {
      expect(label(name).getAttribute("fill")).toBe("#233038");
    }
    for (const name of names) {
      const ink = hexRGB(label(name).getAttribute("fill") ?? "");
      expect(contrast(ink, under(name))).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps two count labels clear of each other when the stems have little room", () => {
    // Before the fix a top count of 3 on a short stem area read 0, 2 and 4,
    // with each label over the next.
    for (const [h, fontSize, top] of [
      [180, 16, 3],
      [220, 22, 23],
    ] as const) {
      const el = container(800, h);
      instances.push(
        createLollipop(el, {
          data: {
            columns: {
              position: [100, 200],
              count: [top, 1],
              class: ["Missense", "Missense"],
            },
            meta: { length: 393, classes: ["Missense"] },
          },
          options: { theme: { fontSize } },
        }),
      );
      const ys = yTicks(el).map((t) => Number(t.getAttribute("y")));
      // A stem area too short for two labels keeps its top label alone.
      expect(ys.length).toBeGreaterThanOrEqual(1);
      // The digits of neighbouring labels do not touch.
      const size = textSizes({ fontSize }).label;
      for (let i = 1; i < ys.length; i += 1) {
        expect(
          (ys[i - 1] as number) - (ys[i] as number),
        ).toBeGreaterThanOrEqual(size);
      }
    }
  });

  it("scales counts below 1 to the stem height, with decimal ticks", () => {
    // Before the fix whole-number steps put a top of 0.3 on an axis from 0
    // to 1, with the tallest stem at 30 percent of the height.
    const el = container(800, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [100, 200, 300], count: [0.3, 0.12, 0.05] },
          meta: { length: 393 },
        },
        options: { yLabel: "frequency" },
      }),
    );
    const values = yTicks(el).map((t) => Number(t.textContent));
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values[0]).toBe(0);
    const top = values[values.length - 1] as number;
    expect(top).toBeGreaterThanOrEqual(0.3);
    expect(top).toBeLessThan(0.5);
  });

  it("keeps the number of a numbered domain when it cuts the name", () => {
    // Before the fix both transactivation domains read "Transac" and an
    // ellipsis at 800 px.
    const el = container(800, 440);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [300], count: [1] },
          meta: {
            length: 393,
            domains: [
              { name: "Transactivation domain 1", start: 6, end: 30 },
              { name: "Transactivation domain 2", start: 35, end: 59 },
            ],
          },
        },
      }),
    );
    const cut = svgTexts(el)
      .map((t) => t.textContent ?? "")
      .filter((s) => s.startsWith("Tra"));
    expect(cut).toHaveLength(2);
    expect(cut[0]).toMatch(/^Tra\S*\u2026 1$/);
    expect(cut[1]).toMatch(/^Tra\S*\u2026 2$/);
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
