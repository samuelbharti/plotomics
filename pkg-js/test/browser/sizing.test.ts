import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createVolcano } from "../../src/components/volcano.js";
import { autoResize, type PlotomicsInstance } from "../../src/core/index.js";

// A plot made in plain JavaScript, with no wrapper to size its element.

const heatmapData = {
  columns: { values: [0, 0.5, 1, 1.5] },
  meta: { nrows: 2, ncols: 2 },
};
const volcanoData = { columns: { x: [-1, 0, 1], y: [1, 2, 3] } };
const FALLBACK = "data-plotomics-fallback";

let instances: PlotomicsInstance<unknown>[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops.length = 0;
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
  for (const s of Array.from(
    document.head.querySelectorAll("style[data-test]"),
  )) {
    s.remove();
  }
});

/** A stylesheet for one test, removed after it. */
function addStyle(css: string) {
  const s = document.createElement("style");
  s.dataset.test = "1";
  s.textContent = css;
  document.head.appendChild(s);
}

/** A paragraph of text, to show what follows a plot in the page. */
function paragraph() {
  const p = document.createElement("p");
  p.textContent = "text below the plot";
  return p;
}

/** Wait `n` frames, for ResizeObserver callbacks and what they change. */
const frames = (n = 4) =>
  new Promise<void>((resolve) => {
    let k = 0;
    const step = () => (++k >= n ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const svgHeight = (el: HTMLElement) =>
  Number((el.querySelector("svg") as SVGSVGElement).getAttribute("height"));
const height = (el: HTMLElement) => el.getBoundingClientRect().height;

describe("an element with no CSS height", () => {
  it("gets the fallback height, so the plot does not cover what follows", () => {
    const el = document.createElement("div");
    el.style.width = "600px";
    const after = paragraph();
    document.body.append(el, after);
    instances.push(
      createVolcano(el, { data: volcanoData }) as PlotomicsInstance<unknown>,
    );
    expect(height(el)).toBe(480);
    expect(after.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      el.getBoundingClientRect().bottom,
    );
    // No inline height, which would win over every CSS rule.
    expect(el.style.height).toBe("");
  });

  it("takes the fallback height when it is drawn before it is added", async () => {
    // The Quarto OJS pattern: make the element, draw, then add it.
    const el = document.createElement("div");
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    const after = paragraph();
    document.body.append(el, after);
    stops.push(autoResize(el, plot));
    await frames();
    expect(height(el)).toBe(480);
    expect(svgHeight(el)).toBe(480);
    expect(after.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      el.getBoundingClientRect().bottom,
    );
  });

  it("lets a CSS height win when it is drawn before it is added", () => {
    addStyle(".box { height: 300px; }");
    const el = document.createElement("div");
    el.className = "box";
    instances.push(createHeatmap(el, { data: heatmapData }));
    document.body.appendChild(el);
    expect(height(el)).toBe(300);
  });

  it("lets a stylesheet height added after the plot win", async () => {
    const el = document.createElement("div");
    el.style.width = "600px";
    document.body.appendChild(el);
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    stops.push(autoResize(el, plot));
    expect(height(el)).toBe(480);
    addStyle(".late { height: 260px; }");
    el.className = "late";
    await frames();
    expect(height(el)).toBe(260);
    expect(svgHeight(el)).toBe(260);
  });

  it("keeps a CSS height, also in a hidden tab", () => {
    addStyle(".plot-box { height: 300px; }");
    const tab = document.createElement("div");
    tab.style.display = "none";
    const el = document.createElement("div");
    el.className = "plot-box";
    tab.appendChild(el);
    document.body.appendChild(tab);
    instances.push(createHeatmap(el, { data: heatmapData }));
    expect(el.style.height).toBe("");
    tab.style.display = "";
    expect(height(el)).toBe(300);
  });
});

describe("an element made in a hidden tab", () => {
  it("gets no fallback height while hidden", () => {
    const tab = document.createElement("div");
    tab.style.display = "none";
    const el = document.createElement("div");
    tab.appendChild(el);
    document.body.appendChild(tab);
    instances.push(createHeatmap(el, { data: heatmapData }));
    expect(el.hasAttribute(FALLBACK)).toBe(false);
    expect(el.style.height).toBe("");
  });

  it("takes the height of its grid row once shown", async () => {
    const tab = document.createElement("div");
    tab.style.display = "none";
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-rows:300px 100px;width:600px;";
    const el = document.createElement("div");
    const next = document.createElement("div");
    next.textContent = "next row";
    grid.append(el, next);
    tab.appendChild(grid);
    document.body.appendChild(tab);
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    stops.push(autoResize(el, plot));
    tab.style.display = "";
    await frames();
    expect(height(el)).toBe(300);
    expect(svgHeight(el)).toBe(300);
    expect(next.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      el.getBoundingClientRect().bottom,
    );
  });

  it("fills an absolutely placed box once shown", async () => {
    const tab = document.createElement("div");
    tab.style.cssText =
      "display:none;position:relative;width:600px;height:250px;";
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;top:0;bottom:0;left:0;right:0;";
    tab.appendChild(el);
    document.body.appendChild(tab);
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    stops.push(autoResize(el, plot));
    tab.style.display = "block";
    await frames();
    expect(height(el)).toBe(250);
    expect(svgHeight(el)).toBe(250);
  });

  it("gets the fallback height from autoResize when shown with none", async () => {
    const tab = document.createElement("div");
    tab.style.display = "none";
    const el = document.createElement("div");
    const after = paragraph();
    tab.append(el, after);
    document.body.appendChild(tab);
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    stops.push(autoResize(el, plot));
    tab.style.display = "";
    await frames();
    expect(height(el)).toBe(480);
    expect(svgHeight(el)).toBe(480);
    expect(after.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      el.getBoundingClientRect().bottom,
    );
  });
});

describe("autoResize", () => {
  it("passes each new size of the element to resize", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:600px;height:300px;";
    document.body.appendChild(el);
    const sizes: [number, number][] = [];
    const stop = autoResize(el, {
      resize: (w, h) => sizes.push([w, h]),
    });
    await frames(2);
    el.style.width = "420px";
    el.style.height = "250px";
    await frames(2);
    expect(sizes.at(-1)).toEqual([420, 250]);

    // Hidden: no size to draw at, so no call.
    const calls = sizes.length;
    el.style.display = "none";
    await frames(2);
    expect(sizes.length).toBe(calls);

    stop();
    el.style.display = "";
    el.style.width = "300px";
    await frames(2);
    expect(sizes.length).toBe(calls);
  });

  it("lets a plain JS plot follow its element", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:600px;height:300px;";
    document.body.appendChild(el);
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    stops.push(autoResize(el, plot));
    const svgWidth = () =>
      Number((el.querySelector("svg") as SVGSVGElement).getAttribute("width"));
    expect(svgWidth()).toBe(600);
    el.style.width = "400px";
    await frames(2);
    expect(svgWidth()).toBe(400);
  });

  it("drops the fallback height of an element added to a grid row", async () => {
    const el = document.createElement("div");
    const plot = createHeatmap(el, { data: heatmapData });
    instances.push(plot);
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-rows:300px 100px;width:600px;";
    const next = document.createElement("div");
    grid.append(el, next);
    document.body.appendChild(grid);
    stops.push(autoResize(el, plot));
    await frames();
    expect(height(el)).toBe(300);
    expect(svgHeight(el)).toBe(300);
    expect(el.hasAttribute(FALLBACK)).toBe(false);
  });
});
