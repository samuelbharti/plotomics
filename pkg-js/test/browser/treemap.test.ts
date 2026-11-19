import { afterEach, describe, expect, it } from "vitest";
import { createTreemap } from "../../src/components/treemap.js";
import {
  type PlotomicsInstance,
  ramp,
  rgbToHex,
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
