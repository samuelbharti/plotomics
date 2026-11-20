import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createDotplot } from "../../src/components/dotplot.js";
import { type KmOptions, createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createNetwork, hoverColours } from "../../src/components/network.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createUpset } from "../../src/components/upset.js";
import { createVolcano } from "../../src/components/volcano.js";
import {
  type PlotomicsData,
  type PlotomicsInstance,
  type PlotomicsTheme,
  darkTheme,
  defaultTheme,
} from "../../src/core/index.js";
import rPayload from "./fixtures/r-km-grey50.json";
import { PLOTS, settled } from "./plots.js";

// Every theme colour may be a CSS custom property, var(--name), which takes
// the value the page gives it. A canvas, regl-scatterplot and sigma cannot
// read var(): given one as it is, a canvas keeps black or the colour it drew
// before, regl-scatterplot paints white and sigma black. So each plot is
// drawn twice, once with its colours given directly and once with the same
// colours as var(), and the two must look the same, on screen and in both
// exports, with the custom properties set on the plot's element or on a
// parent. Before the fix the UpSet bars, the profile bars and banner, the
// lollipop PTM track and heads, the KM curves, the oncoplot cells, the
// violins, the spatial spots, the treemap tiles, the embedding points and
// the network nodes differed.

const COLOURS = {
  background: "#fdf6e3",
  foreground: "#7b2d8e",
  muted: "#c05621",
  grid: "#7fb3d5",
  axis: "#2f855a",
};
const PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#1fa3a3",
  "#f032e6",
  "#8a6d00",
];

const literal: Partial<PlotomicsTheme> = {
  ...COLOURS,
  categorical: PALETTE,
};
const viaVar: Partial<PlotomicsTheme> = {
  ...Object.fromEntries(Object.keys(COLOURS).map((k) => [k, `var(--t-${k})`])),
  categorical: PALETTE.map((_, i) => `var(--t-c${i})`),
};

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

/** A container that sets every custom property the var() theme names. */
function container(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  for (const [k, v] of Object.entries(COLOURS)) {
    el.style.setProperty(`--t-${k}`, v);
  }
  PALETTE.forEach((c, i) => {
    el.style.setProperty(`--t-c${i}`, c);
  });
  document.body.appendChild(el);
  return el;
}

/** The pixels of the element on screen, as RGBA bytes. */
async function shot(el: HTMLElement): Promise<Uint8ClampedArray> {
  const base64 = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** How many pixels differ by more than 2 in any channel. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 4; k += 1) {
      if (Math.abs((a[i + k] as number) - (b[i + k] as number)) > 2) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/** The screen pixels of a plot that `make` draws in a fresh container. */
async function drawn(
  name: string,
  height: number,
  make: (el: HTMLElement) => PlotomicsInstance<unknown>,
): Promise<Uint8ClampedArray> {
  const el = container(640, height);
  const inst = make(el);
  instances.push(inst);
  await settled(name);
  await settled(name);
  const pixels = await shot(el);
  inst.destroy();
  instances = instances.filter((i) => i !== inst);
  el.remove();
  return pixels;
}

/** The pixels of a PNG, as RGBA bytes. */
async function pngPixels(png: Blob | null | undefined) {
  if (!png) return new Uint8ClampedArray(0);
  const bitmap = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** An exported SVG drawn `w` x `h` px, as RGBA bytes. */
async function svgPixels(
  text: string | null | undefined,
  w: number,
  h: number,
) {
  if (!text) return new Uint8ClampedArray(0);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await image.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Set the custom properties of the var() theme on `el`. */
function setVars(
  el: HTMLElement,
  colours: Record<string, string>,
  palette: string[],
) {
  for (const [k, v] of Object.entries(colours)) {
    el.style.setProperty(`--t-${k}`, v);
  }
  palette.forEach((c, i) => {
    el.style.setProperty(`--t-c${i}`, c);
  });
}

/** What a plot shows: the screen and both exports, as pixels. */
interface Views {
  screen: Uint8ClampedArray;
  png: Uint8ClampedArray;
  svg: Uint8ClampedArray;
}

async function views(
  name: string,
  el: HTMLElement,
  inst: PlotomicsInstance<unknown>,
  height: number,
): Promise<Views> {
  await settled(name);
  await settled(name);
  return {
    screen: await shot(el),
    png: await pngPixels(await inst.exportPNG?.(1)),
    svg: await svgPixels(inst.exportSVG?.(), 640, height),
  };
}

/**
 * Draw a plot with `theme` in an element inside a parent, the custom
 * properties set on the element or on the parent, and take its views.
 * `then`, when given, runs after the first views and the views are taken
 * again.
 */
async function drawnIn(
  plot: (typeof PLOTS)[number],
  theme: Partial<PlotomicsTheme>,
  on: "element" | "parent",
  then?: (parent: HTMLElement, inst: PlotomicsInstance<unknown>) => void,
  before?: (el: HTMLElement) => void,
): Promise<Views> {
  const parent = document.createElement("div");
  const el = document.createElement("div");
  el.style.cssText = `width:640px;height:${plot.height}px;`;
  parent.appendChild(el);
  document.body.appendChild(parent);
  setVars(on === "element" ? el : parent, COLOURS, PALETTE);
  const inst = plot.make(el, theme);
  instances.push(inst);
  if (before) {
    await settled(plot.name);
    before(el);
  }
  let out = await views(plot.name, el, inst, plot.height);
  if (then) {
    then(parent, inst);
    out = await views(plot.name, el, inst, plot.height);
  }
  inst.destroy();
  instances = instances.filter((i) => i !== inst);
  parent.remove();
  return out;
}

function expectSame(want: Views, got: Views) {
  expect(got.screen.length, "screen").toBeGreaterThan(0);
  expect(differing(want.screen, got.screen), "screen").toBe(0);
  expect(differing(want.png, got.png), "PNG export").toBe(0);
  expect(differing(want.svg, got.svg), "SVG export").toBe(0);
}

/** Other colours for the same theme fields, set after the first draw. */
const COLOURS_2 = {
  background: "#e6fffa",
  foreground: "#1a365d",
  muted: "#97266d",
  grid: "#f6ad55",
  axis: "#742a2a",
};
const PALETTE_2 = [
  "#2f855a",
  "#c53030",
  "#d69e2e",
  "#2b6cb0",
  "#6b46c1",
  "#b83280",
  "#319795",
  "#4a5568",
];

describe.each(PLOTS)("$name with theme colours given as var()", (plot) => {
  it("draws as it does with the colours given directly", async () => {
    const want = await drawn(plot.name, plot.height, (el) =>
      plot.make(el, literal),
    );
    const got = await drawn(plot.name, plot.height, (el) =>
      plot.make(el, viaVar),
    );
    expect(differing(want, got)).toBe(0);
  });

  it("shows and exports the colours set on the element or on a parent", async () => {
    const want = await drawnIn(plot, literal, "element");
    expectSame(want, await drawnIn(plot, viaVar, "element"));
    expectSame(want, await drawnIn(plot, viaVar, "parent"));
  });

  it("takes the new colours on resize() after the page changes them", async () => {
    // Before the fix the network and the embedding kept the colours they
    // read when they were built.
    const want = await drawnIn(
      plot,
      { ...COLOURS_2, categorical: PALETTE_2 },
      "element",
    );
    const got = await drawnIn(plot, viaVar, "parent", (parent, inst) => {
      setVars(parent, COLOURS_2, PALETTE_2);
      inst.resize(640, plot.height);
    });
    expectSame(want, got);
  });
});

describe.each(PLOTS)("$name with a colour the page cannot read", (plot) => {
  // An undefined custom property, or an R colour name CSS lacks such as
  // "grey50", paints nothing on the canvas. Before the fix the legend keys
  // and labels kept it, which the screen drew black and the SVG export left
  // out: a KM legend key and risk table name in black for a curve that was
  // not drawn.
  const palette = (second: string) =>
    PALETTE.map((c, i) => (i === 1 ? second : c));

  /**
   * The plot with "none" as its second colour, and text in that colour in
   * the default foreground, as text in a colour that cannot be read takes.
   */
  const noneReference = () =>
    drawnIn(
      plot,
      { ...literal, categorical: palette("none") },
      "element",
      undefined,
      (el) => {
        for (const t of Array.from(el.querySelectorAll("text, tspan"))) {
          if (t.getAttribute("fill") === "none") {
            t.setAttribute("fill", defaultTheme.foreground);
          }
        }
      },
    );

  // Colours that look like hex or rgb() but are malformed went past the
  // check: the canvas left their marks out, while the legend key stayed
  // black on screen and the export kept the raw value.
  if (
    ["km", "oncoplot", "lollipop", "spatial", "embedding"].includes(plot.name)
  ) {
    it("leaves out what takes a malformed colour, as for none", async () => {
      const none = await noneReference();
      for (const bad of [
        "#12345",
        "#1234567",
        "rgb(1, 2)",
        "rgb(300 garbage)",
        "hsl(nope)",
      ]) {
        const got = await drawnIn(
          plot,
          { ...literal, categorical: palette(bad) },
          "element",
        );
        expect(differing(none.screen, got.screen), `${bad}: screen`).toBe(0);
        expect(differing(none.png, got.png), `${bad}: PNG`).toBe(0);
        expect(differing(none.svg, got.svg), `${bad}: SVG`).toBe(0);
      }
    });
  }

  // A warning names each colour once on the page, so each plot takes its
  // own: an R grey from grey10 up, which CSS does not have.
  const grey = `grey${10 + PLOTS.indexOf(plot)}`;
  for (const unreadable of [`var(--nope-${plot.name})`, grey]) {
    it(`leaves out what takes ${unreadable}, as for "none", and names it once`, async () => {
      const warn = vi.spyOn(console, "warn");
      try {
        // Marks and keys in such a colour are left out, as for "none", but
        // text in it takes the default foreground, as on the light
        // background of this theme, so the KM risk table name stays.
        const none = await noneReference();
        const named = () =>
          warn.mock.calls.filter((c) => String(c[0]).includes(unreadable));
        expect(named()).toEqual([]);
        const got = await drawnIn(
          plot,
          { ...literal, categorical: palette(unreadable) },
          "element",
          (_, inst) => inst.resize(640, plot.height),
        );
        expectSame(none, got);
        // Once at most, for the plots that use the second colour, however
        // often it is read.
        expect(named().length).toBeLessThanOrEqual(1);
        const users = ["km", "oncoplot", "lollipop", "embedding", "spatial"];
        if (users.includes(plot.name)) expect(named().length).toBe(1);
      } finally {
        warn.mockRestore();
      }
    });
  }

  it("writes text in an unreadable theme colour in the default one", async () => {
    // Before the fix the axis text, titles and labels in such a colour were
    // left out. Text never disappears: it takes the colour of the default
    // theme for its role, the dark default on a dark background.
    const i = PLOTS.indexOf(plot);
    for (const [background, base] of [
      [literal.background as string, defaultTheme],
      [darkTheme.background, darkTheme],
    ] as const) {
      const theme = {
        ...literal,
        background,
        foreground: `grey${40 + i}`,
        muted: `grey${60 + i}`,
        axis: `grey${80 + i}`,
      };
      const el = container(640, plot.height);
      const inst = plot.make(el, theme);
      instances.push(inst);
      await settled(plot.name);
      await settled(plot.name);
      const where = `${plot.name} on ${background}`;
      const texts = Array.from(el.querySelectorAll("text, tspan")).filter(
        (t) => t.textContent,
      );
      // The network without groups draws its labels on sigma's canvas,
      // where hoverColours takes the same fallback.
      expect(texts.length > 0 || plot.name === "network", where).toBe(true);
      const fills = new Set(texts.map((t) => t.getAttribute("fill") ?? ""));
      for (const fill of fills) {
        expect(fill, where).not.toBe("none");
        expect(fill, where).not.toMatch(/^grey/);
      }
      const fallbacks = [base.foreground, base.muted, base.axis];
      expect(
        !texts.length || fallbacks.some((c) => fills.has(c)),
        `${where}: ${[...fills].join(", ")}`,
      ).toBe(true);
      // The SVG export writes them so too.
      const svg = inst.exportSVG?.() ?? "";
      expect(svg, where).not.toMatch(/<text[^>]*fill="none"/);
      expect(svg, where).not.toMatch(/fill="grey/);
      inst.destroy();
      instances = instances.filter((x) => x !== inst);
      el.remove();
    }
  });

  it("does not warn about transparent or none", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      for (const deliberate of ["transparent", "none"]) {
        await drawnIn(
          plot,
          { ...literal, categorical: palette(deliberate) },
          "element",
        );
      }
      const colour = warn.mock.calls.filter((c) =>
        String(c[0]).includes("cannot read the colour"),
      );
      expect(colour).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("network recolour on resize()", () => {
  // A ring of 12 nodes in two groups, coloured var(--a) and var(--b).
  const ring = () => {
    const id = Array.from({ length: 12 }, (_, i) => `N${i}`);
    return {
      columns: {
        id,
        x: id.map((_, i) => Math.cos((2 * Math.PI * i) / 12) * 10),
        y: id.map((_, i) => Math.sin((2 * Math.PI * i) / 12) * 10),
        size: id.map(() => 18),
      },
      meta: {
        edges: id.map((s, i) => [s, id[(i + 1) % 12] as string]),
        nodeGroup: id.map((_, i) => (i % 2 ? "b" : "a")),
      },
    };
  };
  const make = (el: HTMLElement) =>
    createNetwork(el, {
      data: ring(),
      options: {
        showLegend: false,
        theme: { categorical: ["var(--a)", "var(--b)"] },
      },
    });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const tip = (el: HTMLElement) =>
    Array.from(el.children).find((c) => c.tagName === "DIV") as HTMLElement;

  /** Where the pixels of one colour are: their number and centre. */
  function where(pixels: Uint8ClampedArray, w: number, rgb: number[]) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        Math.abs((pixels[i] as number) - (rgb[0] as number)) <= 2 &&
        Math.abs((pixels[i + 1] as number) - (rgb[1] as number)) <= 2 &&
        Math.abs((pixels[i + 2] as number) - (rgb[2] as number)) <= 2
      ) {
        n += 1;
        sx += (i / 4) % w;
        sy += Math.floor(i / 4 / w);
      }
    }
    return { n, x: n ? sx / n : 0, y: n ? sy / n : 0 };
  }

  it("keeps the zoom", async () => {
    // Before the fix a recolour built a new renderer, at the first view.
    const el = container(640, 480);
    el.style.setProperty("--a", "#e6194b");
    el.style.setProperty("--b", "#3cb44b");
    const inst = make(el);
    instances.push(inst);
    await settled("network");
    const mouse = el.querySelector(".sigma-mouse") as HTMLElement;
    const r = mouse.getBoundingClientRect();
    const green = [0x3c, 0xb4, 0x4b];
    const start = where(await shot(el), 640, green);
    mouse.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 200,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(400);
    const zoomed = where(await shot(el), 640, green);
    // Zoomed out, the nodes are smaller.
    expect(zoomed.n).toBeLessThan(0.8 * start.n);
    el.style.setProperty("--a", "#4363d8");
    inst.resize(640, 480);
    await settled("network");
    await wait(200);
    const after = await shot(el);
    // The new colour reached the nodes of group a.
    expect(where(after, 640, [0x43, 0x63, 0xd8]).n).toBeGreaterThan(100);
    // The nodes of group b are where the zoom put them.
    const kept = where(after, 640, green);
    expect(kept.n).toBeGreaterThan(100);
    expect(Math.abs(kept.n - zoomed.n)).toBeLessThan(0.05 * zoomed.n);
    expect(Math.abs(kept.x - zoomed.x)).toBeLessThan(2);
    expect(Math.abs(kept.y - zoomed.y)).toBeLessThan(2);
  });

  it("clears a hover when the pointer leaves the node", async () => {
    // Before the fix the new renderer never heard of the node hovered in
    // the old one: moving off it left the tooltip and the dimming.
    const el = container(640, 480);
    el.style.setProperty("--a", "#e6194b");
    el.style.setProperty("--b", "#3cb44b");
    const inst = make(el);
    instances.push(inst);
    await settled("network");
    const mouse = el.querySelector(".sigma-mouse") as HTMLElement;
    const r = mouse.getBoundingClientRect();
    let hovered = "";
    for (let j = 0; j < 24 && !hovered; j += 1) {
      for (let i = 0; i < 32 && !hovered; i += 1) {
        const at = {
          clientX: r.left + ((i + 0.5) / 32) * r.width,
          clientY: r.top + ((j + 0.5) / 24) * r.height,
          bubbles: true,
        };
        mouse.dispatchEvent(new MouseEvent("mousemove", at));
        if (tip(el).style.opacity === "1") hovered = tip(el).textContent ?? "";
      }
    }
    expect(hovered).not.toBe("");
    el.style.setProperty("--b", "#4363d8");
    inst.resize(640, 480);
    await settled("network");
    // Off the nodes: the middle of the ring.
    mouse.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
      }),
    );
    await settled("network");
    expect(tip(el).style.opacity).not.toBe("1");
    // No node is faded: the plot matches one drawn in the new colours.
    const got = await shot(el);
    const fresh = container(640, 480);
    fresh.style.setProperty("--a", "#e6194b");
    fresh.style.setProperty("--b", "#4363d8");
    instances.push(make(fresh));
    await settled("network");
    const want = await shot(fresh);
    expect(differing(want, got)).toBeLessThan(50);
  });
});

describe("network labels in an unreadable foreground", () => {
  it("take the default foreground for the background", () => {
    // Sigma draws the labels on its canvas. Before the fix they were black
    // in such a colour, on a dark background too.
    const el = container(100, 100);
    expect(
      hoverColours(
        { foreground: "grey97", background: darkTheme.background, grid: "" },
        el,
      ).label,
    ).toBe(darkTheme.foreground);
    expect(
      hoverColours(
        { foreground: "var(--nope-label)", background: "#ffffff", grid: "" },
        el,
      ).label,
    ).toBe(defaultTheme.foreground);
  });
});

describe("profile banner names over a block that paints nothing", () => {
  it("take the foreground for the background, not white", async () => {
    // A group colour that paints nothing, or cannot be read, leaves its
    // banner block out, and its name sits on the plot. Before the fix it
    // was white, which a light background hid.
    const profile = PLOTS.find((p) => p.name === "profile");
    if (!profile) throw new Error("no profile plot");
    for (const first of ["none", "grey98"]) {
      const el = container(640, profile.height);
      const inst = profile.make(el, {
        categorical: [first, ...PALETTE.slice(1)],
      });
      instances.push(inst);
      await settled("profile");
      const name = Array.from(el.querySelectorAll("text")).find(
        (t) => t.textContent === "C>A",
      );
      expect(name?.getAttribute("fill"), first).toBe(defaultTheme.foreground);
    }
  });
});

describe("a colour R knows and CSS lacks", () => {
  // The payload R's km() sends for theme = list(categorical = c("#e6194b",
  // "grey50", "#4363d8")), written by R into the fixture. R sends "grey50"
  // as #7F7F7F, which the browser draws; given as it is, the browser cannot
  // read it and leaves out the curve of the second group.
  type Payload = {
    data: PlotomicsData;
    options: Partial<KmOptions>;
  };
  const payload = rPayload as unknown as Payload;

  /** Pixels of the KM canvas in R's grey50, #7F7F7F. */
  function grey50(el: HTMLElement): number {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 127 && d[i + 1] === 127 && d[i + 2] === 127) n += 1;
    }
    return n;
  }

  it("draws the curve of an R grey50 group", () => {
    expect(payload.options.theme?.categorical?.[1]).toBe("#7F7F7F");
    const el = container(640, 520);
    instances.push(createKm(el, payload));
    expect(grey50(el)).toBeGreaterThan(50);
    // The name as given draws nothing, which is why R converts it.
    const raw = container(640, 520);
    const theme = {
      ...payload.options.theme,
      categorical: ["#e6194b", "grey50", "#4363d8"],
    };
    instances.push(
      createKm(raw, {
        data: payload.data,
        options: { ...payload.options, theme },
      }),
    );
    expect(grey50(raw)).toBe(0);
  });
});

describe("colour options given as var()", () => {
  // The colours a plot takes as options reach the same canvases, and so
  // does theme.muted, the ring of a dot plot dot with no value.
  const cases: {
    name: string;
    height: number;
    colours: Record<string, string>;
    make(
      el: HTMLElement,
      colours: (k: string) => string,
    ): PlotomicsInstance<unknown>;
  }[] = [
    {
      name: "dotplot",
      height: 400,
      colours: { muted: "#b7791f" },
      make: (el, c) =>
        createDotplot(el, {
          data: {
            columns: {
              gene: ["CD3E", "CD3E", "LYZ", "LYZ"],
              cluster: ["T", "B", "T", "B"],
              pct: [80, 60, 90, 40],
              value: [1, null, 2, null] as unknown as number[],
            },
          },
          options: { theme: { muted: c("muted") } },
        }),
    },
    {
      name: "lollipop",
      height: 440,
      colours: { backbone: "#b7791f", stem: "#285e61" },
      make: (el, c) =>
        createLollipop(el, {
          data: {
            columns: {
              position: [40, 120, 200],
              count: [5, 9, 3],
              class: ["Missense", "Missense", "Nonsense"],
            },
            meta: { length: 300, classes: ["Missense", "Nonsense"] },
          },
          options: { backboneColor: c("backbone"), stemColor: c("stem") },
        }),
    },
    {
      name: "oncoplot",
      height: 400,
      colours: { empty: "#e9d8a6", burden: "#9b2226", frequency: "#005f73" },
      make: (el, c) =>
        createOncoplot(el, {
          data: {
            columns: {
              codes: [1, 0, 2, 0, 1, 1],
              tmb: [3, 5, 2],
              freq: [60, 40],
            },
            meta: {
              nrows: 2,
              ncols: 3,
              genes: ["TP53", "KRAS"],
              samples: ["S1", "S2", "S3"],
              classes: ["Missense_Mutation", "Nonsense_Mutation"],
            },
          },
          options: {
            emptyColor: c("empty"),
            burdenColor: c("burden"),
            frequencyColor: c("frequency"),
          },
        }),
    },
    {
      name: "upset",
      height: 400,
      colours: { bar: "#2b6cb0", empty: "#e2c044" },
      make: (el, c) =>
        createUpset(el, {
          data: {
            columns: { size: [30, 20, 10] },
            meta: {
              sets: ["A", "B"],
              setSizes: [40, 30],
              membership: [1, 0, 0, 1, 1, 1],
            },
          },
          options: { barColor: c("bar"), emptyDotColor: c("empty") },
        }),
    },
    {
      name: "volcano",
      height: 400,
      colours: { up: "#9b2226", down: "#005f73", ns: "#ca6702" },
      make: (el, c) =>
        createVolcano(el, {
          data: {
            columns: {
              x: Array.from({ length: 60 }, (_, i) => (i - 30) / 6),
              y: Array.from({ length: 60 }, (_, i) => (i % 15) + 0.5),
            },
          },
          options: {
            pointSize: 8,
            labelTopN: 0,
            colors: { up: c("up"), down: c("down"), ns: c("ns") },
          },
        }),
    },
    {
      name: "network",
      height: 400,
      colours: { node: "#9b2226", edge: "#ca6702" },
      make: (el, c) =>
        createNetwork(el, {
          data: {
            columns: {
              id: ["a", "b", "c", "d"],
              x: [0, 1, 1, 0],
              y: [0, 0, 1, 1],
              size: [14, 14, 14, 14],
            },
            meta: {
              edges: [
                ["a", "b"],
                ["b", "c"],
                ["c", "d"],
              ],
            },
          },
          options: {
            defaultNodeColor: c("node"),
            defaultEdgeColor: c("edge"),
          },
        }),
    },
  ];

  for (const k of cases) {
    it(`draws the ${k.name} as it does with the colours given directly`, async () => {
      const make = (byVar: boolean) => (el: HTMLElement) => {
        for (const [name, value] of Object.entries(k.colours)) {
          el.style.setProperty(`--o-${name}`, value);
        }
        return k.make(el, (name) =>
          byVar ? `var(--o-${name})` : (k.colours[name] as string),
        );
      };
      const want = await drawn(k.name, k.height, make(false));
      const got = await drawn(k.name, k.height, make(true));
      expect(differing(want, got)).toBe(0);
    });
  }
});
