import { describe, it, expect } from "vitest";
import {
  readShape,
  zScoreRows,
  colorDomain,
  normalizeToU8,
  buildRampLUT,
  tickIndices,
} from "../src/components/heatmap.js";

describe("heatmap helpers", () => {
  it("reads matrix shape + labels from meta", () => {
    const s = readShape(
      { nrows: 2, ncols: 3, rowLabels: ["r0", "r1"], colLabels: ["c0", "c1", "c2"] },
      6,
    );
    expect(s.nrows).toBe(2);
    expect(s.ncols).toBe(3);
    expect(s.rowLabels).toEqual(["r0", "r1"]);
    expect(s.colLabels).toEqual(["c0", "c1", "c2"]);
  });

  it("falls back to a 1 x N strip when shape is missing", () => {
    const s = readShape(undefined, 5);
    expect(s.nrows).toBe(1);
    expect(s.ncols).toBe(5);
  });

  it("z-scores each row to mean 0, sd 1", () => {
    // Row 0: [1,2,3] -> mean 2, sd sqrt(2/3); Row 1: constant -> centered at 0.
    const z = zScoreRows([1, 2, 3, 5, 5, 5], 2, 3);
    // Middle of row 0 is the mean, so exactly 0.
    expect(z[1]).toBeCloseTo(0, 6);
    // Symmetric around the mean.
    expect(z[0]).toBeCloseTo(-z[2]!, 6);
    // Population sd of [1,2,3] is sqrt(2/3) ~ 0.8165, so first cell ~ -1.2247.
    expect(z[0]).toBeCloseTo(-1.224744871, 4);
    // Zero-variance row stays at 0.
    expect(z[3]).toBe(0);
    expect(z[4]).toBe(0);
    expect(z[5]).toBe(0);
  });

  it("does not mutate the input in zScoreRows", () => {
    const input = [1, 2, 3, 4];
    const copy = [...input];
    zScoreRows(input, 2, 2);
    expect(input).toEqual(copy);
  });

  it("auto color domain uses data min/max for sequential ramps", () => {
    const [lo, hi] = colorDomain([2, 5, 9], {
      vmin: null,
      vmax: null,
      diverging: false,
    });
    expect(lo).toBe(2);
    expect(hi).toBe(9);
  });

  it("auto color domain is symmetric around 0 for diverging ramps", () => {
    const [lo, hi] = colorDomain([-2, 1, 4], {
      vmin: null,
      vmax: null,
      diverging: true,
    });
    expect(lo).toBe(-4);
    expect(hi).toBe(4);
  });

  it("explicit vmin/vmax override the data range", () => {
    const [lo, hi] = colorDomain([2, 5, 9], {
      vmin: 0,
      vmax: 10,
      diverging: true,
    });
    expect(lo).toBe(0);
    expect(hi).toBe(10);
  });

  it("widens a degenerate (constant) domain", () => {
    const [lo, hi] = colorDomain([3, 3, 3], {
      vmin: null,
      vmax: null,
      diverging: false,
    });
    expect(lo).toBeLessThan(hi);
  });

  it("normalizes and clamps values into [0,255]", () => {
    const u8 = normalizeToU8([0, 5, 10, -3, 99], 0, 10);
    expect(u8[0]).toBe(0);
    expect(u8[1]).toBe(128); // 0.5 * 255 rounded
    expect(u8[2]).toBe(255);
    expect(u8[3]).toBe(0); // clamped low
    expect(u8[4]).toBe(255); // clamped high
  });

  it("maps non-finite values to 0 (ramp low color)", () => {
    // NaN and +/-Inf all normalize to a non-finite t, which is coerced to 0.
    const u8 = normalizeToU8([NaN, Infinity, -Infinity], 0, 10);
    expect(u8[0]).toBe(0);
    expect(u8[1]).toBe(0);
    expect(u8[2]).toBe(0);
  });

  it("builds a 256x4 RGBA lookup table spanning the ramp", () => {
    const lut = buildRampLUT("viridis");
    expect(lut.length).toBe(256 * 4);
    // Alpha is fully opaque throughout.
    expect(lut[3]).toBe(255);
    expect(lut[255 * 4 + 3]).toBe(255);
    // Low and high ends differ (ramp actually varies).
    const low = [lut[0], lut[1], lut[2]];
    const high = [lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]];
    expect(low).not.toEqual(high);
  });

  it("returns all indices when count <= max", () => {
    expect(tickIndices(4, 60)).toEqual([0, 1, 2, 3]);
  });

  it("subsamples evenly when count exceeds max", () => {
    const idx = tickIndices(1000, 5);
    expect(idx.length).toBe(5);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(999);
    // Strictly increasing.
    for (let i = 1; i < idx.length; i += 1) {
      expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
    }
  });
});
