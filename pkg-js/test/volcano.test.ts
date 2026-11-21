import { describe, it, expect } from "vitest";
import {
  classify,
  paddedExtent,
  symmetricExtent,
  niceTicks,
  preparePoints,
  tooltipHtml,
  placeLabels,
  roomForPoints,
  yRange,
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

  it("keeps labels clear of a box already taken, such as the reset button", () => {
    // The button over the right of the point takes its first corner, so
    // the label goes to its left.
    const button = { left: 100, right: 130, top: 30, bottom: 60 };
    const [spot] = placeLabels([{ x: 100, y: 50, width: 20 }], bounds, 11, [
      button,
    ]);
    expect(spot?.anchor).toBe("end");
    expect(spot?.x).toBe(96);
    // With every corner taken there is no label.
    const all = { left: 0, right: 200, top: 0, bottom: 100 };
    expect(
      placeLabels([{ x: 100, y: 50, width: 20 }], bounds, 11, [all]),
    ).toEqual([null]);
  });
});

describe("volcano threshold line and p = 0", () => {
  const inf = Number.POSITIVE_INFINITY;
  const line = -Math.log10(0.05);

  it("draws p = 0 above the threshold line when no finite y reaches it", () => {
    // Before the fix p = 0 went to 1.0 with no finite y, and to 0.525 over
    // a finite 0.5, both under the line at 1.3.
    const all = preparePoints([2, -2, 3], [inf, inf, inf], undefined, line);
    for (const y of all.yDraw) expect(y).toBeCloseTo(line * 1.05, 10);
    const one = preparePoints([2, -2, 3], [inf, inf, 0.5], undefined, line);
    expect(one.yDraw[0]).toBeCloseTo(line * 1.05, 10);
    expect(one.yDraw[2]).toBe(0.5);
    // Above the line already, p = 0 goes 5% above the highest finite y.
    const high = preparePoints([1, 2], [inf, 6], undefined, line);
    expect(high.yDraw[0]).toBeCloseTo(6.3, 10);
  });

  it("frames the threshold line with the points", () => {
    const [lo, hi] = yRange([0.1, 0.5], line);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(line * 1.04, 10);
    // A line inside the data range leaves the range to the points: 4%
    // of the axis above the highest one.
    const [lo5, hi5] = yRange([0, 5], line);
    expect(lo5).toBeCloseTo(-0.2, 10);
    expect(hi5).toBeCloseTo(5 + 0.04 * 5.2, 10);
    // No line: the points alone.
    expect(yRange([0.1, 0.5])[1]).toBeCloseTo(0.52, 10);
  });

  it("keeps room above p = 0 next to a high finite y", () => {
    const p = preparePoints([2, -2, 3], [inf, inf, 20], undefined, line);
    expect(p.yDraw[0]).toBeCloseTo(21, 10);
    // Before the fix the axis ended at 21.04, 4% of the spread of the
    // drawn values above them, and the top cut the p = 0 points.
    const [lo, hi] = yRange(p.yDraw, line);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(21 * 1.04, 10);
  });
});

describe("volcano room for large points", () => {
  it("keeps the radius of a point free past the outermost points", () => {
    // An axis 158 px long from 0 to 21.84 holds points from 20 to 21: 6 px
    // above the top one. A point 20 px across needs 11 px.
    const [lo, hi] = roomForPoints([0, 21.84], 20, 21, 11, 158);
    const px = 158 / (hi - lo);
    expect((hi - 21) * px).toBeGreaterThanOrEqual(11 - 1e-9);
    expect((20 - lo) * px).toBeGreaterThanOrEqual(11 - 1e-9);
    // Room that is there already stays as it is.
    expect(roomForPoints([0, 100], 10, 90, 2, 500)).toEqual([0, 100]);
    // Both ends of a range that is too short grow by the same share.
    const [a, b] = roomForPoints([0, 1], 0, 1, 10, 100);
    expect(-a).toBeCloseTo(b - 1, 10);
    expect(-a * (100 / (b - a))).toBeCloseTo(10, 10);
  });
});
