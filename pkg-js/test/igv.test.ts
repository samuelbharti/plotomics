import { describe, it, expect } from "vitest";
import {
  assembleConfig,
  copyForIgv,
  defaultIgvOptions,
  mergeOptions,
  trackKey,
} from "../src/components/igv-config.js";

describe("igv assembleConfig", () => {
  it("passes a full config through unchanged (and wins over convenience fields)", () => {
    const config = {
      genome: "hg19",
      locus: "chr1:1-1000",
      tracks: [{ url: "a.bw" }],
    };
    const out = assembleConfig({ config, genome: "hg38", locus: "chr2" });
    expect(out).toEqual(config);
    // A shallow copy is returned, not the same reference.
    expect(out).not.toBe(config);
  });

  it("builds a config from convenience fields when no config is given", () => {
    const out = assembleConfig({
      genome: "hg38",
      locus: "chr8:127,736,588-127,739,371",
    });
    expect(out).toEqual({
      genome: "hg38",
      locus: "chr8:127,736,588-127,739,371",
    });
  });

  it("includes tracks only when the array is non-empty", () => {
    expect(assembleConfig({ genome: "hg38", tracks: [] })).toEqual({
      genome: "hg38",
    });
    const tracks = [{ name: "t", url: "t.bw" }];
    expect(assembleConfig({ genome: "hg38", tracks })).toEqual({
      genome: "hg38",
      tracks,
    });
  });

  it("omits empty/null convenience fields so igv applies its own defaults", () => {
    expect(assembleConfig({ genome: null, locus: "", tracks: [] })).toEqual({});
    expect(assembleConfig({})).toEqual({});
  });

  it("loads no genome for a null genome, which Python's genome=None sends", () => {
    const opts = mergeOptions(defaultIgvOptions, {
      genome: null,
      locus: "chr1",
    });
    expect(assembleConfig(opts)).toEqual({ locus: "chr1" });
  });

  it("assembles from the shipped defaults (genome only)", () => {
    expect(assembleConfig(defaultIgvOptions)).toEqual({ genome: "hg38" });
  });

  it("keys a track by its whole content, whatever the key order", () => {
    const a = { name: "t", url: "t.bed", format: "bed" };
    const b = { format: "bed", url: "t.bed", name: "t" };
    expect(trackKey(a)).toBe(trackKey(b));
    expect(trackKey({ ...a, color: "red" })).not.toBe(trackKey(a));
  });

  it("gives igv a deep copy of a config", () => {
    const config = { tracks: [{ name: "t", url: "t.bed", format: "BED" }] };
    const copy = copyForIgv(config);
    (copy.tracks[0] as Record<string, unknown>).format = "bed";
    (copy.tracks[0] as Record<string, unknown>).order = 1;
    expect(config.tracks[0]).toEqual({
      name: "t",
      url: "t.bed",
      format: "BED",
    });
    // A config with a function cannot be copied, and igv gets it as is.
    const withFn = { onClick: () => 1 };
    expect(copyForIgv(withFn)).toBe(withFn);
  });
});
