import { afterEach, describe, expect, it } from "vitest";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createProfile } from "../../src/components/profile.js";
import { createVolcano } from "../../src/components/volcano.js";
import {
  autoResize,
  contentOrigin,
  type PlotomicsInstance,
} from "../../src/core/index.js";

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

/** A heatmap, destroyed after the test. */
function heat(el: HTMLElement) {
  const plot = createHeatmap(el, { data: heatmapData });
  instances.push(plot);
  return plot;
}

/** The heights of two elements. */
const el2 = (a: Element, b: Element) => [height(a), height(b)];

/** Whether `after` starts at or below the bottom of `el`. */
const below = (el: Element, after: Element) =>
  after.getBoundingClientRect().top >= el.getBoundingClientRect().bottom;

describe("an element drawn before it is added to the page", () => {
  it("takes the fallback height without autoResize", async () => {
    const el = document.createElement("div");
    heat(el);
    const after = paragraph();
    document.body.append(el, after);
    await frames();
    expect(height(el)).toBe(480);
    expect(svgHeight(el)).toBe(480);
    expect(below(el, after)).toBe(true);
  });

  it("drops the fallback in a grid row, without autoResize", async () => {
    const el = document.createElement("div");
    heat(el);
    const grid = document.createElement("div");
    grid.style.cssText =
      "display:grid;grid-template-rows:300px 100px;width:600px;";
    const next = document.createElement("div");
    grid.append(el, next);
    document.body.appendChild(grid);
    await frames();
    expect(height(el)).toBe(300);
    expect(el.hasAttribute(FALLBACK)).toBe(false);
  });

  it("lets a page rule of the lowest specificity win", async () => {
    // A type selector, and a rule of zero specificity: both below an
    // attribute selector such as [data-plotomics-fallback].
    addStyle("section { height: 200px; } :where(.zero) { height: 210px; }");
    const a = document.createElement("section");
    heat(a);
    const b = document.createElement("div");
    b.className = "zero";
    heat(b);
    document.body.append(a, b);
    // At once, by the cascade alone, before anything runs on the element.
    expect(el2(a, b)).toEqual([200, 210]);
    await frames();
    expect(el2(a, b)).toEqual([200, 210]);
  });

  it("lets a height in a cascade layer win, as Tailwind writes them", async () => {
    addStyle("@layer utilities { .h-64 { height: 256px; } }");
    const el = document.createElement("div");
    el.className = "h-64";
    heat(el);
    document.body.appendChild(el);
    expect(height(el)).toBe(256);
    await frames();
    expect(height(el)).toBe(256);
  });

  it("takes the fallback height inside a shadow root, without autoResize", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const el = document.createElement("div");
    heat(el);
    const after = paragraph();
    root.append(el, after);
    await frames();
    expect(height(el)).toBe(480);
    expect(svgHeight(el)).toBe(480);
    expect(below(el, after)).toBe(true);
  });
});

describe("an element with padding and no CSS height", () => {
  // The plot fills the content box: 480 px, with 8 px of padding above and
  // below it.
  it("is drawn at the fallback content height in the page", () => {
    const el = document.createElement("div");
    el.style.padding = "8px";
    const after = paragraph();
    document.body.append(el, after);
    heat(el);
    expect(el.clientHeight).toBe(496);
    expect(svgHeight(el)).toBe(480);
    expect(below(el, after)).toBe(true);
  });

  it("keeps the fallback when drawn before it is added, with autoResize", async () => {
    const el = document.createElement("div");
    el.style.padding = "8px";
    const plot = heat(el);
    const after = paragraph();
    document.body.append(el, after);
    stops.push(autoResize(el, plot));
    await frames(6);
    expect(el.clientHeight).toBe(496);
    expect(svgHeight(el)).toBe(480);
    expect(el.hasAttribute(FALLBACK)).toBe(true);
    expect(below(el, after)).toBe(true);
  });

  it("gets the fallback from autoResize when shown from a hidden tab", async () => {
    const tab = document.createElement("div");
    tab.style.display = "none";
    const el = document.createElement("div");
    el.style.padding = "8px";
    const after = paragraph();
    tab.append(el, after);
    document.body.appendChild(tab);
    const plot = heat(el);
    stops.push(autoResize(el, plot));
    tab.style.display = "";
    await frames(6);
    expect(el.clientHeight).toBe(496);
    expect(svgHeight(el)).toBe(480);
    expect(below(el, after)).toBe(true);
  });
});

describe("the fallback height", () => {
  it("works in a page whose CSP blocks inline style elements", async () => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:800px;height:700px;";
    frame.srcdoc =
      "<!doctype html><html><head>" +
      `<meta http-equiv="Content-Security-Policy" content="style-src 'self'">` +
      '</head><body><div id="p"></div><p id="q">below</p></body></html>';
    document.body.appendChild(frame);
    await new Promise((r) => frame.addEventListener("load", r, { once: true }));
    const doc = frame.contentDocument as Document;
    const el = doc.getElementById("p") as HTMLElement;
    heat(el);
    await frames();
    expect(height(el)).toBe(480);
    expect(below(el, doc.getElementById("q") as HTMLElement)).toBe(true);
  });

  it("is removed when the plot is destroyed", () => {
    const el = document.createElement("div");
    el.style.width = "600px";
    document.body.appendChild(el);
    const plot = createHeatmap(el, { data: heatmapData });
    expect(height(el)).toBe(480);
    plot.destroy();
    expect(el.hasAttribute(FALLBACK)).toBe(false);
    expect(height(el)).toBe(0);
  });
});

/** Where the SVG layer of a plot sits, relative to its element's border box. */
function svgBox(el: HTMLElement) {
  const e = el.getBoundingClientRect();
  const s = (el.querySelector("svg") as SVGSVGElement).getBoundingClientRect();
  return {
    x: s.left - e.left,
    y: s.top - e.top,
    width: s.width,
    height: s.height,
  };
}

describe("a padded element", () => {
  it("has the plot in its content box", () => {
    const el = document.createElement("div");
    el.style.cssText = "width:600px;height:300px;padding:20px;";
    document.body.appendChild(el);
    instances.push(
      createVolcano(el, { data: volcanoData }) as PlotomicsInstance<unknown>,
    );
    expect(svgBox(el)).toEqual({ x: 20, y: 20, width: 600, height: 300 });
    const s = (
      el.querySelector("svg") as SVGSVGElement
    ).getBoundingClientRect();
    expect(contentOrigin(el)).toEqual({ left: s.left, top: s.top });
  });

  it("has the plot in its content box with box-sizing: border-box", () => {
    const el = document.createElement("div");
    el.style.cssText =
      "box-sizing:border-box;width:600px;height:300px;padding:20px;";
    document.body.appendChild(el);
    instances.push(
      createVolcano(el, { data: volcanoData }) as PlotomicsInstance<unknown>,
    );
    expect(svgBox(el)).toEqual({ x: 20, y: 20, width: 560, height: 260 });
  });

  it("has the plot in its content box when drawn before it is added", async () => {
    const el = document.createElement("div");
    el.style.cssText = "width:600px;padding:20px;";
    const plot = heat(el);
    const after = paragraph();
    document.body.append(el, after);
    stops.push(autoResize(el, plot));
    await frames(6);
    expect(svgBox(el)).toEqual({ x: 20, y: 20, width: 600, height: 480 });
    expect(below(el, after)).toBe(true);
  });

  it("reads the pointer from where the plot starts", () => {
    // Thirty narrow bars: a pointer read 20 px off lands on another bar.
    const n = 30;
    const data = {
      columns: {
        value: Array.from({ length: n }, (_, i) => i + 1),
        label: Array.from({ length: n }, (_, i) => `bar${i}`),
      },
    };
    const tipAt = (el: HTMLElement, fx: number, fy: number) => {
      const s = (
        el.querySelector("svg") as SVGSVGElement
      ).getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: s.left + fx * s.width,
          clientY: s.top + fy * s.height,
          bubbles: true,
        }),
      );
      const tip = el.querySelector("[data-plotomics-tooltip]") as HTMLElement;
      return tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
    };
    const plain = document.createElement("div");
    plain.style.cssText = "width:600px;height:300px;";
    const padded = document.createElement("div");
    padded.style.cssText = "width:600px;height:300px;padding:20px;";
    document.body.append(plain, padded);
    instances.push(createProfile(plain, { data }));
    instances.push(createProfile(padded, { data }));
    for (const [fx, fy] of [
      [0.5, 0.45],
      [0.8, 0.5],
    ]) {
      const want = tipAt(plain, fx as number, fy as number);
      expect(want).toMatch(/^bar/);
      expect(tipAt(padded, fx as number, fy as number)).toBe(want);
    }
  });
});

describe("the fallback rules", () => {
  it("come before a page layer that is already in the page", async () => {
    // A fresh page whose own stylesheet declares a layer before any plot
    // is made: the rules added later must still rank below it.
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:800px;height:700px;";
    frame.srcdoc =
      "<!doctype html><html><head>" +
      "<style>@layer utilities { .h-64 { height: 256px; } }</style>" +
      "</head><body></body></html>";
    document.body.appendChild(frame);
    await new Promise((r) => frame.addEventListener("load", r, { once: true }));
    const doc = frame.contentDocument as Document;
    const el = doc.createElement("div");
    el.className = "h-64";
    heat(el);
    doc.body.appendChild(el);
    expect(height(el)).toBe(256);
    await frames();
    expect(height(el)).toBe(256);
  });

  it("follow an element moved into a second shadow root", async () => {
    const roots = [0, 1].map(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      return host.attachShadow({ mode: "open" });
    });
    const el = document.createElement("div");
    heat(el);
    (roots[0] as ShadowRoot).appendChild(el);
    await frames();
    expect(height(el)).toBe(480);
    const after = paragraph();
    (roots[1] as ShadowRoot).append(el, after);
    await frames();
    expect(height(el)).toBe(480);
    expect(below(el, after)).toBe(true);
  });
});
