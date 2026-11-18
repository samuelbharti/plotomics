import { describe, expect, it } from "vitest";
import {
  groupSlices,
  groupRows,
  formatTime,
  layoutKm,
  stepPoints,
  tickDecimals,
  timeTicks,
} from "../src/components/km.js";

describe("km helpers", () => {
  it("expands points into a right-continuous step", () => {
    // Survival holds flat between event times and then drops, so between two
    // estimates the path must go across before it goes down.
    const pts = stepPoints([0, 10, 20], [1, 0.8, 0.5]);
    expect(pts).toEqual([0, 1, 10, 1, 10, 0.8, 20, 0.8, 20, 0.5]);
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
    // Twelve strata in a short element: the rows tighten and the panel keeps
    // its 40 px floor, so it never collapses to nothing.
    const l = layoutKm(800, 200, 12, { showRiskTable: true });
    expect(l.plotH).toBeGreaterThanOrEqual(40);
    // Eight strata fit at the tightest rows, so the panel keeps half.
    expect(layoutKm(800, 300, 8, { showRiskTable: true }).axisY).toBe(150);
    expect(l.riskRowH).toBeLessThan(16);
    expect(l.riskRowH).toBeGreaterThanOrEqual(8);
  });
});

describe("km rows, labels and layout", () => {
  it("collects each group's rows in time order when groups interleave", () => {
    // A table sorted by time overall: T and C alternate.
    const rows = groupRows(
      ["T", "C", "T", "C", "T", "C"],
      ["T", "C"],
      [0, 0, 5, 7, 12, 15],
    );
    expect(rows).toEqual([
      { group: "T", rows: [0, 2, 4] },
      { group: "C", rows: [1, 3, 5] },
    ]);
    // Out-of-order times within a group are sorted.
    expect(groupRows(["a", "a", "a"], ["a"], [5, 0, 2])).toEqual([
      { group: "a", rows: [1, 2, 0] },
    ]);
  });

  it("labels ticks with the decimals the most precise one needs", () => {
    expect(tickDecimals([0, 2.5, 5, 7.5, 10, 12.5])).toBe(1);
    expect(tickDecimals([0, 0.25, 0.5])).toBe(2);
    expect(tickDecimals([0, 200, 400])).toBe(0);
    // Uneven risk times: the first gap is 1, but 2.5 still needs a decimal.
    expect(tickDecimals([0, 1, 2.5, 5, 10])).toBe(1);
    // Floating-point noise from a tick generator does not add decimals.
    expect(tickDecimals([0, 0.1 * 3])).toBe(1);
    expect(formatTime(200)).toBe("200");
    expect(formatTime(8.333)).toBe("8.33");
  });

  it("widens the left gutter for long stratum names and skips an empty table", () => {
    const narrow = layoutKm(800, 600, 3, { showRiskTable: true }, true, 30);
    const wide = layoutKm(800, 600, 3, { showRiskTable: true }, true, 120);
    expect(narrow.left).toBe(58);
    expect(wide.left).toBeGreaterThanOrEqual(120 + 18);
    // No counts: no table, so the curves keep the height.
    const noCounts = layoutKm(800, 600, 3, { showRiskTable: true }, false, 120);
    expect(noCounts.axisY).toBeGreaterThan(wide.axisY);
    expect(noCounts.left).toBe(58);
    // A very long name stops at a share of the width, so the panel survives.
    const capped = layoutKm(300, 420, 2, { showRiskTable: true }, true, 400);
    expect(capped.left).toBeLessThanOrEqual(300 * 0.35);
    expect(300 - capped.left - capped.right).toBeGreaterThan(150);
  });

  it("keeps every risk row inside the element at small heights", () => {
    for (const [h, n] of [
      [200, 6],
      [250, 9],
      [300, 12],
    ] as const) {
      const l = layoutKm(600, h, n, { showRiskTable: true });
      // The last row's baseline sits at riskTop + (n - 1) * rowH + 3.
      const lastBaseline = l.riskTop + (n - 1) * l.riskRowH + 3;
      expect(lastBaseline).toBeLessThanOrEqual(h - 2);
      expect(l.riskRowH).toBeGreaterThanOrEqual(8);
      expect(l.plotH).toBeGreaterThan(30);
    }
  });
});
