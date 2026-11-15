import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type IgvOptions, createIgv } from "../../src/components/igv.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { mountPoint, trackRequests } from "./helpers.js";

// A 1,200 base synthetic sequence, served by the test server.
const fastaURL = new URL("./fixtures/tiny.fa", import.meta.url).href;

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
});
