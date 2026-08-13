import { describe, expect, it } from "vitest";
import {
  layoutUpset,
  membershipRow,
  niceMax,
} from "../src/components/upset.js";

describe("upset helpers", () => {
  it("rounds up to a readable axis maximum", () => {
    expect(niceMax([3, 7])).toBe(10);
    expect(niceMax([120, 40])).toBe(200);
    expect(niceMax([1])).toBe(1);
    // Degenerate input still gives a usable, non-zero scale.
    expect(niceMax([])).toBe(1);
    expect(niceMax([0, 0])).toBe(1);
    expect(niceMax([Number.NaN])).toBe(1);
  });

  it("never returns a maximum below the data", () => {
    for (const vals of [[9], [11], [99], [101], [249], [251]]) {
      expect(niceMax(vals)).toBeGreaterThanOrEqual(vals[0] as number);
    }
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
    const l = layoutUpset(900, 600, 5, 12, { barFraction: 0.5, showSetSizes: true });
    expect(l.barH).toBeGreaterThan(0);
    expect(l.matrixH).toBeGreaterThan(0);
    expect(l.rowH).toBeCloseTo(l.matrixH / 5, 10);
    expect(l.barBaseline).toBeCloseTo(l.top + l.barH, 10);
  });

  it("clamps an extreme bar fraction so neither panel vanishes", () => {
    const tiny = layoutUpset(900, 600, 4, 8, { barFraction: 0.01, showSetSizes: true });
    const huge = layoutUpset(900, 600, 4, 8, { barFraction: 0.99, showSetSizes: true });
    expect(tiny.barH).toBeGreaterThan(0);
    expect(tiny.matrixH).toBeGreaterThan(0);
    expect(huge.barH).toBeGreaterThan(0);
    expect(huge.matrixH).toBeGreaterThan(0);
  });

  it("reclaims the set-size gutter when it is hidden", () => {
    const on = layoutUpset(900, 600, 4, 8, { barFraction: 0.5, showSetSizes: true });
    const off = layoutUpset(900, 600, 4, 8, { barFraction: 0.5, showSetSizes: false });
    expect(off.left).toBeLessThan(on.left);
    expect(off.setPanelW).toBe(0);
  });

  it("widens the name gutter for long set names", () => {
    const short = layoutUpset(900, 600, 4, 8, { barFraction: 0.5, showSetSizes: true }, 4);
    const long = layoutUpset(900, 600, 4, 8, { barFraction: 0.5, showSetSizes: true }, 40);
    expect(long.left).toBeGreaterThan(short.left);
    expect(long.colW).toBeGreaterThan(0);
  });

  it("stays well-defined with no sets or intersections", () => {
    const l = layoutUpset(400, 300, 0, 0, { barFraction: 0.5, showSetSizes: true });
    expect(l.rowH).toBeGreaterThan(0);
    expect(l.colW).toBeGreaterThan(0);
  });
});
