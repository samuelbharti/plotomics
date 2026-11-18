import { afterEach, describe, expect, it } from "vitest";
import { createNetwork } from "../../src/components/network.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { drawnPixels } from "./helpers.js";

// Sigma draws with WebGL, so export and the renderer's own checks need a
// real browser.

function container() {
  const el = document.createElement("div");
  el.style.cssText = "width:600px;height:400px;";
  document.body.appendChild(el);
  return el;
}

/** A 40-node spiral with given coordinates and a chain of edges. */
function spiral() {
  const n = 40;
  const id = Array.from({ length: n }, (_, i) => `N${i}`);
  const x = Float64Array.from({ length: n }, (_, i) => Math.cos(i / 3) * i);
  const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 3) * i);
  const edges = id.slice(1).map((s, i) => [s, id[i]]);
  return { columns: { id, x, y }, meta: { edges } };
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("network in a browser", () => {
  it("exports the nodes and edges that are on screen", async () => {
    const net = createNetwork(container(), { data: spiral() });
    instances.push(net);
    await new Promise((r) => setTimeout(r, 300));

    const png = await net.exportPNG?.(1);
    // Before the fix every pixel was the background colour.
    expect(await drawnPixels(png as Blob)).toBeGreaterThan(1000);

    const svg = net.exportSVG?.() ?? "";
    expect(svg).toContain("data:image/png;base64,");
  });

  it("returns no image, without throwing, when the view is hidden", async () => {
    const el = container();
    const net = createNetwork(el, { data: spiral() });
    instances.push(net);
    el.style.display = "none";
    expect(net.exportSVG?.()).toBeNull();
    expect(await net.exportPNG?.(1)).toBeNull();
  });

  it("renders a correlation network with negative weights", () => {
    const n = 40;
    const id = Array.from({ length: n }, (_, i) => `N${i}`);
    const source: string[] = [];
    const target: string[] = [];
    const weight: number[] = [];
    for (let i = 0; i < n; i += 1) {
      for (const j of [i + 1, i + 7]) {
        if (j >= n) continue;
        source.push(`N${i}`);
        target.push(`N${j}`);
        weight.push(((i * 37 + j * 11) % 19) / 10 - 0.9);
      }
    }
    // Before the fix, sigma threw "Coordinates of node ... are invalid".
    expect(() => {
      instances.push(
        createNetwork(container(), {
          data: { columns: { id, source, target, weight } },
        }),
      );
    }).not.toThrow();
  });
});
