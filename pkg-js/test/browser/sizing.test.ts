import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createVolcano } from "../../src/components/volcano.js";
import { autoResize, type PlotomicsInstance } from "../../src/core/index.js";

// A plot made in plain JavaScript, with no wrapper to size its element.

const heatmapData = {
  columns: { values: [0, 0.5, 1, 1.5] },
  meta: { nrows: 2, ncols: 2 },
};

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

/** A div in the page, styled by `css`, followed by a paragraph. */
function placed(css: string) {
  const el = document.createElement("div");
  el.style.cssText = css;
  const after = document.createElement("p");
  after.textContent = "text below the plot";
  document.body.append(el, after);
  return { el, after };
}

/** Wait for the ResizeObserver callbacks of the next frames. */
const frames = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );

describe("an element with no CSS height", () => {
  it("gets the fallback height, so the plot does not cover what follows", () => {
    const { el, after } = placed("width:600px;");
    const plot = createVolcano(el, {
      data: { columns: { x: [-1, 0, 1], y: [1, 2, 3] } },
    });
    instances.push(plot as PlotomicsInstance<unknown>);
    expect(el.getBoundingClientRect().height).toBe(480);
    expect(after.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      el.getBoundingClientRect().bottom,
    );
  });

  it("keeps a CSS height, also in a hidden tab", () => {
    const style = document.createElement("style");
    style.textContent = ".plot-box { height: 300px; }";
    document.head.appendChild(style);
    try {
      const tab = document.createElement("div");
      tab.style.display = "none";
      const el = document.createElement("div");
      el.className = "plot-box";
      tab.appendChild(el);
      document.body.appendChild(tab);
      instances.push(createHeatmap(el, { data: heatmapData }));
      expect(el.style.height).toBe("");
      tab.style.display = "";
      expect(el.getBoundingClientRect().height).toBe(300);
    } finally {
      style.remove();
    }
  });

  it("leaves an element that is not in the page yet alone", () => {
    const el = document.createElement("div");
    instances.push(createHeatmap(el, { data: heatmapData }));
    expect(el.style.height).toBe("");
  });
});

describe("autoResize", () => {
  it("passes each new size of the element to resize", async () => {
    const { el } = placed("width:600px;height:300px;");
    const sizes: [number, number][] = [];
    const stop = autoResize(el, {
      resize: (w, h) => sizes.push([w, h]),
    });
    await frames();
    el.style.width = "420px";
    el.style.height = "250px";
    await frames();
    expect(sizes.at(-1)).toEqual([420, 250]);

    // Hidden: no size to draw at, so no call.
    const calls = sizes.length;
    el.style.display = "none";
    await frames();
    expect(sizes.length).toBe(calls);

    stop();
    el.style.display = "";
    el.style.width = "300px";
    await frames();
    expect(sizes.length).toBe(calls);
  });

  it("lets a plain JS plot follow its element", async () => {
    const { el } = placed("width:600px;height:300px;");
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    const stop = autoResize(el, plot);
    const svgWidth = () =>
      Number((el.querySelector("svg") as SVGSVGElement).getAttribute("width"));
    expect(svgWidth()).toBe(600);
    el.style.width = "400px";
    await frames();
    expect(svgWidth()).toBe(400);
    stop();
  });
});
