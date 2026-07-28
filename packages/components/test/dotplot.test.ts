import { describe, expect, it } from "vitest";
import {
  dotRadius,
  layoutDotplot,
  uniqueInOrder,
  valueExtent,
} from "../src/components/dotplot.js";

describe("dotplot helpers", () => {
  it("scales dot AREA, not radius, with the percentage", () => {
    const full = dotRadius(100, 10);
    const half = dotRadius(50, 10);
    expect(full).toBe(10);
    // Half the percentage means half the area, so radius falls by sqrt(2).
    expect(half).toBeCloseTo(10 / Math.SQRT2, 10);
    expect(Math.PI * half ** 2).toBeCloseTo((Math.PI * full ** 2) / 2, 10);
  });

  it("clamps and rejects degenerate percentages", () => {
    expect(dotRadius(0, 10)).toBe(0);
    expect(dotRadius(-5, 10)).toBe(0);
    expect(dotRadius(Number.NaN, 10)).toBe(0);
    // Over 100 saturates rather than growing past the legend's largest swatch.
    expect(dotRadius(150, 10)).toBe(10);
  });

  it("takes the extent of a column", () => {
    expect(valueExtent([1, 5, 3])).toEqual([1, 5]);
    // A flat column would divide by zero downstream, so it widens.
    expect(valueExtent([2, 2])).toEqual([2, 3]);
    expect(valueExtent([])).toEqual([0, 1]);
    expect(valueExtent([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([0, 1]);
  });

  it("ignores non-finite values in the extent", () => {
    expect(valueExtent([1, Number.NaN, 4])).toEqual([1, 4]);
  });

  it("collects distinct values in first-appearance order", () => {
    expect(uniqueInOrder(["b", "a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(uniqueInOrder([])).toEqual([]);
  });

  it("divides the grid evenly among rows and columns", () => {
    const l = layoutDotplot(800, 600, 10, 5, { showLegend: true });
    expect(l.cellW).toBeCloseTo(l.plotW / 5, 10);
    expect(l.cellH).toBeCloseTo(l.plotH / 10, 10);
    expect(l.left + l.plotW).toBeLessThanOrEqual(800);
    expect(l.top + l.plotH).toBeLessThanOrEqual(600);
  });

  it("widens the left gutter for long row labels", () => {
    const short = layoutDotplot(800, 600, 4, 4, { showLegend: true }, 4);
    const long = layoutDotplot(800, 600, 4, 4, { showLegend: true }, 30);
    expect(long.left).toBeGreaterThan(short.left);
    // But never so far that the grid disappears.
    expect(long.plotW).toBeGreaterThan(0);
    expect(long.left).toBeLessThanOrEqual(150);
  });

  it("reclaims the legend gutter when the legend is off", () => {
    const on = layoutDotplot(800, 600, 4, 4, { showLegend: true });
    const off = layoutDotplot(800, 600, 4, 4, { showLegend: false });
    expect(off.plotW).toBeGreaterThan(on.plotW);
  });

  it("stays well-defined with no rows or columns", () => {
    const l = layoutDotplot(400, 300, 0, 0, { showLegend: true });
    expect(l.cellW).toBeGreaterThan(0);
    expect(l.cellH).toBeGreaterThan(0);
  });
});
