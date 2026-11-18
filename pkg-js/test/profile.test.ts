import { describe, it, expect } from "vitest";
import {
  groupRuns,
  layoutProfile,
  finiteMax,
} from "../src/components/profile.js";

describe("profile group runs", () => {
  it("collapses a group column into contiguous runs", () => {
    const runs = groupRuns(["C>A", "C>A", "C>G", "C>G", "C>G", "C>T"]);
    expect(runs).toEqual([
      { group: "C>A", start: 0, end: 1 },
      { group: "C>G", start: 2, end: 4 },
      { group: "C>T", start: 5, end: 5 },
    ]);
  });

  it("splits a group that appears in two stretches", () => {
    // A banner spanning the gap would claim bars it does not cover.
    const runs = groupRuns(["A", "B", "A"]);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.group)).toEqual(["A", "B", "A"]);
  });

  it("handles a single group and an empty column", () => {
    expect(groupRuns(["x", "x"])).toEqual([{ group: "x", start: 0, end: 1 }]);
    expect(groupRuns([])).toEqual([]);
  });

  it("covers every bar exactly once", () => {
    const groups = ["a", "a", "b", "c", "c", "c"];
    const runs = groupRuns(groups);
    const covered = runs.reduce((n, r) => n + (r.end - r.start + 1), 0);
    expect(covered).toBe(groups.length);
  });
});

describe("profile axis maximum", () => {
  it("takes the largest finite value", () => {
    expect(finiteMax([0, 3, 7])).toBe(7);
    expect(finiteMax([Number.NaN, 2])).toBe(2);
    expect(finiteMax([])).toBe(0);
  });
});

describe("profile layout", () => {
  it("stacks banner, plot and label band top to bottom", () => {
    const l = layoutProfile(1000, 400, 96, {
      showHeader: true,
      showBarLabels: true,
    });
    expect(l.headerTop).toBeLessThan(l.plotTop);
    expect(l.plotTop).toBeLessThan(l.baseline);
    expect(l.baseline).toBe(l.axisY);
    expect(l.slot).toBeCloseTo(l.innerW / 96);
    expect(l.plotH).toBeGreaterThan(0);
  });

  it("reclaims the banner and label bands when hidden", () => {
    const withAll = layoutProfile(1000, 400, 96, {
      showHeader: true,
      showBarLabels: true,
    });
    const bare = layoutProfile(1000, 400, 96, {
      showHeader: false,
      showBarLabels: false,
    });
    expect(bare.plotH).toBeGreaterThan(withAll.plotH);
    expect(bare.headerTop).toBe(0);
  });

  it("never returns a degenerate plot area", () => {
    const l = layoutProfile(20, 20, 96, {
      showHeader: true,
      showBarLabels: true,
    });
    expect(l.plotH).toBeGreaterThan(0);
    expect(l.slot).toBeGreaterThan(0);
  });
});

describe("profile title and bar labels", () => {
  it("gives a title its own row above the strip", () => {
    const opts = { showHeader: true, showBarLabels: true };
    const plain = layoutProfile(1000, 400, 96, opts);
    const titled = layoutProfile(1000, 400, 96, opts, true);
    expect(titled.headerTop).toBeGreaterThanOrEqual(18);
    expect(titled.plotTop - plain.plotTop).toBe(18);
    // Without the strip the title still sits above the plot.
    const bare = layoutProfile(
      1000,
      400,
      96,
      { ...opts, showHeader: false },
      true,
    );
    expect(bare.plotTop).toBeGreaterThan(18);
  });

  it("makes room under the axis for the longest bar label", () => {
    const opts = { showHeader: true, showBarLabels: true };
    const short = layoutProfile(1000, 400, 96, opts, false, 20);
    const long = layoutProfile(1000, 400, 96, opts, false, 40);
    expect(short.axisY - long.axisY).toBe(20);
  });
});
