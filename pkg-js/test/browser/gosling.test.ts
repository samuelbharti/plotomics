import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGosling } from "../../src/components/gosling.js";
import { mountPoint, trackRequests } from "./helpers.js";

// One rect track over inline JSON values, so the test needs no network.
const spec = {
  tracks: [
    {
      data: {
        type: "json",
        chromosomeField: "chrom",
        genomicFields: ["start", "end"],
        values: [
          { chrom: "chr1", start: 10_000_000, end: 60_000_000, score: 1 },
          { chrom: "chr1", start: 90_000_000, end: 150_000_000, score: 2 },
          { chrom: "chr2", start: 20_000_000, end: 120_000_000, score: 3 },
        ],
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

describe("gosling component in a browser", () => {
  let requests: ReturnType<typeof trackRequests>;

  beforeEach(() => {
    requests = trackRequests();
  });

  afterEach(() => {
    requests.restore();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("embeds a spec and exports the drawn canvas", async () => {
    const logged = vi.spyOn(console, "error");
    const el = mountPoint();
    const instance = createGosling(el, { options: { spec } });

    // The factory catches a failed embed and only logs it. exportPNG returns
    // null until the embed resolves, so a Blob proves that gosling.js,
    // higlass, pixi.js and react all loaded and mounted.
    await expect
      .poll(() => instance.exportPNG?.(1) ?? null, {
        timeout: 30_000,
        interval: 250,
      })
      .toBeInstanceOf(Blob);

    expect(el.querySelector("canvas")).not.toBeNull();
    const failures = logged.mock.calls.filter(
      ([first]) => typeof first === "string" && first.startsWith("plotomics"),
    );
    expect(failures).toEqual([]);
    expect(requests.external()).toEqual([]);

    instance.destroy();
    expect(el.childElementCount).toBe(0);
  });

  it("draws nothing for a value that is not a spec", async () => {
    const el = mountPoint();
    const instance = createGosling(el, { options: { spec: { nope: true } } });

    expect(await instance.exportPNG?.(1)).toBeNull();
    expect(el.querySelector("canvas")).toBeNull();
    instance.destroy();
  });
});
