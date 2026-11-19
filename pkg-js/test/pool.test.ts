import { describe, expect, it } from "vitest";
import {
  alignedBlocks,
  evenBlocks,
  poolBlocks,
  poolMean,
} from "../src/core/pool.js";

describe("poolMean", () => {
  it("pools each block to the mean of its cells", () => {
    // Twelve rows, one of them an outlier, in one block: it shows as a
    // twelfth of its value, never as 0.
    const rows = new Array(12).fill(0);
    rows[5] = 12;
    expect([...poolMean(rows, 12, 1, 1, 1)]).toEqual([1]);
    // An outlier second in a block of two shows as much as one first.
    expect([...poolMean([0, 1, 1, 0], 4, 1, 2, 1)]).toEqual([0.5, 0.5]);
  });

  it("splits the rows evenly, so the last rows fill a block too", () => {
    // Five rows in two blocks: rows 0-1 and rows 2-4.
    expect([...poolMean([0, 0, 1, 1, 1], 5, 1, 2, 1)]).toEqual([0, 1]);
    // 33 rows in two blocks: 16 and 17 rows. The last row alone in a
    // block of its own would vanish between the pixels.
    const last = new Array(33).fill(0);
    last[32] = 17;
    expect([...poolMean(last, 33, 1, 2, 1)]).toEqual([0, 1]);
    // As many blocks as rows draws every row as it is.
    expect([...poolMean([3, 1, 2], 3, 1, 3, 1)]).toEqual([3, 1, 2]);
  });

  it("splits rows evenly, or in aligned blocks from row 0", () => {
    expect([...evenBlocks(5, 2).index]).toEqual([0, 0, 1, 1, 1]);
    const aligned = alignedBlocks(5, 2);
    expect(aligned.count).toBe(3);
    expect([...aligned.index]).toEqual([0, 0, 1, 1, 2]);
    // Aligned blocks of two rows, the last row alone.
    expect([
      ...poolBlocks([0, 1, 2, 3, 9], 5, 1, aligned, alignedBlocks(1, 1)),
    ]).toEqual([0.5, 2.5, 9]);
  });

  it("pools rows and columns in the drawn order", () => {
    // Row 5 is drawn first, so it falls in the first block.
    const v = [0, 0, 0, 0, 0, 6];
    expect([...poolMean(v, 6, 1, 2, 1, [5, 0, 1, 2, 3, 4])]).toEqual([2, 0]);
    expect([...poolMean(v, 1, 6, 1, 2, [0], [5, 0, 1, 2, 3, 4])]).toEqual([
      2, 0,
    ]);
  });

  it("leaves missing cells out, and keeps an all-missing block missing", () => {
    const p = poolMean([Number.NaN, null, 3, Number.NaN], 4, 1, 2, 1);
    expect(Number.isNaN(p[0] as number)).toBe(true);
    expect(p[1]).toBe(3);
  });

  it("draws noise as its average, not pushed to the ends", () => {
    // Uniform noise: the outer 5% at each end hold 10% of the cells, and
    // blocks of 16 cells reach those ends far less often.
    let s = 7;
    const values = Float32Array.from({ length: 160 * 160 }, () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    });
    const p = poolMean(values, 160, 160, 40, 40);
    const ends = p.filter((v) => v <= 0.05 || v >= 0.95).length;
    expect(ends / p.length).toBeLessThan(0.01);
  });
});
