import { describe, expect, it } from "vitest";
import {
  layoutUpset,
  membershipRow,
  finiteMax,
} from "../src/components/upset.js";
import { textSizes } from "../src/core/theme.js";

describe("upset helpers", () => {
  it("takes the largest finite value", () => {
    expect(finiteMax([3, 7])).toBe(7);
    expect(finiteMax([])).toBe(0);
    expect(finiteMax([Number.NaN])).toBe(0);
  });

  it("reads a membership row out of the flattened matrix", () => {
    // Two intersections over three sets: {A,C} then {B}.
    const mem = [1, 0, 1, 0, 1, 0];
    expect(membershipRow(mem, 0, 3)).toEqual([true, false, true]);
    expect(membershipRow(mem, 1, 3)).toEqual([false, true, false]);
  });

  it("returns an empty row rather than throwing on a malformed matrix", () => {
    expect(membershipRow(undefined, 0, 3)).toEqual([false, false, false]);
    // Row past the end of the buffer.
    expect(membershipRow([1, 0], 5, 2)).toEqual([false, false]);
    expect(membershipRow([1, 0], -1, 2)).toEqual([false, false]);
    // A truncated final row is not read half-way.
    expect(membershipRow([1, 0, 1], 1, 2)).toEqual([false, false]);
    expect(membershipRow([1], 0, 0)).toEqual([]);
  });

  it("splits the height between bars and matrix", () => {
    const l = layoutUpset(900, 600, 5, 12, {
      barFraction: 0.5,
      showSetSizes: true,
    });
    expect(l.barH).toBeGreaterThan(0);
    expect(l.matrixH).toBeGreaterThan(0);
    expect(l.rowH).toBeCloseTo(l.matrixH / 5, 10);
    expect(l.barBaseline).toBeCloseTo(l.top + l.barH, 10);
  });

  it("clamps an extreme bar fraction so neither panel vanishes", () => {
    const tiny = layoutUpset(900, 600, 4, 8, {
      barFraction: 0.01,
      showSetSizes: true,
    });
    const huge = layoutUpset(900, 600, 4, 8, {
      barFraction: 0.99,
      showSetSizes: true,
    });
    expect(tiny.barH).toBeGreaterThan(0);
    expect(tiny.matrixH).toBeGreaterThan(0);
    expect(huge.barH).toBeGreaterThan(0);
    expect(huge.matrixH).toBeGreaterThan(0);
  });

  it("reclaims the set-size gutter when it is hidden", () => {
    const on = layoutUpset(900, 600, 4, 8, {
      barFraction: 0.5,
      showSetSizes: true,
    });
    const off = layoutUpset(900, 600, 4, 8, {
      barFraction: 0.5,
      showSetSizes: false,
    });
    expect(off.left).toBeLessThan(on.left);
    expect(off.setPanelW).toBe(0);
  });

  it("widens the name gutter for long set names", () => {
    const short = layoutUpset(
      900,
      600,
      4,
      8,
      { barFraction: 0.5, showSetSizes: true },
      30,
    );
    const long = layoutUpset(
      900,
      600,
      4,
      8,
      { barFraction: 0.5, showSetSizes: true },
      150,
    );
    expect(long.left).toBeGreaterThan(short.left);
    expect(long.nameW).toBe(160);
    expect(long.colW).toBeGreaterThan(0);
    // A name wider than the cap stops at 200 px, or 30% of a narrow widget.
    const huge = { barFraction: 0.5, showSetSizes: true };
    expect(layoutUpset(900, 600, 4, 8, huge, 400).nameW).toBe(200);
    expect(layoutUpset(400, 600, 4, 8, huge, 400).nameW).toBe(120);
  });

  it("stays well-defined with no sets or intersections", () => {
    const l = layoutUpset(400, 300, 0, 0, {
      barFraction: 0.5,
      showSetSizes: true,
    });
    expect(l.rowH).toBeGreaterThan(0);
    expect(l.colW).toBeGreaterThan(0);
  });
});

describe("upset layout at other text sizes", () => {
  const big = textSizes({ fontSize: 16 });
  const opts = { barFraction: 0.55, showSetSizes: true };

  it("draws the names and counts at the label size when the rows hold it", () => {
    expect(layoutUpset(700, 520, 4, 8, opts, 100, 20, big).rowText).toBe(
      big.label,
    );
  });

  it("shrinks the names and counts to rows shorter than the label size", () => {
    const cases = [
      [16, 16],
      [22, 12],
      [60, 16],
    ] as const;
    for (const [n, fontSize] of cases) {
      const s = textSizes({ fontSize });
      const l = layoutUpset(700, 520, n, 30, opts, 100, 20, s);
      expect(l.rowText).toBeLessThan(s.label);
      expect(l.rowText).toBeLessThanOrEqual(0.9 * l.rowH);
    }
  });

  it("narrows the name and count columns with the text", () => {
    const few = layoutUpset(700, 520, 4, 8, opts, 120, 30, big);
    const many = layoutUpset(700, 520, 30, 8, opts, 120, 30, big);
    expect(many.nameW).toBeLessThan(few.nameW);
    expect(many.left).toBeLessThan(few.left);
  });

  it("widens the set-size panel for its title at a large size", () => {
    // "set size" at 26 px is about 86 px wide.
    const s = textSizes({ fontSize: 24 });
    expect(
      layoutUpset(700, 520, 4, 8, opts, 48, 24, s).setPanelW,
    ).toBeGreaterThanOrEqual(86);
  });

  it("leaves room above the bars for the total at a large size", () => {
    // The total's baseline is 2 px under the top of the bars.
    const s = textSizes({ fontSize: 24 });
    const l = layoutUpset(700, 520, 4, 8, opts, 48, 24, s);
    expect(l.top + 2).toBeGreaterThanOrEqual(1.08 * s.label);
  });
});

describe("upset total beside the top tick", () => {
  const opts = { barFraction: 0.55, showSetSizes: true };

  it("keeps the bars where they are when the total fits beside the axis", () => {
    const plain = layoutUpset(900, 520, 6, 30, opts, 120, 30);
    const withTotal = layoutUpset(
      900,
      520,
      6,
      30,
      opts,
      120,
      30,
      undefined,
      70,
    );
    expect(withTotal).toEqual(plain);
    expect(withTotal.totalY).toBe(withTotal.top + 2);
  });

  it("gives a total wider than the bar panel a line of its own", () => {
    // At 300 px wide and fontSize 16, "20,000 total" is about 85 px wide,
    // more than the bars leave it. Before the fix it was drawn on the line
    // of the top tick label and ran into it.
    for (const fontSize of [16, 20]) {
      const s = textSizes({ fontSize });
      const plain = layoutUpset(300, 312, 6, 30, opts, 200, 30, s);
      const l = layoutUpset(300, 312, 6, 30, opts, 200, 30, s, 7 * s.label);
      expect(300 - 2 - 7 * s.label).toBeLessThan(l.left - 6);
      // The line of the total ends 0.3 of a label under its baseline; the
      // line of the top tick label starts 1.08 of a label above its
      // baseline, which is 0.35 of a label under its tick, 6 px under the
      // top of the bars.
      expect(l.totalY + 0.3 * s.label).toBeLessThanOrEqual(
        l.top + 6 + 0.35 * s.label - 1.08 * s.label,
      );
      expect(l.totalY - 1.08 * s.label).toBeGreaterThanOrEqual(0);
      expect(l.top).toBeGreaterThan(plain.top);
      expect(l.barBaseline).toBeCloseTo(l.top + l.barH, 10);
    }
  });
});
