import { describe, expect, it } from "vitest";
import {
  layoutUpset,
  membershipRow,
  finiteMax,
} from "../src/components/upset.js";

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
