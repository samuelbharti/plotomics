import { afterEach, describe, expect, it } from "vitest";
import { createDotplot } from "../../src/components/dotplot.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createUpset } from "../../src/components/upset.js";
import { createViolin } from "../../src/components/violin.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

// Hovering a mark whose name or size is missing: R sends NA as null and
// Python sends None as null, or a missing number as NaN. Before the fix the
// violin, the UpSet plot and the lollipop domains threw on such a value, on
// every mouse move, and left the last tooltip on screen.

let instances: PlotomicsInstance<unknown>[] = [];
let errors: string[] = [];
const onError = (e: ErrorEvent) => {
  errors.push(e.message);
  e.preventDefault();
};
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  window.removeEventListener("error", onError);
  document.body.replaceChildren();
});

function container(width = 600, height = 400) {
  errors = [];
  window.addEventListener("error", onError);
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** The tooltip text after a move to (x, y) in the page, or "" if hidden. */
function hover(el: HTMLElement, x: number, y: number): string {
  el.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.innerHTML ?? "") : "";
}

/** The tooltips over a grid of points across the whole element. */
function scan(el: HTMLElement, nx = 40, ny = 30): Set<string> {
  const r = el.getBoundingClientRect();
  const out = new Set<string>();
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const tip = hover(
        el,
        r.left + ((i + 0.5) / nx) * r.width,
        r.top + ((j + 0.5) / ny) * r.height,
      );
      if (tip) out.add(tip);
    }
  }
  return out;
}

const svgTexts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")).map((t) => t.textContent ?? "");

describe("a violin with a missing feature or group name", () => {
  it("shows the tooltip of each violin, naming the missing one NA", () => {
    const el = container();
    instances.push(
      createViolin(el, {
        data: {
          columns: {
            feature: ["CD3E", "CD3E", null, null] as unknown as string[],
            group: ["T", null, "T", null] as unknown as string[],
          },
          meta: {
            grid: [0, 1, 2],
            density: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
            median: [1, 1, 1, 1],
          },
        },
      }),
    );
    const tips = [...scan(el)].map((t) => t.replace(/<br>.*$/, ""));
    expect(errors).toEqual([]);
    expect(new Set(tips)).toEqual(
      new Set([
        "<b>CD3E</b> in T",
        "<b>CD3E</b> in NA",
        "<b>NA</b> in T",
        "<b>NA</b> in NA",
      ]),
    );
    expect(svgTexts(el)).not.toContain("null");
  });
});

describe("a dot plot with a missing gene or group name", () => {
  it("names the missing one NA in the tooltip", () => {
    // Before, the tooltip gave it no name, and read " in T".
    const el = container();
    instances.push(
      createDotplot(el, {
        data: {
          columns: {
            gene: ["CD3E", null, "CD3E", null] as unknown as string[],
            cluster: ["T", "T", null, null] as unknown as string[],
            pct: [100, 100, 100, 100],
            value: [1, 2, 3, 4],
          },
        },
      }),
    );
    const tips = [...scan(el)].map((t) => t.replace(/<br>.*$/, ""));
    expect(errors).toEqual([]);
    expect(new Set(tips)).toEqual(
      new Set([
        "<b>CD3E</b> in T",
        "<b>NA</b> in T",
        "<b>CD3E</b> in NA",
        "<b>NA</b> in NA",
      ]),
    );
  });
});

describe("an UpSet intersection with a missing size", () => {
  const meta = {
    sets: ["A", "B"],
    membership: [1, 0, 0, 1, 1, 1],
    total: 100,
  };
  for (const [from, size] of [
    ["R", [40, null, 30]],
    ["Python", Float32Array.from([40, Number.NaN, 30])],
  ] as const) {
    it(`reads NA in the tooltip, from ${from}`, () => {
      const el = container();
      instances.push(
        createUpset(el, {
          data: { columns: { size: size as unknown as number[] }, meta },
        }),
      );
      const tips = [...scan(el)];
      expect(errors).toEqual([]);
      expect(tips).toContain("<b>40</b> (40.0%)<br>A");
      expect(tips).toContain("<b>NA</b><br>B");
      expect(tips).toContain("<b>30</b> (30.0%)<br>A + B");
      expect(tips.join(" ")).not.toContain("NaN");
    });
  }
});

describe("an UpSet set with a missing name", () => {
  it("names it NA in the tooltips", () => {
    // Before, the set read "<b></b> (50)", and an intersection of that set
    // alone read "none".
    const el = container();
    instances.push(
      createUpset(el, {
        data: {
          columns: { size: [40, 20, 10] },
          meta: {
            sets: ["A", null] as unknown as string[],
            setSizes: [70, 50],
            membership: [1, 0, 0, 1, 1, 1],
          },
        },
      }),
    );
    const tips = [...scan(el)];
    expect(errors).toEqual([]);
    expect(tips).toContain("<b>NA</b> (50)");
    expect(tips).toContain("<b>20</b><br>NA");
    expect(tips).toContain("<b>10</b><br>A + NA");
    expect(tips.join(" ")).not.toContain("none");
  });
});

describe("an oncoplot annotation with a missing name or level", () => {
  const data = (name: string | null, levels: (string | null)[]) => ({
    columns: { codes: [1, 0, 0, 1] },
    meta: {
      nrows: 2,
      ncols: 2,
      genes: ["TP53", "KRAS"],
      samples: ["S1", "S2"],
      classes: ["Missense_Mutation"],
      annotations: [{ name, levels, codes: [0, 1] }],
    },
  });
  for (const [what, name, levels, want] of [
    ["name", null, ["Basal", "LumA"], "S1</b><br>NA: Basal"],
    ["level", "Subtype", [null, "LumA"], "S1</b><br>Subtype: NA"],
  ] as const) {
    it(`names a missing ${what} NA in the tooltip`, () => {
      // Before, the tooltip threw on null on every mouse move.
      const el = container(600, 400);
      instances.push(
        createOncoplot(el, {
          data: data(name, [...levels]) as never,
        }),
      );
      const tips = [...scan(el, 60, 80)];
      expect(errors).toEqual([]);
      expect(tips.some((t) => t.endsWith(want))).toBe(true);
      expect(svgTexts(el).join(" ")).not.toContain("null");
    });
  }
});

describe("a lollipop domain with a missing name", () => {
  it("draws the plot with no name for it, and hovers it", () => {
    const el = container(800, 440);
    const make = () =>
      createLollipop(el, {
        data: {
          columns: { position: [50, 150, 250], count: [5, 3, 2] },
          meta: {
            length: 300,
            domains: [
              { name: null, start: 10, end: 90 },
              { name: "Kinase domain", start: 120, end: 220 },
            ],
          },
        },
      });
    // Before the fix the first draw threw, after the y axis.
    let plot: PlotomicsInstance<unknown> | undefined;
    expect(() => {
      plot = make();
    }).not.toThrow();
    if (plot) instances.push(plot);
    const texts = svgTexts(el);
    expect(texts).toContain("Kinase");
    expect(texts).not.toContain("null");
    // The residue axis, drawn after the domain names, is there.
    expect(texts).toContain("200");
    const tips = [...scan(el, 160, 60)];
    expect(errors).toEqual([]);
    expect(tips).toContain("<b>NA</b><br>10-90");
    expect(tips).toContain("<b>Kinase domain</b><br>120-220");
  });
});
