import { afterEach, describe, expect, it } from "vitest";
import { createTreemap } from "../../src/components/treemap.js";
import {
  type PlotomicsInstance,
  defaultTheme,
  ramp,
  rgbToHex,
  textSizes,
  textWidth,
} from "../../src/core/index.js";
import { canvasPNG, drawnPixels } from "./helpers.js";

function container() {
  const el = document.createElement("div");
  el.style.cssText = "width:600px;height:400px;";
  document.body.appendChild(el);
  return el;
}

/** Two pathways of five genes each. */
function pathways(withValue: boolean) {
  const id = ["root", "P1", "P2"];
  const parent = ["", "root", "root"];
  const value = [0, 0, 0];
  for (let i = 0; i < 10; i += 1) {
    id.push(`g${i}`);
    parent.push(i < 5 ? "P1" : "P2");
    value.push(i + 1);
  }
  const labels = ["All", "Pathway one", "Pathway two", ...id.slice(3)];
  return {
    columns: withValue ? { id, parent, value } : { id, parent },
    meta: { labels },
  };
}

/** Every colour on the tile canvas, as hex. */
function tileColours(el: HTMLElement): Set<string> {
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    out.add(rgbToHex([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]));
  }
  return out;
}

const texts = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("svg text")).map((t) => t.textContent ?? "");

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("treemap in a browser", () => {
  it("draws tiles when there is no value column", async () => {
    const el = container();
    const tm = createTreemap(el, { data: pathways(false) });
    instances.push(tm);
    const png = await canvasPNG(el);
    // Before the fix every leaf weighed 0 and the canvas was empty.
    expect(await drawnPixels(png as Blob)).toBeGreaterThan(10_000);
  });

  it("names the top-level groups and puts the group in the tooltip", () => {
    const el = container();
    const tm = createTreemap(el, { data: pathways(true) });
    instances.push(tm);
    expect(texts(el)).toContain("Pathway one");
    expect(texts(el)).toContain("Pathway two");

    // Hover the middle of the plot, which falls on a gene tile.
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: r.left + r.width * 0.25,
        clientY: r.top + r.height * 0.6,
        bubbles: true,
      }),
    );
    const tip = Array.from(el.children).find((c) => c.tagName === "DIV");
    expect(tip?.textContent).toContain("group: Pathway two");
  });

  it("shows a value key when colored by value", () => {
    const el = container();
    const tm = createTreemap(el, {
      data: pathways(true),
      options: { colorBy: "value" },
    });
    instances.push(tm);
    expect(el.querySelector("svg linearGradient")).not.toBeNull();
    expect(texts(el)).toContain("10");
  });

  it("prints one value on the key when every tile has it", () => {
    const el = container();
    const tm = createTreemap(el, {
      data: { columns: { id: ["r", "a", "b"], parent: ["", "r", "r"] } },
      options: { colorBy: "value" },
    });
    instances.push(tm);
    expect(texts(el)).toContain("1");
    expect(texts(el)).not.toContain("2");
  });

  it("names a group only when it has a header strip", () => {
    // From a layout where rounding turned a 47.6 px group into 48 px.
    const id = ["root"];
    const parent = [""];
    const value = [0];
    const groups: [string, number[]][] = [
      ["G0", [13, 16, 16, 19]],
      ["G1", [4]],
      ["G2", [13, 10, 12, 19]],
      ["G3", [8]],
      ["G4", [1, 18]],
    ];
    for (const [g, leaves] of groups) {
      id.push(g);
      parent.push("root");
      value.push(0);
      leaves.forEach((v, k) => {
        id.push(`${g.toLowerCase()}_${k}`);
        parent.push(g);
        value.push(v);
      });
    }
    const el = container();
    const tm = createTreemap(el, { data: { columns: { id, parent, value } } });
    instances.push(tm);
    // Every named group label must clear the labels of its own tiles.
    const all = Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
    for (const [g] of groups) {
      const name = all.find((t) => t.textContent === g);
      if (!name) continue;
      const nb = name.getBBox();
      for (const leaf of all.filter((t) =>
        t.textContent?.startsWith(`${g.toLowerCase()}_`),
      )) {
        const lb = leaf.getBBox();
        const overlap =
          nb.x < lb.x + lb.width &&
          lb.x < nb.x + nb.width &&
          nb.y < lb.y + lb.height &&
          lb.y < nb.y + nb.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it("colours tiles and the value key with the ltc and ltcdiv ramps", () => {
    for (const name of ["ltc", "ltcdiv"] as const) {
      const el = container();
      const tm = createTreemap(el, {
        data: pathways(true),
        options: { colorBy: "value", colormap: name },
      });
      instances.push(tm);
      const fn = ramp(name);
      // The key shows the whole ramp in nine stops.
      const stops = Array.from(
        el.querySelectorAll("svg linearGradient stop"),
      ).map((s) => s.getAttribute("stop-color"));
      expect(stops).toEqual(Array.from({ length: 9 }, (_, i) => fn(i / 8)));
      // Leaf values are weights, never below 0: the smallest leaf takes
      // the low end of the ramp and the largest the high end.
      const colours = tileColours(el);
      expect(colours.has(fn(0))).toBe(true);
      expect(colours.has(fn(1))).toBe(true);
    }
  });
});

describe("treemap value key", () => {
  it("prints both ends as the values they are, in one notation", () => {
    // Before the fix the key read "4.0e-3" and "15.75".
    const el = container();
    instances.push(
      createTreemap(el, {
        data: {
          columns: {
            id: ["root", "P1", "P2", "a", "b", "c", "d"],
            parent: ["", "root", "root", "P1", "P1", "P2", "P2"],
            value: [0, 0, 0, 0.004, 3, 7.5, 15.75],
          },
        },
        options: { colorBy: "value" },
      }),
    );
    const drawn = texts(el);
    expect(drawn).toContain("0.004");
    expect(drawn).toContain("15.75");
    expect(drawn.filter((t) => /\de[+-]/.test(t))).toEqual([]);
  });
});

describe("treemap value key in one notation", () => {
  const tree = (values: number[]) => ({
    columns: {
      id: ["root", ...values.map((_, i) => `leaf${i}`)],
      parent: ["", ...values.map(() => "root")],
      value: [0, ...values],
    },
  });

  it("prints small ends in the exponent form", () => {
    // Before the fix the key read "0.000123457" and "0.00121".
    const el = container();
    instances.push(
      createTreemap(el, {
        data: tree([0.000123457, 0.0005, 0.00121]),
        options: { colorBy: "value" },
      }),
    );
    expect(texts(el)).toContain("1.23457e-4");
    expect(texts(el)).toContain("1.21e-3");
  });

  it("never mixes the exponent form with fixed point", () => {
    // Before the fix the key read "5e-7" next to "3".
    const el = container();
    instances.push(
      createTreemap(el, {
        data: tree([5e-7, 3]),
        options: { colorBy: "value" },
      }),
    );
    expect(texts(el)).toContain("5e-7");
    expect(texts(el)).toContain("3e+0");
  });
});

describe("treemap value key in a narrow widget", () => {
  const tree = (values: number[]) => ({
    columns: {
      id: ["root", ...values.map((_, i) => `leaf${i}`)],
      parent: ["", ...values.map(() => "root")],
      value: [0, ...values],
    },
  });
  /**
   * The width of a widget, with no theme padding, whose breadcrumb strip
   * holds the key with ends `short` but not with ends `long`: the root
   * crumb, set bold, then 8 px, the low end, 4 px, the 90 px ramp, 4 px,
   * the high end and 8 px. Labels are measured in the plot's own font, so
   * the case holds in any font.
   */
  function widthBetween(short: string[], long: string[], fontSize: number) {
    const sizes = textSizes({ fontSize });
    const w = (s: string, size: number) =>
      textWidth(s, size, defaultTheme.fontFamily);
    const crumbs = 8 + 1.1 * w("root", sizes.axisTitle) + 6;
    const need = (ends: string[]) =>
      crumbs + 24 + 90 + ends.reduce((sum, s) => sum + w(s, sizes.label), 0);
    expect(need(long) - need(short)).toBeGreaterThanOrEqual(8);
    return Math.ceil((need(short) + need(long)) / 2);
  }
  const keyLabels = (el: HTMLElement) =>
    Array.from(el.querySelectorAll("svg text"))
      .map((t) => t.textContent ?? "")
      .filter((s) => /e[+-]\d+$/.test(s));

  const cases: [number[], number, string[], RegExp, RegExp][] = [
    // Before the fix the key went away at 250 px, fontSize 12, and at
    // 300 px, fontSize 16, where main showed "1.2e-4" and "1.2e-3".
    [
      [0.000123457, 0.0005, 0.00121],
      12,
      ["1.23457e-4", "1.21e-3"],
      /^1\.2\d*e-4$/,
      /^1\.2\d*e-3$/,
    ],
    [
      [0.000123457, 0.0005, 0.00121],
      16,
      ["1.23457e-4", "1.21e-3"],
      /^1\.2\d*e-4$/,
      /^1\.2\d*e-3$/,
    ],
    [
      [1.23457e-6, 3, 15.75],
      12,
      ["1.23457e-6", "1.575e+1"],
      /^1\.2\d*e-6$/,
      /^1\.[56]\d*e\+1$/,
    ],
  ];
  for (const [values, fontSize, full, lo, hi] of cases) {
    it(`prints ${values[0]} to ${values[values.length - 1]} to fewer digits before leaving the key out, fontSize ${fontSize}`, () => {
      // The ends to two significant digits, the fewest the key prints.
      const short = full.map((s) => Number(s).toExponential(1));
      const width = widthBetween(short, full, fontSize);
      const el = document.createElement("div");
      el.style.cssText = `width:${width}px;height:300px;`;
      document.body.appendChild(el);
      instances.push(
        createTreemap(el, {
          data: tree(values),
          options: { colorBy: "value", theme: { fontSize, padding: 0 } },
        }),
      );
      const labels = keyLabels(el);
      expect(labels.length, `${width} px`).toBe(2);
      expect(labels[0]).toMatch(lo);
      expect(labels[1]).toMatch(hi);
      expect(labels).not.toEqual(full);
    });
  }

  it("prints a zero end as 0", () => {
    // Before the fix the key read "0e+0" next to "5e-7".
    const el = container();
    instances.push(
      createTreemap(el, {
        data: tree([0, 5e-7, 2e-7]),
        options: { colorBy: "value" },
      }),
    );
    const drawn = texts(el);
    expect(drawn).toContain("0");
    expect(drawn).toContain("5e-7");
    expect(drawn).not.toContain("0e+0");
  });
});

describe("treemap value key whose ends round to one value", () => {
  const tree = (values: number[]) => ({
    columns: {
      id: ["root", ...values.map((_, i) => `leaf${i}`)],
      parent: ["", ...values.map(() => "root")],
      value: [0, ...values],
    },
  });
  /**
   * The width of a widget, with no theme padding, whose breadcrumb strip
   * holds the key with ends `short` but not with ends `long`, as in the
   * tests above. Measured in the plot's own font.
   */
  function widthBetween(short: string[], long: string[], fontSize: number) {
    const sizes = textSizes({ fontSize });
    const w = (s: string, size: number) =>
      textWidth(s, size, defaultTheme.fontFamily);
    const crumbs = 8 + 1.1 * w("root", sizes.axisTitle) + 6;
    const need = (ends: string[]) =>
      crumbs + 24 + 90 + ends.reduce((sum, s) => sum + w(s, sizes.label), 0);
    expect(need(long) - need(short)).toBeGreaterThanOrEqual(6);
    return Math.ceil((need(short) + need(long)) / 2);
  }

  const cases: [number[], number, string[], string[]][] = [
    // Before the fix the key read "100" at both ends at 250 px, fontSize
    // 16, and "1.2e-4" at both ends at 300 px, fontSize 20.
    [[100.1, 100.25, 100.4], 16, ["100", "100"], ["100.1", "100.4"]],
    [
      [0.000123457, 0.0001237, 0.000123999],
      20,
      ["1.2e-4", "1.2e-4"],
      ["1.23e-4", "1.24e-4"],
    ],
  ];
  for (const [values, fontSize, same, differ] of cases) {
    it(`leaves the key out when fewer digits print ${same[0]} at both ends, fontSize ${fontSize}`, () => {
      // Too narrow for the ends that still differ, wide enough for those
      // that read the same.
      const width = widthBetween(same, differ, fontSize);
      const el = document.createElement("div");
      el.style.cssText = `width:${width}px;height:300px;`;
      document.body.appendChild(el);
      instances.push(
        createTreemap(el, {
          data: tree(values),
          options: { colorBy: "value", theme: { fontSize, padding: 0 } },
        }),
      );
      expect(el.querySelector("svg linearGradient"), `${width} px`).toBeNull();
      expect(texts(el)).not.toContain(same[0]);
    });
  }
});
