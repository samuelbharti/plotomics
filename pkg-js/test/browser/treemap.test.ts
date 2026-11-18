import { afterEach, describe, expect, it } from "vitest";
import { createTreemap } from "../../src/components/treemap.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { drawnPixels } from "./helpers.js";

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
    const tm = createTreemap(container(), { data: pathways(false) });
    instances.push(tm);
    const png = await tm.exportPNG?.(1);
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
    expect(tip?.textContent).toMatch(/group: Pathway (one|two)/);
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
});
