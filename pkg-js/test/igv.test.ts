import { describe, it, expect } from "vitest";
import { assembleConfig, defaultIgvOptions } from "../src/components/igv-config.js";

describe("igv assembleConfig", () => {
  it("passes a full config through unchanged (and wins over convenience fields)", () => {
    const config = { genome: "hg19", locus: "chr1:1-1000", tracks: [{ url: "a.bw" }] };
    const out = assembleConfig({ config, genome: "hg38", locus: "chr2" });
    expect(out).toEqual(config);
    // A shallow copy is returned, not the same reference.
    expect(out).not.toBe(config);
  });

  it("builds a config from convenience fields when no config is given", () => {
    const out = assembleConfig({ genome: "hg38", locus: "chr8:127,736,588-127,739,371" });
    expect(out).toEqual({
      genome: "hg38",
      locus: "chr8:127,736,588-127,739,371",
    });
  });

  it("includes tracks only when the array is non-empty", () => {
    expect(assembleConfig({ genome: "hg38", tracks: [] })).toEqual({ genome: "hg38" });
    const tracks = [{ name: "t", url: "t.bw" }];
    expect(assembleConfig({ genome: "hg38", tracks })).toEqual({ genome: "hg38", tracks });
  });

  it("omits empty/null convenience fields so igv applies its own defaults", () => {
    expect(assembleConfig({ genome: null, locus: "", tracks: [] })).toEqual({});
    expect(assembleConfig({})).toEqual({});
  });

  it("assembles from the shipped defaults (genome only)", () => {
    expect(assembleConfig(defaultIgvOptions)).toEqual({ genome: "hg38" });
  });
});
