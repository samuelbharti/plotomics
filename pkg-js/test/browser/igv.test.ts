import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIgv } from "../../src/components/igv.js";
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

  beforeEach(() => {
    requests = trackRequests();
  });

  afterEach(() => {
    requests.restore();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("creates a browser on a local reference and exports SVG", async () => {
    const logged = vi.spyOn(console, "error");
    const el = mountPoint();
    const instance = createIgv(el, { options: { config } });

    // The factory catches a failed createBrowser and only logs it. exportSVG
    // returns null until the browser is live, so an SVG string proves that
    // igv.js loaded and built its view.
    await expect
      .poll(() => instance.exportSVG?.() ?? null, {
        timeout: 30_000,
        interval: 250,
      })
      .toContain("<svg");

    const failures = logged.mock.calls.filter(
      ([first]) => typeof first === "string" && first.startsWith("plotomics"),
    );
    expect(failures).toEqual([]);
    expect(requests.external()).toEqual([]);

    instance.destroy();
    expect(el.childElementCount).toBe(0);
  });
});
