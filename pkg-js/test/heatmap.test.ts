import { describe, it, expect } from "vitest";
import { isFlatRange } from "../src/core/ticks.js";
import {
  readShape,
  zScoreRows,
  colorDomain,
  normalizeToU8,
  buildRampLUT,
  tickIndices,
  toFloat32,
  pooledSize,
  axisPlan,
  basePlan,
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

  it("mirrors a lone vmax or vmin about 0 for a diverging ramp", () => {
    // Before, the other end came from the data, so 0 left the middle.
    expect(
      colorDomain([-3, 0, 1], { vmin: null, vmax: 2, diverging: true }),
    ).toEqual([-2, 2]);
    expect(
      colorDomain([-1, 0, 1], { vmin: -3, vmax: null, diverging: true }),
    ).toEqual([-3, 3]);
  });

  it("takes the other end from the data when a lone bound cannot centre", () => {
    // A vmax below 0 leaves 0 outside the range, so nothing is mirrored.
    expect(
      colorDomain([-5, 0, 1], { vmin: null, vmax: -1, diverging: true }),
    ).toEqual([-5, -1]);
    // A sequential ramp keeps the data end.
    expect(
      colorDomain([-3, 0, 1], { vmin: null, vmax: 2, diverging: false }),
    ).toEqual([-3, 2]);
  });

  it("widens a flat domain past 2 ** 52 and keeps it flat", () => {
    const [lo, hi] = colorDomain([-7e15, -7e15], {
      vmin: null,
      vmax: null,
      diverging: false,
    });
    expect(lo).toBeLessThan(hi);
    // Still one colour bar label, and the cells at the middle level.
    expect(isFlatRange(lo, hi)).toBe(true);
    expect(normalizeToU8([-7e15], lo, hi)[0]).toBe(128);
  });

  it("widens a degenerate (constant) domain", () => {
    const [lo, hi] = colorDomain([3, 3, 3], {
      vmin: null,
      vmax: null,
      diverging: false,
    });
    expect(lo).toBeLessThan(hi);
  });

  it("widens a domain whose ends differ only in their last digits", () => {
    // Before the fix 0.3 to 0.1 + 0.2 stayed that narrow, and its cells took
    // the two ends of the ramp.
    for (const opts of [
      { vmin: null, vmax: null },
      { vmin: 0.3, vmax: 0.1 + 0.2 },
    ]) {
      const [lo, hi] = colorDomain([0.3, 0.1 + 0.2], {
        ...opts,
        diverging: false,
      });
      expect(lo).toBeCloseTo(-0.2, 12);
      expect(hi).toBeCloseTo(0.8, 12);
    }
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

  it("pools to about a texel a pixel, on a ladder of sizes", () => {
    // At full view, a texel a pixel.
    expect(pooledSize(1, 424)).toBe(424);
    // Zoomed in to half the rows: the ladder runs 424, 466, 512, ..., 822,
    // 904, and 904 texels in view would not each get a pixel.
    expect(pooledSize(0.5, 424)).toBe(822);
    for (const view of [1, 0.7, 0.3, 0.01, 1e-4]) {
      const m = pooledSize(view, 424);
      // Every texel in view gets a pixel, and nine tenths of the pixels
      // or more get a texel of their own.
      expect(m * view).toBeLessThanOrEqual(424 + 1e-9);
      expect(m * view).toBeGreaterThan(0.9 * 424 - 1);
    }
  });

  it("pools to the pixel count for a view of no rows", () => {
    // These ran forever before.
    expect(pooledSize(0, 424)).toBe(424);
    expect(pooledSize(-1, 424)).toBe(424);
    expect(pooledSize(Number.NaN, 424)).toBe(424);
    expect(pooledSize(0.5, Number.NaN)).toBe(1);
  });

  it("plans a texel a row while the rows fit the pixels, else one a pixel", () => {
    expect(axisPlan(424, 1, 424, 8192)).toEqual({
      key: "r",
      count: 424,
      size: 1,
      scale: 1,
    });
    // 425 or 5000 rows in 424 px: 424 even blocks, where halving the rows
    // drew 213 or 313.
    expect(axisPlan(425, 1, 424, 8192)).toMatchObject({ count: 424, size: 0 });
    expect(axisPlan(5000, 1, 424, 8192)).toMatchObject({
      count: 424,
      size: 0,
    });
  });

  it("plans aligned blocks past the texture limit", () => {
    // 8292 rows over a limit of 8192: blocks of two rows from row 0.
    const p = basePlan(8292, 8192);
    expect(p).toEqual({ key: "a2", count: 4146, size: 2, scale: 1 });
    // One row more: the last texel holds that row alone and is drawn over
    // it, half a texel high.
    const q = basePlan(8293, 8192);
    expect(q.count).toBe(4147);
    expect(q.scale).toBeCloseTo(8293 / 8294, 9);
    // Zoomed in to a few rows, the view draws the aligned blocks.
    expect(axisPlan(8292, 1e-3, 424, 8192)).toEqual(p);
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
