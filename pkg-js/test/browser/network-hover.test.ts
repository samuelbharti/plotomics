import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createNetwork, hoverColours } from "../../src/components/network.js";
import {
  type PlotomicsInstance,
  darkTheme,
  defaultTheme,
} from "../../src/core/index.js";

// Hovering a network node fades the other nodes and draws a box behind the
// node's label. Sigma reads only hex and rgb() colours and draws any other
// in black. Before the fix the fade took theme.grid as it was, so a grid of
// "none", "grey90" or "transparent", values that hide the gridlines of the
// other plots, turned every other node black; and the box was white in
// every theme, under a light label in the dark theme.

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

/** 96 large nodes on a 12 x 8 lattice, in a chain. */
function lattice() {
  const id = Array.from({ length: 96 }, (_, i) => `N${i}`);
  return {
    columns: {
      id,
      x: id.map((_, i) => i % 12),
      y: id.map((_, i) => Math.floor(i / 12)),
      size: id.map(() => 16),
    },
    meta: { edges: id.slice(1).map((s, i) => [s, id[i]]) },
  };
}

/** Sigma's reading of a colour: hex or rgb(a) with commas, else black. */
function sigmaReads(colour: string): boolean {
  return (
    /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colour) ||
    /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(colour)
  );
}

/** Relative luminance of a hex colour (WCAG 2). */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16));
  const lin = (c: number) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * lin(v[0] as number) +
    0.7152 * lin(v[1] as number) +
    0.0722 * lin(v[2] as number)
  );
}
const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Move the pointer over the nodes until one is hovered; its tooltip. */
async function hoverANode(el: HTMLElement): Promise<string> {
  const r = el.getBoundingClientRect();
  let under: Element | null = null;
  for (let j = 0; j < 8; j += 1) {
    for (let i = 0; i < 12; i += 1) {
      const x = r.left + 10 + ((i + 0.5) / 12) * (r.width - 20);
      const y = r.top + 10 + ((j + 0.5) / 8) * (r.height - 20);
      const target = document.elementFromPoint(x, y) ?? el;
      const at = { clientX: x, clientY: y };
      if (target !== under) {
        under?.dispatchEvent(new MouseEvent("mouseleave", at));
        target.dispatchEvent(new MouseEvent("mouseenter", at));
        under = target;
      }
      target.dispatchEvent(
        new MouseEvent("mousemove", { ...at, bubbles: true }),
      );
      const tip = Array.from(el.children).find(
        (c) => c.tagName === "DIV",
      ) as HTMLElement;
      if (tip.style.opacity === "1") return tip.textContent ?? "";
    }
  }
  return "";
}

const frames = async (n: number) => {
  for (let k = 0; k < n; k += 1) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
};

/** The share of the pixels of the widget on screen that are near black. */
async function darkShare(el: HTMLElement): Promise<number> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (
      (d[i] as number) < 40 &&
      (d[i + 1] as number) < 40 &&
      (d[i + 2] as number) < 40
    ) {
      n += 1;
    }
  }
  return n / (d.length / 4);
}

describe("hoverColours", () => {
  it("fades to a colour sigma reads for any grid colour", () => {
    const el = container();
    for (const grid of ["none", "grey90", "transparent", "", "var(--x)"]) {
      const { dim } = hoverColours({ ...defaultTheme, grid }, el);
      expect(sigmaReads(dim), `grid "${grid}": ${dim}`).toBe(true);
      // The white background with a little of the label colour in it.
      expect(luminance(dim), grid).toBeGreaterThan(0.6);
    }
    for (const grid of ["#e5e7eb", "rgb(229, 231, 235)", "lightgray"]) {
      const { dim } = hoverColours({ ...defaultTheme, grid }, el);
      expect(sigmaReads(dim), grid).toBe(true);
    }
    expect(hoverColours(defaultTheme, el).dim).toBe("#e5e7eb");
    // In the dark theme, a faded node is dark.
    const dark = hoverColours({ ...darkTheme, grid: "none" }, el);
    expect(sigmaReads(dark.dim)).toBe(true);
    expect(luminance(dark.dim)).toBeLessThan(0.1);
  });

  it("puts the label on a box it reads on, in both themes", () => {
    const el = container();
    for (const theme of [defaultTheme, darkTheme]) {
      const { label, box } = hoverColours(theme, el);
      expect(contrast(label, box)).toBeGreaterThanOrEqual(4.5);
      expect(box).toBe(theme.background);
    }
    // A background the label does not read on gives way to white or black.
    const low = hoverColours({ ...darkTheme, background: "#9ca3af" }, el);
    expect(contrast(low.label, low.box)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("a network hover", () => {
  it("fades the other nodes, not to black, with a grid that paints nothing", async () => {
    const share = async (grid?: string) => {
      const el = container();
      instances.push(
        createNetwork(el, {
          data: lattice(),
          options: grid === undefined ? {} : { theme: { grid } },
        }),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(await hoverANode(el)).not.toBe("");
      await frames(3);
      const out = await darkShare(el);
      instances.pop()?.destroy();
      el.remove();
      return out;
    };
    const base = await share();
    for (const grid of ["none", "grey90", "transparent"]) {
      // Before the fix most of the 96 nodes were black.
      expect(await share(grid), grid).toBeLessThan(base + 0.01);
    }
  });

  it("draws the hover box in a colour the label reads on in the dark theme", async () => {
    const fills: string[] = [];
    const texts: string[] = [];
    const proto = CanvasRenderingContext2D.prototype;
    const realFill = proto.fill;
    const realText = proto.fillText;
    proto.fill = function (this: CanvasRenderingContext2D, ...args: never[]) {
      if (this.canvas.className === "sigma-hovers")
        fills.push(String(this.fillStyle));
      return realFill.apply(this, args);
    } as typeof realFill;
    proto.fillText = function (
      this: CanvasRenderingContext2D,
      ...args: never[]
    ) {
      if (this.canvas.className === "sigma-hovers")
        texts.push(String(this.fillStyle));
      return realText.apply(this, args);
    } as typeof realText;
    try {
      const el = container();
      instances.push(
        createNetwork(el, { data: lattice(), options: { theme: darkTheme } }),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(await hoverANode(el)).not.toBe("");
      await frames(3);
    } finally {
      proto.fill = realFill;
      proto.fillText = realText;
    }
    expect(fills.length).toBeGreaterThan(0);
    expect(texts.length).toBeGreaterThan(0);
    for (const box of fills) {
      for (const label of texts) {
        expect(
          contrast(label, box),
          `${label} on ${box}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
