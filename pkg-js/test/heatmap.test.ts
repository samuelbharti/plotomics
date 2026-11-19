import { describe, it, expect } from "vitest";
import {
  readShape,
  zScoreRows,
  colorDomain,
  normalizeToU8,
  buildRampLUT,
  tickIndices,
  toFloat32,
  poolMatrix,
  labelEvery,
} from "../src/components/heatmap.js";

describe("heatmap helpers", () => {
  it("reads matrix shape + labels from meta", () => {
    const s = readShape(
      {
        nrows: 2,
        ncols: 3,
        rowLabels: ["r0", "r1"],
        colLabels: ["c0", "c1", "c2"],
      },
      6,
    );
    expect(s.nrows).toBe(2);
    expect(s.ncols).toBe(3);
    expect(s.rowLabels).toEqual(["r0", "r1"]);
    expect(s.colLabels).toEqual(["c0", "c1", "c2"]);
  });

  it("reads a missing label (null from R or Python) as empty text", () => {
    const s = readShape(
      { nrows: 2, ncols: 2, rowLabels: ["r0", null], colLabels: [null, "c1"] },
      4,
    );
    expect(s.rowLabels).toEqual(["r0", ""]);
    expect(s.colLabels).toEqual(["", "c1"]);
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

  it("z-scores over the finite cells and keeps missing cells missing", () => {
    // [1, NaN, 3]: mean 2 and sd 1 over the two finite cells.
    const z = zScoreRows([1, Number.NaN, 3], 1, 3);
    expect(z[0]).toBeCloseTo(-1, 6);
    expect(Number.isNaN(z[1] as number)).toBe(true);
    expect(z[2]).toBeCloseTo(1, 6);
  });

  it("reads null, which R sends for NA, as NaN", () => {
    const v = toFloat32([1, null, 3]);
    expect(v[0]).toBe(1);
    expect(Number.isNaN(v[1] as number)).toBe(true);
    // A plain Float32Array.from would store it as 0.
    expect(Float32Array.from([null as unknown as number])[0]).toBe(0);
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

  it("normalizes and clamps values into levels 1 to 255", () => {
    const u8 = normalizeToU8([0, 5, 10, -3, 99], 0, 10);
    expect(u8[0]).toBe(1);
    expect(u8[1]).toBe(128); // 1 + 0.5 * 254
    expect(u8[2]).toBe(255);
    expect(u8[3]).toBe(1); // clamped low
    expect(u8[4]).toBe(255); // clamped high
  });

  it("keeps level 0 for missing cells, separate from the low end", () => {
    const u8 = normalizeToU8([Number.NaN, Infinity, -Infinity, 0], 0, 10);
    expect([...u8]).toEqual([0, 0, 0, 1]);
  });

  it("builds a lookup table with grey for missing and the ramp after it", () => {
    const lut = buildRampLUT("viridis");
    expect(lut.length).toBe(256 * 4);
    // Entry 0 is the missing-cell grey.
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([0xcc, 0xcc, 0xcc, 255]);
    expect(lut[255 * 4 + 3]).toBe(255);
    // The ramp runs from entry 1 to 255, and its ends differ.
    const low = [lut[4], lut[5], lut[6]];
    const high = [lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]];
    expect(low).not.toEqual(high);
    expect(low).not.toEqual([0xcc, 0xcc, 0xcc]);
  });

  it("mean-pools a matrix, skipping missing cells", () => {
    // 3 x 2 pooled by 2 rows and 2 columns: blocks [1,2,3,4] and [5,NaN].
    const p = poolMatrix([1, 2, 3, 4, 5, Number.NaN], 3, 2, 2, 2);
    expect(p.nrows).toBe(2);
    expect(p.ncols).toBe(1);
    expect(p.values[0]).toBeCloseTo(2.5, 6);
    expect(p.values[1]).toBeCloseTo(5, 6);
    const empty = poolMatrix([Number.NaN, Number.NaN], 2, 1, 2, 1);
    expect(Number.isNaN(empty.values[0] as number)).toBe(true);
  });

  it("labels every cell, every k-th cell, or none by the cell size", () => {
    // The default 11 px labels need 13 px cells.
    expect(labelEvery(14)).toBe(1);
    expect(labelEvery(13)).toBe(1);
    // 7 px rows, as with 60 rows in the default height: every 2nd.
    expect(labelEvery(7)).toBe(2);
    expect(labelEvery(3.25)).toBe(4);
    // Tighter than that, a label could name any of many rows: none.
    expect(labelEvery(3.2)).toBe(0);
    expect(labelEvery(0)).toBe(0);
    // Larger labels need larger cells.
    expect(labelEvery(14, 16.7)).toBe(2);
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
