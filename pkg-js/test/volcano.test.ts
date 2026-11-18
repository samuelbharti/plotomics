import { describe, it, expect } from "vitest";
import {
  classify,
  paddedExtent,
  symmetricExtent,
  niceTicks,
  preparePoints,
  tooltipHtml,
  placeLabels,
} from "../src/components/volcano.js";

describe("volcano helpers", () => {
  it("classifies up / down / NS by thresholds", () => {
    const yThresh = -Math.log10(0.05); // ~1.30
    // significant + positive FC -> up (2)
    expect(classify(2, 3, 1, yThresh)).toBe(2);
    // significant + negative FC -> down (0)
    expect(classify(-2, 3, 1, yThresh)).toBe(0);
    // below significance -> NS (1)
    expect(classify(2, 1, 1, yThresh)).toBe(1);
    // significant but small FC -> NS (1)
    expect(classify(0.5, 3, 1, yThresh)).toBe(1);
  });

  it("computes a symmetric x extent centered on 0", () => {
    const [lo, hi] = symmetricExtent([-3, 1, 2], 0);
    expect(lo).toBe(-3);
    expect(hi).toBe(3);
  });

  it("pads an extent and handles degenerate input", () => {
    expect(paddedExtent([5, 5])).toEqual([4, 6]);
    expect(paddedExtent([])).toEqual([0, 1]);
  });

  it("produces nice ticks within a domain", () => {
    const t = niceTicks([0, 10], 5);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(10);
    expect(t.length).toBeGreaterThan(2);
  });
});

describe("volcano missing values and p = 0", () => {
  it("leaves rows with a missing x or y out and keeps p = 0 at the top", () => {
    const x = [1, null, 2, 3, -2] as unknown as number[];
    const y = [2, 4, Number.NaN, Number.POSITIVE_INFINITY, 6];
    const p = preparePoints(x, y);
    expect(Array.from(p.rows)).toEqual([0, 3, 4]);
    expect(Array.from(p.y)).toEqual([2, Number.POSITIVE_INFINITY, 6]);
    // The axis runs from 0 to 6: p = 0 is drawn 5% of that above 6.
    expect(p.yDraw[1]).toBeCloseTo(6.3, 10);
  });

  it("keeps p = 0 clear of a narrow band of finite values", () => {
    const p = preparePoints(
      [1, 2, 3, 4],
      [10, 10.2, 10.5, Number.POSITIVE_INFINITY],
    );
    // 5% of 0..10.5, not of 10..10.5.
    expect(p.yDraw[3]).toBeCloseTo(11.025, 10);
  });

  it("reads rows R marks as infinite, since JSON sends them as null", () => {
    const p = preparePoints([1, 2], [3, null] as unknown as number[], [1]);
    expect(Array.from(p.rows)).toEqual([0, 1]);
    expect(p.y[1]).toBe(Number.POSITIVE_INFINITY);
  });

  it("frames finite values only and never calls a missing p a hit", () => {
    expect(paddedExtent([4, 1, 8, Number.POSITIVE_INFINITY], 0)).toEqual([
      1, 8,
    ]);
    expect(paddedExtent([Number.NaN, 2, 3], 0)).toEqual([2, 3]);
    expect(classify(4, Number.NaN, 1, 1.3)).toBe(1);
    expect(classify(4, Number.POSITIVE_INFINITY, 1, 1.3)).toBe(2);
  });

  it("escapes the label in the tooltip and names p = 0", () => {
    const html = tooltipHtml("<unknown>", 1, Number.POSITIVE_INFINITY);
    expect(html).toContain("&lt;unknown&gt;");
    expect(html).toContain("Inf (p = 0)");
  });
});

describe("label placement", () => {
  const bounds = { left: 0, right: 200, top: 0, bottom: 100 };

  it("places labels so that no two overlap", () => {
    // Five labels at one point: one per corner, then no room.
    const items = Array.from({ length: 5 }, () => ({
      x: 100,
      y: 50,
      width: 40,
    }));
    const spots = placeLabels(items, bounds, 11);
    expect(spots.filter(Boolean)).toHaveLength(4);
    expect(spots[4]).toBeNull();
  });

  it("flips a label to the left of a point near the right edge", () => {
    const [spot] = placeLabels([{ x: 190, y: 50, width: 40 }], bounds, 11);
    expect(spot?.anchor).toBe("end");
    expect(spot?.x).toBe(186);
  });
});
