import { describe, expect, it } from "vitest";
import {
  groupSlices,
  layoutKm,
  stepPoints,
  timeTicks,
} from "../src/components/km.js";

describe("km helpers", () => {
  it("expands points into a right-continuous step", () => {
    // Survival holds flat between event times and then drops, so between two
    // estimates the path must go across before it goes down.
    const pts = stepPoints([0, 10, 20], [1, 0.8, 0.5]);
    expect(pts).toEqual([
      0, 1,
      10, 1, 10, 0.8,
      20, 0.8, 20, 0.5,
    ]);
  });

  it("handles degenerate step input", () => {
    expect(stepPoints([], [])).toEqual([]);
    expect(stepPoints([5], [1])).toEqual([5, 1]);
    // Mismatched lengths use the shorter of the two rather than reading undefined.
    expect(stepPoints([0, 1, 2], [1, 0.5])).toEqual([0, 1, 1, 1, 1, 0.5]);
  });

  it("never emits a diagonal segment", () => {
    const pts = stepPoints([0, 3, 7, 9], [1, 0.9, 0.4, 0.1]);
    for (let i = 2; i < pts.length; i += 2) {
      const dx = (pts[i] as number) !== (pts[i - 2] as number);
      const dy = (pts[i + 1] as number) !== (pts[i - 1] as number);
      expect(dx && dy).toBe(false);
    }
  });

  it("finds each group's contiguous slice in the given order", () => {
    const slices = groupSlices(["a", "a", "b", "b", "b"], ["b", "a"]);
    expect(slices).toEqual([
      { group: "b", start: 2, end: 4 },
      { group: "a", start: 0, end: 1 },
    ]);
  });

  it("skips groups with no points", () => {
    expect(groupSlices(["a", "a"], ["a", "b"])).toEqual([
      { group: "a", start: 0, end: 1 },
    ]);
    expect(groupSlices([], ["a"])).toEqual([]);
  });

  it("produces readable time ticks", () => {
    expect(timeTicks(100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(timeTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    // Degenerate input still yields a usable single tick.
    expect(timeTicks(0)).toEqual([0]);
    expect(timeTicks(Number.NaN)).toEqual([0]);
  });

  it("reserves room under the axis for one risk row per stratum", () => {
    const withTable = layoutKm(800, 600, 4, { showRiskTable: true });
    const without = layoutKm(800, 600, 4, { showRiskTable: false });
    expect(withTable.axisY).toBeLessThan(without.axisY);
    expect(withTable.riskTop).toBeGreaterThan(withTable.axisY);
    expect(withTable.plotH).toBe(withTable.axisY - withTable.top);
  });

  it("keeps the curve panel usable when the table would starve it", () => {
    // Twelve strata in a short element: the panel holds half the height and the
    // rows tighten to fit rather than the panel collapsing to nothing.
    const l = layoutKm(800, 200, 12, { showRiskTable: true });
    expect(l.plotH).toBeGreaterThan(0);
    expect(l.axisY).toBeGreaterThanOrEqual(100);
    expect(l.riskRowH).toBeLessThan(16);
    expect(l.riskRowH).toBeGreaterThanOrEqual(8);
  });
});
