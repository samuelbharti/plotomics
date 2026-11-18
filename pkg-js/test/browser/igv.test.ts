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

/** Elements matching `selector` in an element and in igv's shadow roots. */
function find(el: HTMLElement, selector: string): Element[] {
  const out = Array.from(el.querySelectorAll(selector));
  for (const node of Array.from(el.querySelectorAll("*"))) {
    if (node.shadowRoot) {
      out.push(...Array.from(node.shadowRoot.querySelectorAll(selector)));
    }
  }
  return out;
}

/** How many track labels read `name`. */
function labelled(el: HTMLElement, name: string): number {
  return find(el, ".igv-track-label").filter(
    (n) => n.textContent?.trim() === name,
  ).length;
}

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
    // One browser in the element, not the old one next to the new one. igv
    // draws inside a shadow root, which `find` looks into.
    expect(find(el, ".igv-navbar").length).toBe(1);
  });

  it("loads a track with no type once", async () => {
    const el = mountPoint();
    // igv.js fills in the type and the order of a track in the config it is
    // given; before the fix that changed the key, and the track loaded again.
    const genome = JSON.stringify(config.reference);
    instance = createIgv(el, {
      options: {
        genome,
        locus: "chrT:1-1200",
        tracks: [{ name: "beds", url: bedURL, format: "bed" }],
      },
    });
    await expect
      .poll(() => labelled(el, "beds"), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);
    await wait(1500);
    expect(labelled(el, "beds")).toBe(1);
  });

  it("keeps a config browser when only the locus changes", async () => {
    const el = mountPoint();
    // Python sends the whole options, freshly decoded, with each change.
    const options = () => ({
      config: {
        ...config,
        tracks: [{ name: "beds", url: bedURL, format: "bed" }],
      },
    });
    instance = createIgv(el, { options: options() });
    const live = instance;
    await expect
      .poll(() => labelled(el, "beds"), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);
    // igv draws in a shadow root on its host; a new browser is a new
    // container there.
    const view = find(el, ".igv-container")[0];
    expect(view).toBeTruthy();
    live.setOptions({ ...options(), locus: "chrT:50-600" });
    live.setOptions({ ...options(), locus: "chrT:60-700" });
    await wait(1500);
    // Before the fix igv.js wrote into the stored config, which then no
    // longer matched the next copy, so each change built a new browser.
    expect(find(el, ".igv-container")).toEqual([view]);
    expect(labelled(el, "beds")).toBe(1);
  });
});
