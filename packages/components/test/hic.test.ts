import { describe, it, expect } from "vitest";
import {
  matrixSize,
  densifySymmetric,
  autoVmax,
  normalizeIntensity,
  buildLODPyramid,
  pickLODLevel,
  niceTickStep,
  axisTicks,
  formatCoord,
  colormapLUT,
} from "../src/components/hic.js";

describe("hic helpers", () => {
  it("reads n from meta and infers from a square dense length", () => {
    expect(matrixSize({ n: 4 })).toBe(4);
    expect(matrixSize(undefined, 9)).toBe(3); // 3x3
    expect(matrixSize(undefined, 10)).toBe(0); // not a perfect square
    expect(matrixSize({})).toBe(0);
  });

  it("densifies a sparse triplet and mirrors when symmetric", () => {
    // upper triangle only: (0,1)=5, (0,2)=2
    const m = densifySymmetric([0, 0], [1, 2], [5, 2], 3, true);
    expect(m[0 * 3 + 1]).toBe(5);
    expect(m[1 * 3 + 0]).toBe(5); // mirrored
    expect(m[0 * 3 + 2]).toBe(2);
    expect(m[2 * 3 + 0]).toBe(2); // mirrored
    expect(m[1 * 3 + 2]).toBe(0); // untouched
  });

  it("does not mirror when symmetric=false and skips out-of-range indices", () => {
    const m = densifySymmetric([0, 5], [1, 5], [7, 9], 3, false);
    expect(m[0 * 3 + 1]).toBe(7);
    expect(m[1 * 3 + 0]).toBe(0); // not mirrored
    // (5,5) is out of range for n=3 -> skipped, no throw
    expect(m.length).toBe(9);
  });

  it("auto vmax approximates an upper percentile of positive values", () => {
    const vals = new Float32Array(1000);
    for (let i = 0; i < 1000; i += 1) vals[i] = i; // 0..999
    const v = autoVmax(vals, 0.99);
    // ~99th percentile of 0..999 is near 990; the log histogram is approximate.
    expect(v).toBeGreaterThan(800);
    expect(v).toBeLessThanOrEqual(1000);
  });

  it("auto vmax returns 1 when there are no positive values", () => {
    expect(autoVmax(new Float32Array([0, 0, 0]))).toBe(1);
  });

  it("normalizes intensity on log and linear scales into [0,1]", () => {
    expect(normalizeIntensity(0, 0, 100, "linear")).toBe(0);
    expect(normalizeIntensity(100, 0, 100, "linear")).toBe(1);
    expect(normalizeIntensity(50, 0, 100, "linear")).toBeCloseTo(0.5, 5);
    // log compresses the high end
    expect(normalizeIntensity(0, 0, 100, "log")).toBe(0);
    expect(normalizeIntensity(100, 0, 100, "log")).toBeCloseTo(1, 5);
    expect(normalizeIntensity(1000, 0, 100, "log")).toBe(1); // clamped
  });

  it("builds a shrinking LOD pyramid finest-first", () => {
    const n = 8;
    const dense = new Float32Array(n * n).fill(2);
    const levels = buildLODPyramid(dense, n, 2);
    expect(levels[0]!.size).toBe(8);
    // sizes strictly decrease
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!.size).toBeLessThan(levels[i - 1]!.size);
    }
    // mean pooling of a constant matrix keeps the constant
    expect(levels[levels.length - 1]!.data[0]).toBeCloseTo(2, 5);
  });

  it("mean-pools 2x2 blocks correctly", () => {
    // 2x2 = [[1,2],[3,4]] -> single value 2.5
    const dense = new Float32Array([1, 2, 3, 4]);
    const levels = buildLODPyramid(dense, 2, 1);
    const coarsest = levels[levels.length - 1]!;
    expect(coarsest.size).toBe(1);
    expect(coarsest.data[0]).toBeCloseTo(2.5, 5);
  });

  it("picks a coarse level when zoomed out and finest when zoomed in", () => {
    const levels = [{ size: 1024 }, { size: 512 }, { size: 256 }, { size: 128 }];
    // whole 1024-bin map into ~256 device px -> coarse level
    expect(pickLODLevel(levels, 1024, 256)).toBeGreaterThan(0);
    // 200 visible bins into 800 px -> finest level fits
    expect(pickLODLevel(levels, 200, 800)).toBe(0);
    // single level always 0
    expect(pickLODLevel([{ size: 10 }], 10, 100)).toBe(0);
  });

  it("computes nice tick steps and in-range tick positions", () => {
    expect(niceTickStep(100, 5)).toBe(20);
    expect(niceTickStep(50, 5)).toBe(10);
    const ticks = axisTicks(0, 100, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]!).toBeLessThanOrEqual(100);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it("formats genomic coordinates in bp / kb / Mb", () => {
    expect(formatCoord(500)).toBe("500");
    expect(formatCoord(2000)).toBe("2kb");
    expect(formatCoord(3_000_000)).toBe("3Mb");
  });

  it("produces a 256-entry RGBA colormap LUT", () => {
    const lut = colormapLUT("viridis");
    expect(lut.length).toBe(256 * 4);
    // alpha fully opaque
    expect(lut[3]).toBe(255);
    expect(lut[255 * 4 + 3]).toBe(255);
    // viridis goes dark purple -> yellow; first entry darker than last
    const first = lut[0]! + lut[1]! + lut[2]!;
    const last = lut[255 * 4]! + lut[255 * 4 + 1]! + lut[255 * 4 + 2]!;
    expect(last).toBeGreaterThan(first);
  });
});
