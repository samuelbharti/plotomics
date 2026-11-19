import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createGosling } from "../../src/components/gosling.js";
import { createIgv } from "../../src/components/igv.js";
import { createNetwork } from "../../src/components/network.js";
import {
  DEFAULT_PADDING,
  type PlotomicsInstance,
} from "../../src/core/index.js";
import { PLOTS, type Plot, settled } from "./plots.js";

// The theme padding: every component keeps all of its drawing inside the
// padding, on screen and in its PNG export, and hovering reads the same
// item at the same place in the plot with any padding or CSS border.

const W = 640;

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  under = null;
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

function mount(plot: Plot, css: string, padding?: number, hover = false) {
  const el = document.createElement("div");
  el.style.cssText = css;
  document.body.appendChild(el);
  const make = (hover && plot.hoverMake) || plot.make;
  instances.push(make(el, padding === undefined ? {} : { padding }));
  return el;
}

/** The plot area: the padding box of `el` less `pad` on each side. */
function area(el: HTMLElement, pad: number) {
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  return {
    left: left + pad,
    top: top + pad,
    right: left + el.clientWidth - pad,
    bottom: top + el.clientHeight - pad,
  };
}

/** The SVG elements and canvases whose box runs past the plot area. */
function outside(el: HTMLElement, pad: number): string[] {
  const a = area(el, pad);
  const out: string[] = [];
  const nodes = [
    ...Array.from(el.querySelectorAll("svg *")).filter(
      (n) => n instanceof SVGGraphicsElement,
    ),
    ...Array.from(el.querySelectorAll("canvas")),
  ];
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (
      r.left < a.left - 0.5 ||
      r.right > a.right + 0.5 ||
      r.top < a.top - 0.5 ||
      r.bottom > a.bottom + 0.5
    ) {
      const what = node.textContent ? ` "${node.textContent}"` : "";
      out.push(`${node.localName}${what}`);
    }
  }
  return out;
}

/** The pixels of a PNG, and its width in image px. */
async function pixels(png: Blob) {
  const bitmap = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width };
}

/**
 * The pixels in the padding band of a PNG of a widget `cssW` px wide that
 * are not the white background.
 */
async function drawnInBand(png: Blob, cssW: number, pad: number) {
  const { data, w } = await pixels(png);
  const h = data.length / 4 / w;
  const band = Math.floor(pad * (w / cssW));
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      if (
        (data[i] as number) < 250 ||
        (data[i + 1] as number) < 250 ||
        (data[i + 2] as number) < 250
      ) {
        n += 1;
      }
    }
  }
  return n;
}

/** An exported SVG drawn as a PNG `w` x `h` px. */
async function svgPNG(text: string, w: number, h: number): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await image.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  (c.getContext("2d") as CanvasRenderingContext2D).drawImage(image, 0, 0, w, h);
  return new Promise((r) => c.toBlob((b) => r(b as Blob), "image/png"));
}

async function screenPNG(el: HTMLElement): Promise<Blob> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/** Whether the plot has drawn: its PNG export holds marks. */
async function ready(plot: PlotomicsInstance<unknown>) {
  await expect
    .poll(
      async () => {
        const png = await plot.exportPNG?.(1);
        if (!png) return 0;
        const { data } = await pixels(png);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i] as number) < 200) n += 1;
        }
        return n;
      },
      { timeout: 10_000, interval: 100 },
    )
    .toBeGreaterThan(200);
}

/** The element under the pointer, for the enter and leave events. */
let under: Element | null = null;

/** The tooltip text after a pointer move to (x, y), or "" when hidden. */
async function tipAt(el: HTMLElement, x: number, y: number, later: boolean) {
  const target = document.elementFromPoint(x, y) ?? el;
  const at = { clientX: x, clientY: y };
  // regl-scatterplot hovers only while it holds the pointer to be over its
  // canvas, which it learns from these.
  if (target !== under) {
    under?.dispatchEvent(new MouseEvent("mouseleave", at));
    target.dispatchEvent(new MouseEvent("mouseenter", at));
    under = target;
  }
  target.dispatchEvent(new MouseEvent("mousemove", { ...at, bubbles: true }));
  // regl-scatterplot sends its hover events on a timer.
  if (later) await new Promise((r) => setTimeout(r, 0));
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

/**
 * The tooltips over a 12 x 8 grid of points across the plot area of a
 * `name` plot.
 */
async function tips(
  name: string,
  el: HTMLElement,
  pad: number,
): Promise<string[]> {
  const later = name === "volcano" || name === "embedding";
  const a = area(el, pad);
  const out: string[] = [];
  for (let j = 0; j < 8; j += 1) {
    for (let i = 0; i < 12; i += 1) {
      const x = a.left + ((i + 0.5) / 12) * (a.right - a.left);
      const y = a.top + ((j + 0.5) / 8) * (a.bottom - a.top);
      out.push(await tipAt(el, x, y, later));
    }
  }
  return out;
}

describe.each(PLOTS)("$name with the theme padding", (plot) => {
  for (const pad of [undefined, 40]) {
    const px = pad ?? DEFAULT_PADDING;
    it(`draws nothing in a padding of ${pad ?? "the default"}`, async () => {
      const el = mount(plot, `width:${W}px;height:${plot.height}px;`, pad);
      const inst = instances[
        instances.length - 1
      ] as PlotomicsInstance<unknown>;
      await settled(plot.name);
      await ready(inst);
      expect(outside(el, px)).toEqual([]);
      expect(await drawnInBand(await screenPNG(el), W, px)).toBe(0);
      const png = (await inst.exportPNG?.(1)) as Blob;
      const bitmap = await createImageBitmap(png);
      expect(bitmap.width / bitmap.height).toBeCloseTo(W / plot.height, 2);
      bitmap.close();
      expect(await drawnInBand(png, W, px)).toBe(0);
      const text = inst.exportSVG?.() ?? "";
      const svg = new DOMParser().parseFromString(
        text,
        "image/svg+xml",
      ).documentElement;
      expect(Number(svg.getAttribute("width"))).toBe(W);
      expect(Number(svg.getAttribute("height"))).toBe(plot.height);
      expect(await drawnInBand(await svgPNG(text, W, plot.height), W, px)).toBe(
        0,
      );
    });
  }

  // Sigma keeps less room of its own as the padding grows, down to the
  // radius of its largest node, which it reaches at a padding of 14 px with
  // the nodes of the hover test. The network compares 20 and 40, where it
  // draws the same.
  const [lo, hi] = plot.name.startsWith("network") ? [20, 40] : [0, 40];
  it(`reads the same item at the same place with a padding of ${lo} and ${hi}`, async () => {
    const d = 2 * (hi - lo);
    const plain = mount(
      plot,
      `width:${W}px;height:${plot.height}px;`,
      lo,
      true,
    );
    const padded = mount(
      plot,
      `width:${W + d}px;height:${plot.height + d}px;`,
      hi,
      true,
    );
    await settled(plot.name);
    await ready(instances[0] as PlotomicsInstance<unknown>);
    await ready(instances[1] as PlotomicsInstance<unknown>);
    const want = await tips(plot.name, plain, lo);
    expect(want.filter((t) => t !== "").length).toBeGreaterThan(2);
    expect(await tips(plot.name, padded, hi)).toEqual(want);
  });

  it("reads the same item at the same place inside a CSS border", async () => {
    const plain = mount(plot, `width:${W}px;height:${plot.height}px;`, 0, true);
    const bordered = mount(
      plot,
      `width:${W}px;height:${plot.height}px;border:6px solid #888;`,
      0,
      true,
    );
    await settled(plot.name);
    await ready(instances[0] as PlotomicsInstance<unknown>);
    await ready(instances[1] as PlotomicsInstance<unknown>);
    const want = await tips(plot.name, plain, 0);
    expect(want.filter((t) => t !== "").length).toBeGreaterThan(2);
    expect(await tips(plot.name, bordered, 0)).toEqual(want);
  });
});

describe("IGV and Gosling with the default padding", () => {
  const config = {
    reference: {
      id: "tiny",
      name: "tiny",
      fastaURL: new URL("./fixtures/tiny.fa", import.meta.url).href,
      indexed: false,
    },
    loadDefaultGenomes: false,
    locus: "chrT:1-1200",
  };
  const spec = {
    tracks: [
      {
        data: {
          type: "json",
          chromosomeField: "chrom",
          genomicFields: ["start", "end"],
          values: [{ chrom: "chr1", start: 1e7, end: 6e7, score: 1 }],
        },
        mark: "rect",
        x: { field: "start", type: "genomic" },
        xe: { field: "end", type: "genomic" },
        color: { field: "score", type: "quantitative" },
        width: 300,
        height: 60,
      },
    ],
  };
  for (const [name, make] of [
    ["igv", (el: HTMLElement) => createIgv(el, { options: { config } })],
    ["gosling", (el: HTMLElement) => createGosling(el, { options: { spec } })],
  ] as const) {
    it(`keeps ${name} inside the padding of its host`, async () => {
      const el = document.createElement("div");
      el.style.cssText = `width:${W}px;height:400px;`;
      document.body.appendChild(el);
      instances.push(make(el) as PlotomicsInstance<unknown>);
      const host = el.firstElementChild as HTMLElement;
      const a = area(el, DEFAULT_PADDING);
      // The boxes of what the library draws in the host, which igv.js puts
      // in a shadow root, and those of them outside the padding. Gosling
      // first draws a placeholder of its own size, so this waits for the
      // spec's.
      const drawn = () =>
        Array.from((host.shadowRoot ?? host).children)
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 0);
      const out = () =>
        drawn().filter(
          (r) =>
            r.left < a.left - 0.5 ||
            r.top < a.top - 0.5 ||
            r.right > a.right + 0.5 ||
            r.bottom > a.bottom + 0.5,
        ).length;
      await expect
        .poll(() => (drawn().length > 0 ? out() : -1), {
          timeout: 30_000,
          interval: 100,
        })
        .toBe(0);
    });
  }

  it("sits the Gosling views 60 px in, or the host padding and the padding set", async () => {
    // Before the fix Gosling's own 60 px came on top of the host's 10.
    for (const [padding, want] of [
      [undefined, 60],
      [30, 40],
    ] as const) {
      const el = document.createElement("div");
      el.style.cssText = `width:${W}px;height:400px;`;
      document.body.appendChild(el);
      instances.push(
        createGosling(el, {
          options: padding === undefined ? { spec } : { spec, padding },
        }) as PlotomicsInstance<unknown>,
      );
      // Gosling first draws a placeholder of its own; the spec's views are
      // 300 px wide.
      const views = () =>
        el.querySelector(".higlass-wrapper")?.getBoundingClientRect();
      await expect
        .poll(() => views()?.width, { timeout: 30_000, interval: 100 })
        .toBe(300);
      const e = el.getBoundingClientRect();
      const v = views() as DOMRect;
      expect(v.left - e.left).toBeCloseTo(want, 0);
      expect(v.top - e.top).toBeCloseTo(want, 0);
    }
  });

  it("keeps the host padding in the IGV SVG export", async () => {
    // Before the fix the export was igv.js's view alone, with no padding.
    const el = document.createElement("div");
    el.style.cssText = `width:${W}px;height:400px;`;
    document.body.appendChild(el);
    const igv = createIgv(el, { options: { config } });
    instances.push(igv as PlotomicsInstance<unknown>);
    await expect
      .poll(() => igv.exportSVG?.() ?? null, { timeout: 30_000, interval: 100 })
      .not.toBeNull();
    const svg = new DOMParser().parseFromString(
      igv.exportSVG?.() ?? "",
      "image/svg+xml",
    ).documentElement;
    const p = DEFAULT_PADDING;
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    // igv.js draws its view as wide as the host's content box.
    expect(width).toBe(W);
    expect(svg.getAttribute("viewBox")).toBe(`${-p} ${-p} ${width} ${height}`);
    expect(svg.querySelector("rect")?.getAttribute("width")).toBe(String(W));
  });
});

describe("network room around the graph", () => {
  // Twelve nodes of radius 10 on a ring, which the height of the plot box
  // frames.
  const ids = Array.from({ length: 12 }, (_, i) => `N${i}`);
  const ring = {
    columns: {
      id: ids,
      x: ids.map((_, i) => Math.cos((2 * Math.PI * i) / 12) * 10),
      y: ids.map((_, i) => Math.sin((2 * Math.PI * i) / 12) * 10),
      size: ids.map(() => 10),
    },
    meta: { edges: ids.map((s, i) => [s, ids[(i + 1) % 12]]) },
  };

  /** The first row of a PNG that holds a pixel that is not white. */
  async function inkTop(png: Blob): Promise<number> {
    const { data, w } = await pixels(png);
    for (let i = 0; i < data.length; i += 4) {
      if (
        (data[i] as number) < 250 ||
        (data[i + 1] as number) < 250 ||
        (data[i + 2] as number) < 250
      ) {
        return Math.floor(i / 4 / w);
      }
    }
    return -1;
  }

  it("keeps sigma's 30 px less the padding, and whole nodes", async () => {
    // Sigma keeps 30 px between the node centres and its edges. Before the
    // fix the theme padding came on top: the top node sat 30 px down with
    // the default, not 20, and 60 px with a padding of 40.
    for (const [padding, want] of [
      [0, 20],
      [undefined, 20],
      [40, 40],
    ] as const) {
      const el = document.createElement("div");
      el.style.cssText = "width:600px;height:400px;";
      document.body.appendChild(el);
      const net = createNetwork(el, {
        data: ring,
        options: { theme: padding === undefined ? {} : { padding } },
      });
      instances.push(net as PlotomicsInstance<unknown>);
      await new Promise((r) => setTimeout(r, 300));
      const top = await inkTop((await net.exportPNG?.(1)) as Blob);
      expect(Math.abs(top - want)).toBeLessThanOrEqual(1.5);
    }
  });
});
