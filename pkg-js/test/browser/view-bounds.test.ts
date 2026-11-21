import Sigma from "sigma";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createEmbedding } from "../../src/components/embedding.js";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createHic } from "../../src/components/hic.js";
import { createNetwork } from "../../src/components/network.js";
import { createVolcano } from "../../src/components/volcano.js";
import {
  type PlotomicsInstance,
  type PlotomicsTheme,
  darkTheme,
} from "../../src/core/index.js";
import { canvasPNG, drawnPixels } from "./helpers.js";

// The volcano and the embedding (regl-scatterplot) and the network (sigma)
// had no limits on pan and zoom: a view could zoom out forever, pan the
// data off into empty space, and zoom in until the axes ran out of digits.
// Now zooming out stops at the view of all the data, a pan stops at its
// edges, and zooming in stops at 1/10,000 of its range, unless boundedView
// is false. The heatmap and the Hi-C map were bounded already. None of the
// five had a way back: each now has a reset button in the top right corner
// of its plot area, shown while the view is away from home, a double-click
// that goes home, and resetView().

const poll = { timeout: 10_000, interval: 50 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
async function frames(n: number) {
  for (let i = 0; i < n; i += 1) await frame();
}

type Handle = PlotomicsInstance<unknown> & { resetView(): void };

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

function container(width = 640, height = 480) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** Deterministic values spread over [lo, hi]. */
function spread(n: number, lo: number, hi: number, seed: number) {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  });
}

function volcanoData() {
  const x = spread(2000, -4, 4, 1);
  const y = spread(2000, 0, 20, 2);
  return { columns: { x, y, label: x.map((_, i) => `G${i}`) } };
}

const CLUSTERS = ["B cells", "CD4 T cells", "NK cells", "Monocytes"];
function embeddingData(coloured = false) {
  const x = spread(800, -8, 12, 3);
  const y = spread(800, -6, 9, 4);
  const columns: Record<string, unknown[]> = { x, y };
  if (coloured) columns.color = x.map((_, i) => CLUSTERS[i % 4] as string);
  return { columns: columns as Record<string, number[]> };
}

const GENES = ["TP53", "MDM2", "CDKN1A", "BRCA1", "ATM", "CHEK2"];
/** Six genes on a ring, and a seventh at its centre, joined to the first. */
function networkData(grouped = false) {
  const n = GENES.length;
  const id = [...GENES, "ARF"];
  return {
    columns: {
      id,
      x: [...GENES.map((_, i) => Math.cos((2 * Math.PI * i) / n) * 10), 0],
      y: [...GENES.map((_, i) => Math.sin((2 * Math.PI * i) / n) * 10), 0],
      size: id.map(() => 10),
    },
    meta: {
      edges: [...GENES.map((g, i) => [g, GENES[(i + 1) % n]]), ["ARF", "TP53"]],
      ...(grouped
        ? {
            nodeGroup: id.map(
              (_, i) => ["p53 pathway", "DNA repair"][i % 2] as string,
            ),
          }
        : {}),
    },
  };
}

function matrixData(nrows = 24, ncols = 12) {
  const values = Float64Array.from(
    { length: nrows * ncols },
    (_, k) => Math.sin(k * 0.37) * 3 + (k % 7),
  );
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => `GENE_${i + 1}`),
      colLabels: Array.from({ length: ncols }, (_, i) => `sample_${i + 1}`),
    },
  };
}

function hicData(n = 64) {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      values[r * n + c] = 1000 / (Math.abs(r - c) + 1);
    }
  }
  return { columns: { values }, meta: { n, binSize: 10_000 } };
}

/** The reset button of the plot in `el`. */
function resetButton(el: HTMLElement): HTMLButtonElement {
  const b = el.querySelector('button[aria-label="Reset view"]');
  if (!b) throw new Error("the plot has no reset button");
  return b as HTMLButtonElement;
}

/** Whether the reset button is on screen. */
function buttonShown(el: HTMLElement): boolean {
  const b = el.querySelector(
    'button[aria-label="Reset view"]',
  ) as HTMLButtonElement | null;
  return !!b && !b.hidden && b.getBoundingClientRect().width > 0;
}

function centre(target: Element) {
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** `times` wheel steps on `target` at its centre. */
function wheel(target: Element, deltaY: number, times = 1) {
  const c = centre(target);
  for (let i = 0; i < times; i += 1) {
    target.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        clientX: c.x,
        clientY: c.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// The scatter plots: the view is read from the tick labels.
// ---------------------------------------------------------------------------

/** Numeric tick labels with `anchor`, as [value, place along the axis]. */
function tickLabels(el: HTMLElement, anchor: "middle" | "end") {
  return (Array.from(el.querySelectorAll("svg text")) as SVGTextElement[])
    .filter(
      (t) =>
        t.getAttribute("text-anchor") === anchor &&
        /^-?[\d.]+(e[+-]\d+)?$/.test(t.textContent ?? ""),
    )
    .map((t) => {
      const size = Number(t.getAttribute("font-size"));
      // A y label's baseline sits 0.35 of its size below its tick.
      const at =
        anchor === "middle"
          ? Number(t.getAttribute("x"))
          : Number(t.getAttribute("y")) - Math.round(size * 0.35);
      return [Number(t.textContent), at] as const;
    });
}

interface View {
  x: [number, number];
  y: [number, number];
}

/** The data range the plot area of a scatter plot shows. */
function scatterView(el: HTMLElement): View {
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const left = Number.parseFloat(canvas.style.left);
  const top = Number.parseFloat(canvas.style.top);
  const w = Number.parseFloat(canvas.style.width);
  const h = Number.parseFloat(canvas.style.height);
  const range = (
    ticks: (readonly [number, number])[],
    start: number,
    size: number,
  ): [number, number] => {
    if (ticks.length < 2) return [Number.NaN, Number.NaN];
    const [v0, p0] = ticks[0] as readonly [number, number];
    const [v1, p1] = ticks[ticks.length - 1] as readonly [number, number];
    const perUnit = (p1 - p0) / (v1 - v0);
    const a = v0 + (start - p0) / perUnit;
    const b = v0 + (start + size - p0) / perUnit;
    return a < b ? [a, b] : [b, a];
  };
  return {
    x: range(tickLabels(el, "middle"), left, w),
    y: range(tickLabels(el, "end"), top, h),
  };
}

const span = (r: [number, number]) => r[1] - r[0];

/** Whether two views agree to `tol` of the range of `home`. */
function sameView(a: View, b: View, home: View, tol = 1e-6): boolean {
  return (["x", "y"] as const).every(
    (k) =>
      Math.abs(a[k][0] - b[k][0]) <= tol * span(home[k]) &&
      Math.abs(a[k][1] - b[k][1]) <= tol * span(home[k]),
  );
}

/** Whether `a` lies inside `home`, to `tol` of its range. */
function inside(a: View, home: View, tol = 1e-4): boolean {
  return (["x", "y"] as const).every(
    (k) =>
      a[k][0] >= home[k][0] - tol * span(home[k]) &&
      a[k][1] <= home[k][1] + tol * span(home[k]),
  );
}

/** Press at the centre of the canvas, move by (dx, dy) and let go. */
async function dragScatter(canvas: HTMLCanvasElement, dx: number, dy: number) {
  const c = centre(canvas);
  const at = (x: number, y: number, buttons: number) => ({
    clientX: x,
    clientY: y,
    bubbles: true,
    buttons,
  });
  window.dispatchEvent(new MouseEvent("mousemove", at(c.x, c.y, 0)));
  await frames(2);
  canvas.dispatchEvent(new MouseEvent("mousedown", at(c.x, c.y, 1)));
  await frames(1);
  window.dispatchEvent(new MouseEvent("mousemove", at(c.x + dx, c.y + dy, 1)));
  await frames(2);
  window.dispatchEvent(new MouseEvent("mouseup", at(c.x + dx, c.y + dy, 0)));
  await frames(3);
}

interface ScatterCase {
  name: string;
  make(el: HTMLElement, options?: Record<string, unknown>): Handle;
}

const SCATTERS: ScatterCase[] = [
  {
    name: "volcano",
    make: (el, o) =>
      createVolcano(el, {
        data: volcanoData(),
        options: { labelTopN: 0, ...o },
      }) as unknown as Handle,
  },
  {
    name: "embedding",
    make: (el, o) =>
      createEmbedding(el, {
        data: embeddingData(),
        options: { showAxes: true, showLegend: false, ...o },
      }) as unknown as Handle,
  },
];

/** A scatter plot drawn and at rest, with the view it starts at. */
async function startScatter(
  c: ScatterCase,
  options: Record<string, unknown> = {},
) {
  const el = container();
  const plot = c.make(el, options);
  instances.push(plot);
  await expect
    .poll(async () => {
      const png = await canvasPNG(el);
      return png ? drawnPixels(png) : 0;
    }, poll)
    .toBeGreaterThan(100);
  await wait(300);
  await frames(2);
  const canvas = el.querySelector("canvas") as HTMLCanvasElement;
  const home = scatterView(el);
  expect(Number.isFinite(home.x[0]) && Number.isFinite(home.y[0])).toBe(true);
  return { el, plot, canvas, home };
}

/** Wait for the overlay to follow the camera. */
async function settle() {
  await frames(4);
  await wait(150);
  await frames(2);
}

describe.each(SCATTERS)("$name view limits", (c) => {
  it("stops zooming out at the view of all the data", async () => {
    const { el, canvas, home } = await startScatter(c);
    wheel(canvas, 240, 10);
    await settle();
    // Before the fix the view went on growing.
    expect(sameView(scatterView(el), home, home)).toBe(true);
    expect(buttonShown(el)).toBe(false);
    // In and back out again ends exactly at the start view.
    wheel(canvas, -120, 3);
    await settle();
    expect(buttonShown(el)).toBe(true);
    wheel(canvas, 240, 10);
    await settle();
    expect(sameView(scatterView(el), home, home)).toBe(true);
    expect(buttonShown(el)).toBe(false);
  });

  it("zooms out past the data with boundedView false, and still goes home", async () => {
    const { el, plot, canvas, home } = await startScatter(c, {
      boundedView: false,
    });
    wheel(canvas, 240, 4);
    await settle();
    const v = scatterView(el);
    expect(span(v.x)).toBeGreaterThan(1.5 * span(home.x));
    expect(span(v.y)).toBeGreaterThan(1.5 * span(home.y));
    expect(buttonShown(el)).toBe(true);
    plot.resetView();
    await expect
      .poll(() => sameView(scatterView(el), home, home), poll)
      .toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
  });

  it("has nothing to pan at the view of all the data", async () => {
    const { el, canvas, home } = await startScatter(c);
    await dragScatter(canvas, 200, 120);
    await settle();
    expect(sameView(scatterView(el), home, home)).toBe(true);
    expect(buttonShown(el)).toBe(false);
  });

  it("stops a pan at each edge of the data when zoomed in", async () => {
    const { el, canvas, home } = await startScatter(c);
    wheel(canvas, -120, 4);
    await settle();
    const zoomed = scatterView(el);
    expect(span(zoomed.x)).toBeLessThan(0.5 * span(home.x));
    const tol = 1e-4;
    const edges: [number, number, (v: View) => number, number][] = [
      [3000, 0, (v) => v.x[0], home.x[0]],
      [-3000, 0, (v) => v.x[1], home.x[1]],
      [0, 3000, (v) => v.y[1], home.y[1]],
      [0, -3000, (v) => v.y[0], home.y[0]],
    ];
    for (const [dx, dy, edge, want] of edges) {
      await dragScatter(canvas, dx, dy);
      await settle();
      const v = scatterView(el);
      const what = `a drag of (${dx}, ${dy})`;
      // Before the fix the view went on past the data.
      expect(inside(v, home), what).toBe(true);
      const axis = dx !== 0 ? home.x : home.y;
      expect(Math.abs(edge(v) - want), what).toBeLessThanOrEqual(
        tol * span(axis),
      );
      // A pan keeps the zoom.
      expect(span(v.x) / span(zoomed.x), what).toBeCloseTo(1, 4);
      expect(span(v.y) / span(zoomed.y), what).toBeCloseTo(1, 4);
    }
  });

  it("pans past the data with boundedView false", async () => {
    const { el, canvas, home } = await startScatter(c, { boundedView: false });
    // The view can leave its start, so the reset button shows.
    await dragScatter(canvas, 200, 0);
    await settle();
    expect(buttonShown(el)).toBe(true);
    wheel(canvas, -120, 4);
    await settle();
    await dragScatter(canvas, 3000, 0);
    await settle();
    const v = scatterView(el);
    expect(v.x[0]).toBeLessThan(home.x[0] - span(home.x));
  });

  it("stops zooming in at 1/10,000 of the range of the data", async () => {
    const { el, canvas, home } = await startScatter(c);
    const homeWidth = Number.parseFloat(canvas.style.width);
    wheel(canvas, -120, 120);
    await settle();
    await expect
      .poll(() => Number.isFinite(scatterView(el).x[0]), poll)
      .toBe(true);
    await wait(300);
    const v = scatterView(el);
    // Long labels deep in a zoom widen the margins, which narrows the
    // plot area: x shows that much less at the same scale.
    const width = Number.parseFloat(canvas.style.width);
    const share = 1e-4 * (width / homeWidth);
    expect(span(v.x) / span(home.x) / share).toBeCloseTo(1, 2);
    expect(span(v.y) / span(home.y) / 1e-4).toBeCloseTo(1, 2);
    expect(inside(v, home)).toBe(true);
  });

  it("zooms in past 1/10,000 with boundedView false", async () => {
    const { el, canvas, home } = await startScatter(c, { boundedView: false });
    wheel(canvas, -120, 40);
    await settle();
    await wait(300);
    const v = scatterView(el);
    expect(span(v.y) / span(home.y)).toBeLessThan(0.5e-4);
  });

  it("goes home to new data, and bounds the view to it", async () => {
    const { el, plot, canvas, home } = await startScatter(c);
    wheel(canvas, -120, 3);
    await settle();
    expect(buttonShown(el)).toBe(true);
    // The same points, spread three times wider and moved up.
    const old = (c.name === "volcano" ? volcanoData() : embeddingData())
      .columns as unknown as Record<string, number[]>;
    const x = (old.x as number[]).map((v) => v * 3);
    const y = (old.y as number[]).map((v) => v * 3 + 5);
    plot.setData({ columns: { ...old, x, y } });
    await expect.poll(() => buttonShown(el), poll).toBe(false);
    await wait(300);
    const next = scatterView(el);
    expect(span(next.x)).toBeGreaterThan(2 * span(home.x));
    // Zooming out stops at the view of the new data.
    wheel(canvas, 240, 10);
    await settle();
    expect(sameView(scatterView(el), next, next)).toBe(true);
    expect(buttonShown(el)).toBe(false);
  });

  it("takes boundedView from setOptions, and bounds the view it has", async () => {
    const { el, plot, canvas, home } = await startScatter(c, {
      boundedView: false,
    });
    wheel(canvas, 240, 4);
    await settle();
    expect(span(scatterView(el).x)).toBeGreaterThan(1.5 * span(home.x));
    plot.setOptions({ boundedView: true });
    await expect
      .poll(() => sameView(scatterView(el), home, home), poll)
      .toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
    wheel(canvas, 240, 4);
    await settle();
    expect(sameView(scatterView(el), home, home)).toBe(true);
    plot.setOptions({ boundedView: false });
    wheel(canvas, 240, 4);
    await settle();
    expect(span(scatterView(el).x)).toBeGreaterThan(1.5 * span(home.x));
  });
});

describe("scatter plot selection and the reset", () => {
  /** The pixels of the canvas in the colour of a selected point. */
  async function selectedPixels(el: HTMLElement): Promise<number> {
    const png = (await canvasPNG(el)) as Blob;
    const bitmap = await createImageBitmap(png);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // regl-scatterplot draws a selected point in [0, 140, 255].
    for (let i = 0; i < d.length; i += 4) {
      if (
        (d[i] as number) < 40 &&
        Math.abs((d[i + 1] as number) - 140) < 30 &&
        (d[i + 2] as number) > 225
      ) {
        n += 1;
      }
    }
    return n;
  }

  /** Lasso the middle of the canvas, holding shift when `shift` is set. */
  async function lasso(canvas: HTMLCanvasElement, shift: boolean) {
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({
      clientX: r.left + fx * r.width,
      clientY: r.top + fy * r.height,
      bubbles: true,
      buttons: 1,
      shiftKey: shift,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", at(0.2, 0.2)));
    for (const [fx, fy] of [
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
      [0.2, 0.21],
    ] as const) {
      for (let s = 1; s <= 10; s += 1) {
        window.dispatchEvent(new MouseEvent("mousemove", at(fx, fy)));
        await wait(5);
      }
    }
    window.dispatchEvent(
      new MouseEvent("mouseup", { ...at(0.2, 0.21), buttons: 0 }),
    );
  }

  it("goes home on a double-click in the embedding, and clears the selection", async () => {
    const el = container();
    const seen: number[][] = [];
    const plot = createEmbedding(el, {
      data: embeddingData(),
      options: {
        showAxes: true,
        mouseMode: "lasso",
        onSelect: (rows) => seen.push(rows),
      },
    });
    instances.push(plot);
    await wait(400);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const home = scatterView(el);
    wheel(canvas, -120, 3);
    await settle();
    expect(buttonShown(el)).toBe(true);
    // The lasso still selects in a zoomed, bounded view.
    await lasso(canvas, false);
    await expect
      .poll(() => plot.selectedIndices.length, poll)
      .toBeGreaterThan(0);
    const c = centre(canvas);
    canvas.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: c.x, clientY: c.y }),
    );
    await expect
      .poll(() => sameView(scatterView(el), home, home), poll)
      .toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
    expect(plot.selectedIndices).toEqual([]);
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it("goes home on a double-click in the volcano, and clears the selection", async () => {
    const el = container();
    const plot = createVolcano(el, {
      data: volcanoData(),
      options: { labelTopN: 0, pointSize: 6 },
    });
    instances.push(plot);
    await wait(400);
    await frames(2);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const home = scatterView(el);
    wheel(canvas, -120, 2);
    await settle();
    expect(buttonShown(el)).toBe(true);
    await lasso(canvas, true);
    await expect.poll(() => selectedPixels(el), poll).toBeGreaterThan(50);
    const c = centre(canvas);
    canvas.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: c.x, clientY: c.y }),
    );
    await expect
      .poll(() => sameView(scatterView(el), home, home), poll)
      .toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
    await expect.poll(() => selectedPixels(el), poll).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The network: the view is read from sigma's camera.
// ---------------------------------------------------------------------------

const HOME = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
const renderers = new Map<Element, Sigma>();
const proto = Sigma.prototype as unknown as {
  render: (...args: unknown[]) => unknown;
};
const realRender = proto.render;

/** The sigma renderer the network in `el` draws with. */
function rendererOf(el: HTMLElement): Sigma {
  const mouse = el.querySelector("canvas.sigma-mouse") as HTMLElement;
  const r = renderers.get(mouse.parentElement as HTMLElement);
  if (!r) throw new Error("no renderer drew in the plot");
  return r;
}

/** The box in graph coordinates the camera shows, at `state` when given. */
function graphBox(el: HTMLElement, state?: typeof HOME): View {
  const r = rendererOf(el);
  const { width, height } = r.getDimensions();
  const o = state ? { cameraState: state } : {};
  const a = r.viewportToGraph({ x: 0, y: 0 }, o);
  const b = r.viewportToGraph({ x: width, y: height }, o);
  return {
    x: [Math.min(a.x, b.x), Math.max(a.x, b.x)],
    y: [Math.min(a.y, b.y), Math.max(a.y, b.y)],
  };
}

function cameraOf(el: HTMLElement) {
  return rendererOf(el).getCamera().getState();
}

/**
 * Whether the camera is at home, give or take the float32 rounding of
 * sigma's matrices: a millionth of the graph.
 */
function atHome(el: HTMLElement): boolean {
  const s = cameraOf(el);
  return (
    Math.abs(s.x - 0.5) < 1e-6 &&
    Math.abs(s.y - 0.5) < 1e-6 &&
    Math.abs(s.ratio - 1) < 1e-6 &&
    Math.abs(s.angle) < 1e-6
  );
}

function mouseLayer(el: HTMLElement): HTMLCanvasElement {
  return el.querySelector("canvas.sigma-mouse") as HTMLCanvasElement;
}

/** `times` wheel steps, each left to end before the next. */
async function wheelNetwork(el: HTMLElement, deltaY: number, times = 1) {
  for (let i = 0; i < times; i += 1) {
    wheel(mouseLayer(el), deltaY);
    await wait(280);
  }
  await wait(100);
}

/** Press at the centre of the graph, move by (dx, dy) and let go. */
async function dragNetwork(el: HTMLElement, dx: number, dy: number) {
  const mouse = mouseLayer(el);
  const c = centre(mouse);
  const at = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    bubbles: true,
    button: 0,
  });
  mouse.dispatchEvent(new MouseEvent("mousedown", at(c.x, c.y)));
  for (let s = 1; s <= 4; s += 1) {
    document.dispatchEvent(
      new MouseEvent("mousemove", at(c.x + (dx * s) / 4, c.y + (dy * s) / 4)),
    );
    await wait(10);
  }
  document.dispatchEvent(new MouseEvent("mouseup", at(c.x + dx, c.y + dy)));
  // Sigma lets the view glide on for a while after the release.
  await wait(500);
}

async function startNetwork(options: Record<string, unknown> = {}) {
  const el = container();
  const plot = createNetwork(el, {
    data: networkData(),
    options: options as never,
  });
  instances.push(plot);
  await wait(300);
  await frames(2);
  expect(atHome(el)).toBe(true);
  return { el, plot };
}

describe("network view limits", () => {
  beforeAll(() => {
    proto.render = function (this: Sigma, ...args: unknown[]) {
      renderers.set(this.getContainer(), this);
      return realRender.apply(this, args);
    };
  });
  afterAll(() => {
    proto.render = realRender;
  });

  it("stops zooming out at the view of the whole graph", async () => {
    const { el } = await startNetwork();
    await wheelNetwork(el, 200, 3);
    // Before the fix each step zoomed out further.
    expect(atHome(el)).toBe(true);
    expect(buttonShown(el)).toBe(false);
    await wheelNetwork(el, -200, 2);
    expect(buttonShown(el)).toBe(true);
    await wheelNetwork(el, 200, 4);
    expect(atHome(el)).toBe(true);
    expect(buttonShown(el)).toBe(false);
  });

  it("has nothing to pan at the view of the whole graph", async () => {
    const { el } = await startNetwork();
    await dragNetwork(el, 200, 120);
    expect(atHome(el)).toBe(true);
    expect(buttonShown(el)).toBe(false);
  });

  it("stops a pan at each edge of the graph when zoomed in", async () => {
    const { el } = await startNetwork();
    await wheelNetwork(el, -200, 1);
    const home = graphBox(el, HOME);
    const zoomed = graphBox(el);
    expect(span(zoomed.x)).toBeLessThan(0.8 * span(home.x));
    for (const [dx, dy] of [
      [3000, 0],
      [-3000, 0],
      [0, 3000],
      [0, -3000],
    ] as const) {
      await dragNetwork(el, dx, dy);
      const v = graphBox(el);
      const what = `a drag of (${dx}, ${dy})`;
      // Before the fix the graph went off the screen.
      expect(inside(v, home, 1e-6), what).toBe(true);
      const axis = dx !== 0 ? "x" : "y";
      const touches = Math.min(
        Math.abs(v[axis][0] - home[axis][0]),
        Math.abs(v[axis][1] - home[axis][1]),
      );
      expect(touches, what).toBeLessThan(1e-6 * span(home[axis]));
      expect(span(v.x) / span(zoomed.x), what).toBeCloseTo(1, 6);
    }
    // A drag right shows the left edge.
    await dragNetwork(el, 3000, 0);
    expect(Math.abs(graphBox(el).x[0] - home.x[0])).toBeLessThan(
      1e-6 * span(home.x),
    );
  });

  it("keeps a zoomed view through a resize, inside the new view of the graph", async () => {
    const { el, plot } = await startNetwork();
    await wheelNetwork(el, -200, 2);
    const ratio = cameraOf(el).ratio;
    await dragNetwork(el, 3000, 0);
    el.style.width = "900px";
    el.style.height = "500px";
    plot.resize(900, 500);
    await wait(300);
    // The zoom stays, and the view stays inside what the home view shows
    // at the new size.
    expect(cameraOf(el).ratio).toBeCloseTo(ratio, 9);
    expect(inside(graphBox(el), graphBox(el, HOME), 1e-6)).toBe(true);
    expect(buttonShown(el)).toBe(true);
  });

  it("stops zooming in at 1/10,000 of the view of the whole graph", async () => {
    const { el } = await startNetwork();
    await wheelNetwork(el, -200, 22);
    // Before the fix the ratio went on falling, to 1.7^-22.
    expect(cameraOf(el).ratio).toBeCloseTo(1e-4, 12);
    const home = graphBox(el, HOME);
    const v = graphBox(el);
    expect(span(v.x) / span(home.x)).toBeCloseTo(1e-4, 9);
    expect(inside(v, home, 1e-9)).toBe(true);
  });

  it("moves freely with boundedView false", async () => {
    const { el } = await startNetwork({ boundedView: false });
    await wheelNetwork(el, 200, 2);
    expect(cameraOf(el).ratio).toBeGreaterThan(2);
    expect(buttonShown(el)).toBe(true);
    rendererOf(el).getCamera().setState({ ratio: 1e-6 });
    expect(cameraOf(el).ratio).toBe(1e-6);
    rendererOf(el).getCamera().setState({ ratio: 0.5 });
    await dragNetwork(el, 3000, 0);
    const home = graphBox(el, HOME);
    expect(graphBox(el).x[0]).toBeLessThan(home.x[0] - span(home.x));
    // The reset button still goes home.
    await userEvent.click(resetButton(el));
    await expect.poll(() => atHome(el), poll).toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
  });

  it("goes home on a double-click, where sigma zoomed in", async () => {
    const { el } = await startNetwork();
    const mouse = mouseLayer(el);
    const c = centre(mouse);
    const click = () =>
      mouse.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: c.x + 40,
          clientY: c.y + 30,
        }),
      );
    // At home a double-click does nothing: before the fix it zoomed in.
    click();
    await wait(40);
    click();
    await wait(500);
    expect(atHome(el)).toBe(true);
    await wheelNetwork(el, -200, 2);
    expect(atHome(el)).toBe(false);
    expect(buttonShown(el)).toBe(true);
    click();
    await wait(40);
    click();
    await expect.poll(() => atHome(el), poll).toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
  });

  it("still reports a clicked node with the reset button shown", async () => {
    let picked: string | null = null;
    const { el } = await startNetwork({
      onSelect: (n: string | null) => {
        picked = n;
      },
    });
    await wheelNetwork(el, -200, 1);
    expect(buttonShown(el)).toBe(true);
    const r = rendererOf(el);
    const graph = r.getGraph();
    const mouse = mouseLayer(el);
    const box = mouse.getBoundingClientRect();
    let target = "";
    let at = { x: 0, y: 0 };
    graph.forEachNode((node, attrs) => {
      const p = r.graphToViewport({ x: attrs.x, y: attrs.y });
      if (
        !target &&
        p.x > 20 &&
        p.y > 20 &&
        p.x < box.width - 60 &&
        p.y < box.height - 20
      ) {
        target = node;
        at = p;
      }
    });
    expect(target).not.toBe("");
    mouse.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: box.left + at.x,
        clientY: box.top + at.y,
      }),
    );
    expect(picked).toBe(target);
  });
});

// ---------------------------------------------------------------------------
// The reset button and resetView() on all five.
// ---------------------------------------------------------------------------

interface Zoomable {
  name: string;
  make(el: HTMLElement, theme?: Partial<PlotomicsTheme>): Handle;
  /** Wait for the plot to finish drawing. */
  ready(el: HTMLElement): Promise<void>;
  /** Zoom in, and wait for the view to follow. */
  zoom(el: HTMLElement): Promise<void>;
  /** The element a double-click goes to, and the point to click. */
  target(el: HTMLElement): HTMLElement;
  /** Text that names the view the plot shows. */
  view(el: HTMLElement): string;
  /** The plot area, which holds the reset button. */
  area(el: HTMLElement): DOMRect;
}

const overlay = (el: HTMLElement) =>
  (Array.from(el.querySelectorAll("svg")) as SVGSVGElement[]).filter(
    (s) => !s.closest("button"),
  );

const ZOOMABLE: Zoomable[] = [
  {
    name: "volcano",
    make: (el, theme) =>
      createVolcano(el, {
        data: volcanoData(),
        options: { theme: theme ?? {} },
      }) as unknown as Handle,
    ready: async () => {
      await wait(400);
      await frames(2);
    },
    zoom: async (el) => {
      wheel(el.querySelector("canvas") as HTMLCanvasElement, -120, 3);
      await settle();
    },
    target: (el) => el.querySelector("canvas") as HTMLCanvasElement,
    view: (el) => JSON.stringify(scatterView(el)),
    area: (el) =>
      (el.querySelector("canvas") as HTMLElement).getBoundingClientRect(),
  },
  {
    name: "embedding",
    make: (el, theme) =>
      createEmbedding(el, {
        data: embeddingData(true),
        options: { showAxes: true, theme: theme ?? {} },
      }) as unknown as Handle,
    ready: async () => {
      await wait(400);
      await frames(2);
    },
    zoom: async (el) => {
      wheel(el.querySelector("canvas") as HTMLCanvasElement, -120, 3);
      await settle();
    },
    target: (el) => el.querySelector("canvas") as HTMLCanvasElement,
    view: (el) => JSON.stringify(scatterView(el)),
    area: (el) =>
      (el.querySelector("canvas") as HTMLElement).getBoundingClientRect(),
  },
  {
    name: "network",
    make: (el, theme) =>
      createNetwork(el, {
        data: networkData(true),
        options: { theme: theme ?? {} },
      }) as unknown as Handle,
    ready: async () => {
      await wait(300);
      await frames(2);
    },
    zoom: async (el) => {
      wheel(mouseLayer(el), -200);
      await wait(400);
    },
    target: (el) => mouseLayer(el),
    // Sigma's camera, to the float32 rounding of its matrices.
    view: (el) => {
      const s = cameraOf(el);
      return [s.x, s.y, s.ratio, s.angle].map((v) => v.toFixed(6)).join();
    },
    area: (el) => mouseLayer(el).getBoundingClientRect(),
  },
  {
    name: "heatmap",
    make: (el, theme) =>
      createHeatmap(el, {
        data: matrixData(),
        options: { theme: theme ?? {} },
      }) as unknown as Handle,
    ready: async () => {
      await wait(60);
      await frames(1);
    },
    zoom: async (el) => {
      wheel(el.querySelector("canvas") as HTMLCanvasElement, -300, 2);
      await frames(2);
    },
    target: (el) => el.querySelector("canvas") as HTMLCanvasElement,
    view: (el) =>
      overlay(el)
        .map((s) => s.innerHTML)
        .join(""),
    area: (el) =>
      (el.querySelector("canvas") as HTMLElement).getBoundingClientRect(),
  },
  {
    name: "hic",
    make: (el, theme) =>
      createHic(el, {
        data: hicData(),
        options: { label: "chr1", theme: theme ?? {} },
      }) as unknown as Handle,
    ready: async () => {
      await wait(60);
      await frames(1);
    },
    zoom: async (el) => {
      const frameRect = el.querySelector(
        'svg rect[fill="none"]',
      ) as SVGRectElement;
      const r = frameRect.getBoundingClientRect();
      const canvas = el.querySelector("canvas") as HTMLCanvasElement;
      for (let i = 0; i < 3; i += 1) {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -100,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      await frames(2);
    },
    target: (el) => el.querySelector("canvas") as HTMLCanvasElement,
    view: (el) =>
      overlay(el)
        .map((s) => s.innerHTML)
        .join(""),
    area: (el) =>
      (
        el.querySelector('svg rect[fill="none"]') as SVGRectElement
      ).getBoundingClientRect(),
  },
];

describe.each(ZOOMABLE)("$name reset", (z) => {
  beforeAll(() => {
    proto.render = function (this: Sigma, ...args: unknown[]) {
      renderers.set(this.getContainer(), this);
      return realRender.apply(this, args);
    };
  });
  afterAll(() => {
    proto.render = realRender;
  });

  /** Whether the plot shows its home view. */
  const home = async (el: HTMLElement, start: string) => z.view(el) === start;

  async function start(theme?: Partial<PlotomicsTheme>) {
    const el = container();
    const plot = z.make(el, theme);
    instances.push(plot);
    await z.ready(el);
    return { el, plot, startView: z.view(el) };
  }

  it("shows a reset button only away from home, which goes home on a click, Enter and Space", async () => {
    const { el, startView } = await start();
    const button = resetButton(el);
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Reset view");
    expect(buttonShown(el)).toBe(false);
    for (const press of ["click", "Enter", "Space"] as const) {
      await z.zoom(el);
      await expect.poll(() => buttonShown(el), poll).toBe(true);
      expect(await home(el, startView), press).toBe(false);
      if (press === "click") {
        await userEvent.click(button);
      } else {
        button.focus();
        expect(document.activeElement, press).toBe(button);
        await userEvent.keyboard(press === "Enter" ? "{Enter}" : "[Space]");
      }
      await expect.poll(() => home(el, startView), poll).toBe(true);
      await expect.poll(() => buttonShown(el), poll).toBe(false);
    }
  });

  it("goes home on a double-click", async () => {
    const { el, startView } = await start();
    await z.zoom(el);
    await expect.poll(() => buttonShown(el), poll).toBe(true);
    const target = z.target(el);
    const c = centre(target);
    if (z.name === "network") {
      for (let i = 0; i < 2; i += 1) {
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: c.x,
            clientY: c.y,
          }),
        );
        await wait(40);
      }
    } else {
      target.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          clientX: c.x,
          clientY: c.y,
        }),
      );
    }
    await expect.poll(() => home(el, startView), poll).toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
  });

  it("goes home on resetView(), which does nothing after destroy()", async () => {
    const { el, plot, startView } = await start();
    await z.zoom(el);
    await expect.poll(() => buttonShown(el), poll).toBe(true);
    plot.resetView();
    await expect.poll(() => home(el, startView), poll).toBe(true);
    await expect.poll(() => buttonShown(el), poll).toBe(false);
    // At home it changes nothing.
    plot.resetView();
    await wait(200);
    expect(await home(el, startView)).toBe(true);
    plot.destroy();
    expect(plot.resetView()).toBeUndefined();
  });

  it("leaves the reset button out of the PNG and SVG exports", async () => {
    const { el, plot } = await start();
    await z.zoom(el);
    await expect.poll(() => buttonShown(el), poll).toBe(true);
    const svg = plot.exportSVG?.() ?? "";
    expect(svg.length).toBeGreaterThan(100);
    expect(svg).not.toContain("Reset view");
    expect(svg).not.toContain("button");
    expect(svg).not.toContain("2.5 8 8 3 13.5 8");
    // The PNG is the same with the button on screen and with it hidden.
    const bytes = async () => {
      const png = await plot.exportPNG?.(1);
      if (!png) throw new Error("the plot gave no PNG");
      return new Uint8Array(await png.arrayBuffer());
    };
    const shown = await bytes();
    const button = resetButton(el);
    button.style.visibility = "hidden";
    const hidden = await bytes();
    button.style.visibility = "";
    expect(shown.length).toBeGreaterThan(1000);
    expect(shown).toEqual(hidden);
  });

  it("takes its colours from the theme, dark and var() included", async () => {
    const el = container();
    el.style.setProperty("--zoom-axis", "#123456");
    const plot = z.make(el, { ...darkTheme, axis: "var(--zoom-axis)" });
    instances.push(plot);
    await z.ready(el);
    await z.zoom(el);
    await expect.poll(() => buttonShown(el), poll).toBe(true);
    const style = getComputedStyle(resetButton(el));
    expect(style.color).toBe("rgb(18, 52, 86)");
    expect(style.backgroundColor).toBe("rgb(11, 15, 25)");
    expect(style.borderTopColor).toBe("rgb(31, 41, 55)");
  });

  for (const width of [300, 1600]) {
    for (const fontSize of [8, 20]) {
      it(`keeps the reset button in the plot area, clear of the text, legend and colour bar, at ${width} px and fontSize ${fontSize}`, async () => {
        const el = container(width, 480);
        const plot = z.make(el, { fontSize });
        instances.push(plot);
        await z.ready(el);
        await z.zoom(el);
        await expect.poll(() => buttonShown(el), poll).toBe(true);
        await wait(100);
        const b = resetButton(el).getBoundingClientRect();
        const area = z.area(el);
        const what = `${width} px, fontSize ${fontSize}`;
        expect(b.left, what).toBeGreaterThanOrEqual(area.left - 0.5);
        expect(b.right, what).toBeLessThanOrEqual(area.right + 0.5);
        expect(b.top, what).toBeGreaterThanOrEqual(area.top - 0.5);
        expect(b.bottom, what).toBeLessThanOrEqual(area.bottom + 0.5);
        const marks = Array.from(
          el.querySelectorAll("svg text, svg rect"),
        ).filter(
          (n) =>
            !n.closest("button") &&
            !(n.localName === "rect" && n.getAttribute("fill") === "none"),
        );
        expect(marks.length, what).toBeGreaterThan(2);
        const hits: string[] = [];
        for (const n of marks) {
          const r = n.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (
            r.left < b.right &&
            b.left < r.right &&
            r.top < b.bottom &&
            b.top < r.bottom
          ) {
            hits.push(`${n.localName} "${n.textContent ?? ""}"`);
          }
        }
        expect(hits, what).toEqual([]);
      });
    }
  }
});
