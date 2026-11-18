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

// A spec with ids and a title, its marks in one blue, for the theme test.
// Gosling skips a new theme for a spec with ids that did not change.
const titled = {
  id: "root",
  title: "Gosling title",
  tracks: [
    {
      ...rectTrack([
        { chrom: "chr1", start: 10_000_000, end: 60_000_000, score: 1 },
      ]).tracks[0],
      id: "t1",
      color: { value: "#0000ff" },
      x: { field: "start", type: "genomic", axis: "top" },
    },
  ],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Counts of light (all channels over 200) and dark (all under 60) pixels. */
async function tones(png: Blob) {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let light = 0;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i] as number, d[i + 1] as number, d[i + 2] as number];
    if (r > 200 && g > 200 && b > 200) light += 1;
    else if (r < 60 && g < 60 && b < 60) dark += 1;
  }
  return { light, dark, total: d.length / 4 };
}

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
    // without the guard in the factory. Without the guard, Gosling's
    // component mounts and logs the errors it finds in the value.
    expect(logged).not.toHaveBeenCalled();
  });

  it("applies a new padding", async () => {
    const { el, instance } = mount({ spec, padding: 10 });
    await expect
      .poll(() => drawn(instance), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(MIN_MARK_PIXELS);
    instance.setOptions({ padding: 80 });
    // Before the fix Gosling kept its view, and the padding stayed 10 px.
    await expect
      .poll(
        () => {
          const c = el.querySelector(".gosling-component");
          return c ? getComputedStyle(c).paddingTop : null;
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBe("80px");
  });

  it("draws the text in the new theme for a spec with ids", async () => {
    const { instance } = mount({ spec: titled, theme: "light" });
    await expect
      .poll(() => drawn(instance), { timeout: 30_000, interval: 250 })
      .not.toBeNull();
    // Python sends a fresh copy of the spec with the new theme.
    instance.setOptions({ spec: structuredClone(titled), theme: "dark" });
    // Once the background is dark, the title and the axis labels are light.
    // Before the fix they stayed black on the dark background.
    await expect
      .poll(
        async () => {
          const png = await instance.exportPNG?.(1);
          if (!png) return null;
          const t = await tones(png);
          return t.dark > t.total / 2 ? t.light : null;
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBeGreaterThan(50);
  });

  it("raises no error when destroyed just after a spec change", async () => {
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.message);
    window.addEventListener("error", onError);
    try {
      const { instance } = mount({ spec: emptySpec });
      await expect
        .poll(() => drawn(instance), { timeout: 30_000, interval: 250 })
        .not.toBeNull();
      instance.setOptions({ spec });
      await wait(60);
      instance.destroy();
      // Gosling reads its view 300 ms after a spec change. Before the fix the
      // view was gone by then, and that read threw a TypeError.
      await wait(800);
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
