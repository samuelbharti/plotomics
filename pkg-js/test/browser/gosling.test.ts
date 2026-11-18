import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GoslingOptions,
  createGosling,
} from "../../src/components/gosling.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { drawnPixels, mountPoint, trackRequests } from "./helpers.js";

// One rect track over inline JSON values, so the test needs no network.
function rectTrack(values: Record<string, unknown>[]) {
  return {
    tracks: [
      {
        data: {
          type: "json",
          chromosomeField: "chrom",
          genomicFields: ["start", "end"],
          values,
        },
        mark: "rect",
        x: { field: "start", type: "genomic" },
        xe: { field: "end", type: "genomic" },
        color: { field: "score", type: "quantitative" },
        width: 600,
        height: 60,
      },
    ],
  };
}

const spec = rectTrack([
  { chrom: "chr1", start: 10_000_000, end: 60_000_000, score: 1 },
  { chrom: "chr1", start: 90_000_000, end: 150_000_000, score: 2 },
  { chrom: "chr2", start: 20_000_000, end: 120_000_000, score: 3 },
]);

// A track with no values still draws pixels of its own, so the marks are
// measured against this one.
const emptySpec = rectTrack([]);

// The three rects add a little over 2,000 pixels at this size.
const MIN_MARK_PIXELS = 1_000;

describe("gosling component in a browser", () => {
  let requests: ReturnType<typeof trackRequests>;
  let instances: PlotomicsInstance<GoslingOptions>[];

  function mount(options: Partial<GoslingOptions>) {
    const el = mountPoint();
    const instance = createGosling(el, { options });
    instances.push(instance);
    return { el, instance };
  }

  // Export the canvas and count the pixels that are not background, or null
  // while the embed is still pending. getCanvas in gosling.js fills a fresh
  // canvas with the theme background before it copies the tracks in, so a
  // PNG alone does not prove that anything drew.
  async function drawn(instance: PlotomicsInstance<GoslingOptions>) {
    const png = await instance.exportPNG?.(1);
    return png ? drawnPixels(png) : null;
  }

  beforeEach(() => {
    requests = trackRequests();
    instances = [];
  });

  afterEach(() => {
    // destroy() is idempotent, and runs here so that a failed test does not
    // leave a React root and a WebGL context behind for the next one.
    for (const instance of instances) instance.destroy();
    requests.restore();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("embeds a spec and draws its marks", async () => {
    const { el, instance } = mount({ spec });
    const empty = mount({ spec: emptySpec });

    // exportPNG returns null until the embed resolves, and the factory only
    // logs a failed embed. Pixels beyond those of the empty track prove that
    // gosling.js, higlass, pixi.js and react all loaded, mounted and drew
    // the data.
    await expect
      .poll(
        async () => {
          const [withData, withoutData] = await Promise.all([
            drawn(instance),
            drawn(empty.instance),
          ]);
          if (withData === null || withoutData === null) return null;
          return withData - withoutData;
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBeGreaterThan(MIN_MARK_PIXELS);

    expect(el.querySelector("canvas")).not.toBeNull();
    expect(requests.external()).toEqual([]);

    instance.destroy();
    expect(el.childElementCount).toBe(0);
  });

  it("keeps one view when the spec changes at once, and clears it on destroy", async () => {
    const { el, instance } = mount({ spec: emptySpec });
    // Before anything has mounted: the old embed() path mounted both.
    instance.setOptions({ spec });
    await expect
      .poll(() => drawn(instance), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(MIN_MARK_PIXELS);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(el.querySelectorAll("canvas").length).toBe(1);
    // The context HiGlass drew with: unmounting the React tree frees it.
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext;
    expect(gl.isContextLost()).toBe(false);
    instance.destroy();
    expect(el.childElementCount).toBe(0);
    await expect
      .poll(() => gl.isContextLost(), { timeout: 5_000, interval: 50 })
      .toBe(true);
  });

  it("does not embed a value that is not a spec", async () => {
    const logged = vi.spyOn(console, "error");

    // A valid spec mounted at the same time sets how long to wait. Once it
    // has drawn, an embed of the invalid value would have had the same time.
    const control = mount({ spec });
    const invalid = mount({ spec: { nope: true } });

    await expect
      .poll(() => drawn(control.instance), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);

    expect(await invalid.instance.exportPNG?.(1)).toBeNull();
    expect(invalid.el.querySelector("canvas")).toBeNull();

    // gosling.js also rejects the value, so the two checks above hold with or
    // without the guard in the factory. The guard is what skips the embed
    // call, and a rejected embed is what the factory logs.
    const embedFailures = logged.mock.calls.filter(
      ([first]) =>
        typeof first === "string" && first.startsWith("plotomics/gosling"),
    );
    expect(embedFailures).toEqual([]);
  });
});
