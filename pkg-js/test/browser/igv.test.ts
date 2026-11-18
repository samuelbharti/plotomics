import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type IgvOptions, createIgv } from "../../src/components/igv.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { mountPoint, trackRequests } from "./helpers.js";

// A 1,200 base synthetic sequence, served by the test server.
const fastaURL = new URL("./fixtures/tiny.fa", import.meta.url).href;
const bedURL = new URL("./fixtures/tiny.bed", import.meta.url).href;

/** How often a word appears in the browser's SVG export (0 before it is live). */
function countInSvg(instance: PlotomicsInstance<IgvOptions>, word: string) {
  const svg = instance.exportSVG?.() ?? "";
  return svg.split(word).length - 1;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// igv.js asks igv.org for its genome list when a browser starts, and for a
// locus lookup when no locus is given. These two settings turn both off, so
// the test does not depend on that host.
const config = {
  reference: { id: "tiny", name: "tiny", fastaURL, indexed: false },
  loadDefaultGenomes: false,
  locus: "chrT:1-1200",
};

describe("igv component in a browser", () => {
  let requests: ReturnType<typeof trackRequests>;
  let instance: PlotomicsInstance<IgvOptions> | undefined;

  beforeEach(() => {
    requests = trackRequests();
    instance = undefined;
  });

  afterEach(() => {
    // destroy() is idempotent, and runs here so that a failed test does not
    // leave an igv browser behind for the next one.
    instance?.destroy();
    requests.restore();
    document.body.replaceChildren();
  });

  it("creates a browser on a local reference and exports SVG", async () => {
    const el = mountPoint();
    instance = createIgv(el, { options: { config } });
    const live = instance;

    // exportSVG returns null until the browser is live, and the factory only
    // logs a failed createBrowser. An SVG string proves that igv.js loaded
    // and built its view.
    await expect
      .poll(() => live.exportSVG?.() ?? null, {
        timeout: 30_000,
        interval: 250,
      })
      .toContain("<svg");

    expect(requests.external()).toEqual([]);

    live.destroy();
    expect(el.childElementCount).toBe(0);
  });

  it("loads a track set before the browser is ready, once", async () => {
    const el = mountPoint();
    instance = createIgv(el, { options: { config } });
    const live = instance;
    const track = () => ({
      name: "beds",
      url: bedURL,
      format: "bed",
      type: "annotation",
    });
    // Before createBrowser resolves.
    live.setOptions({ tracks: [track()] });
    await expect
      .poll(() => countInSvg(live, "beds"), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);
    await wait(500);
    const once = countInSvg(live, "beds");
    // Python sends a freshly decoded copy of the same track with each change.
    live.setOptions({ tracks: [track()], locus: "chrT:50-600" });
    live.setOptions({ tracks: [track()], locus: "chrT:60-700" });
    await wait(1500);
    expect(countInSvg(live, "beds")).toBe(once);
  });

  it("builds a new browser when the config changes", async () => {
    const el = mountPoint();
    instance = createIgv(el, { options: { config } });
    const live = instance;
    await expect
      .poll(() => live.exportSVG?.() ?? null, {
        timeout: 30_000,
        interval: 250,
      })
      .toContain("<svg");
    live.setOptions({
      config: {
        ...config,
        tracks: [
          { name: "second", url: bedURL, format: "bed", type: "annotation" },
        ],
      },
    });
    await expect
      .poll(() => countInSvg(live, "second"), {
        timeout: 30_000,
        interval: 250,
      })
      .toBeGreaterThan(0);
    // One browser in the element, not the old one next to the new one.
    expect(el.querySelectorAll(".igv-navbar").length).toBeLessThanOrEqual(1);
  });
});
