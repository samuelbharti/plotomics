import { describe, it, expect } from "vitest";
import {
  groupRuns,
  layoutProfile,
  finiteMax,
  finiteMin,
  finiteTotal,
  barHeights,
  sharesDefined,
  valueTicks,
} from "../src/components/profile.js";
import { fitZeroTicks } from "../src/core/ticks.js";
import { textSizes } from "../src/core/theme.js";

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

  it("takes the smallest finite value, or 0", () => {
    expect(finiteMin([5, -3, 2])).toBe(-3);
    expect(finiteMin([Number.NEGATIVE_INFINITY, -1, Number.NaN])).toBe(-1);
    expect(finiteMin([2, 7])).toBe(0);
    expect(finiteMin([])).toBe(0);
  });
});

describe("profile value axis", () => {
  it("reaches below 0 for a negative value, with 0 as a tick", () => {
    // Before the fix the axis started at 0, and a negative bar ran down
    // through the bar labels and off the canvas.
    const a = valueTicks(-3, 5, 200, { minGapPx: 16 });
    expect(a.ticks).toEqual([-4, -2, 0, 2, 4, 6]);
    expect(a.bottom).toBe(-4);
    expect(a.top).toBe(6);
    expect(a.step).toBe(2);
  });

  it("adds no step for the noise of float32 values", () => {
    // Python sends -0.3 as -0.30000001192092896. Before the fix the axis
    // reached down to -0.35 for it, and up to 0.35 for 0.3.
    const signed = valueTicks(Math.fround(-0.3), Math.fround(0.1), 300, {
      minGapPx: 16,
    });
    expect(signed.bottom).toBe(-0.3);
    expect(signed.top).toBe(0.1);
    expect(valueTicks(0, Math.fround(0.3), 300).top).toBe(0.3);
  });

  it("ends at 0 when every value is negative", () => {
    const a = valueTicks(-7, 0, 200, { minGapPx: 16 });
    expect(a.top).toBe(0);
    expect(a.bottom).toBeLessThanOrEqual(-7);
    expect(a.ticks).toContain(0);
  });

  it("is the axis from 0 when no value is negative", () => {
    for (const [max, px] of [
      [10, 300],
      [0.625, 120],
      [124, 40],
    ] as const) {
      const a = valueTicks(0, max, px, { minGapPx: 16 });
      expect(a).toEqual({
        ...fitZeroTicks(max, px, { minGapPx: 16 }),
        bottom: 0,
      });
    }
  });

  it("leaves the label gap on a short axis", () => {
    const a = valueTicks(-30, 120, 60, { minGapPx: 16 });
    expect(60 / (a.ticks.length - 1)).toBeGreaterThanOrEqual(16);
    expect(a.bottom).toBeLessThanOrEqual(-30);
    expect(a.top).toBeGreaterThanOrEqual(120);
    expect(a.ticks).toContain(0);
  });
});

describe("profile shares with values that are not finite", () => {
  // R sends NA, NaN and Inf as null; Python sends NaN and Infinity as they
  // are. None of them draws a bar, so none counts in the total.
  const R = [3, null, 5] as unknown as number[];
  const PY = Float32Array.from([3, Number.NaN, 5]);
  const PY_INF = [3, Number.POSITIVE_INFINITY, 5];

  it("sums the finite values only", () => {
    expect(finiteTotal(PY)).toBe(8);
    expect(finiteTotal(R)).toBe(8);
    expect(finiteTotal(PY_INF)).toBe(8);
    expect(finiteTotal([])).toBe(0);
  });

  it("gives each bar its share of the finite total", () => {
    // Before the fix a NaN made the total NaN, so the bars kept their raw
    // values (3 and 5) under a percent axis that read up to 500%.
    for (const values of [PY, R, PY_INF]) {
      const h = barHeights(values, true);
      expect(h[0]).toBeCloseTo(0.375, 10);
      expect(h[1]).toBeNaN();
      expect(h[2]).toBeCloseTo(0.625, 10);
    }
  });

  it("keeps raw values without asFraction, and no bar for a missing one", () => {
    const h = barHeights(R, false);
    expect(h[0]).toBe(3);
    expect(h[1]).toBeNaN();
    expect(h[2]).toBe(5);
  });

  it("keeps raw values, for a plain number axis, when shares are not defined", () => {
    // Shares of a total with mixed signs, or of a total of 0, are not
    // defined. Before the fix [3, -1] drew 150% and -50%.
    for (const values of [
      [0, Number.NaN, 0],
      [2, -2, 1, -1],
      [3, -1],
      [5, -3, 2],
    ]) {
      expect(sharesDefined(values)).toBe(false);
      expect(barHeights(values, true)).toEqual(
        values.map((v) => (Number.isFinite(v) ? v : Number.NaN)),
      );
    }
    expect(sharesDefined([3, Number.NaN, 5])).toBe(true);
    expect(sharesDefined([0, 2])).toBe(true);
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

describe("profile layout at other text sizes", () => {
  const big = textSizes({ fontSize: 16 });
  const huge = textSizes({ fontSize: 24 });
  const opts = { showHeader: true, showBarLabels: true };

  it("widens the left gutter for wider y tick labels", () => {
    const narrow = layoutProfile(800, 380, 96, opts, false, 24, big, 30);
    const wide = layoutProfile(800, 380, 96, opts, false, 24, big, 70);
    expect(wide.left - narrow.left).toBeGreaterThanOrEqual(39);
    // The labels end 8 px short of the bars, and the rotated y title keeps
    // more than an em to the left of them.
    expect(wide.left - 8 - 70).toBeGreaterThanOrEqual(1.3 * big.axisTitle);
  });

  it("gives a larger title and larger group names more room", () => {
    const small = layoutProfile(800, 380, 96, opts, true);
    const large = layoutProfile(800, 380, 96, opts, true, 24, huge);
    expect(large.headerTop).toBeGreaterThan(small.headerTop);
    expect(large.plotTop - large.headerTop).toBeGreaterThan(
      small.plotTop - small.headerTop,
    );
  });

  it("starts the bars low enough for the top tick label without a banner", () => {
    const bare = { showHeader: false, showBarLabels: true };
    const l = layoutProfile(800, 380, 96, bare, false, 24, huge);
    expect(l.plotTop).toBeGreaterThanOrEqual((1.08 - 0.35) * huge.label);
  });

  it("lets the band of bar labels grow with the small size", () => {
    const small = layoutProfile(800, 380, 96, opts, false, 200);
    const large = layoutProfile(800, 380, 96, opts, false, 200, huge);
    expect(large.axisY).toBeLessThan(small.axisY);
  });
});
