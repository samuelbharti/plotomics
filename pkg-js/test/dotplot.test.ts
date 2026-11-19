import { describe, expect, it } from "vitest";
import {
  dotMaxRadius,
  dotRadius,
  layoutDotplot,
  uniqueInOrder,
  valueExtent,
} from "../src/components/dotplot.js";
import { textSizes } from "../src/core/theme.js";

describe("dotMaxRadius", () => {
  it("takes the option when the cells have room for it", () => {
    expect(dotMaxRadius(9, 40, 30)).toBe(9);
  });

  it("shrinks the dots to fit their cells", () => {
    expect(dotMaxRadius(9, 40, 12)).toBe(5);
    expect(dotMaxRadius(9, 8, 30)).toBe(3);
  });

  it("keeps a 1 px radius in cells too small for a dot", () => {
    // Before the fix the radius went to 0 or below, and no dot was drawn.
    expect(dotMaxRadius(9, 22, 1.6)).toBe(1);
    expect(dotMaxRadius(9, 2, 2)).toBe(1);
    expect(dotMaxRadius(9, 0, 0)).toBe(1);
  });

  it("never goes below 0, or above a smaller option", () => {
    expect(dotMaxRadius(0.5, 2, 2)).toBe(0.5);
    expect(dotMaxRadius(-3, 40, 30)).toBe(0);
  });
});

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

  it("skips null, which R sends for NA, in the extent and the radius", () => {
    const col = [1, null, 3, Number.NaN] as unknown as number[];
    expect(valueExtent(col)).toEqual([1, 3]);
    expect(dotRadius(null as unknown as number, 10)).toBe(0);
  });

  it("ignores non-finite values in the extent", () => {
    expect(valueExtent([1, Number.NaN, 4])).toEqual([1, 4]);
  });

  it("widens values that differ only in their last digits as flat ones", () => {
    // Before the fix these kept their width of a few units of the last
    // digit, and the two dots took the two ends of the ramp.
    expect(valueExtent([0.3, 0.1 + 0.2])).toEqual([0.3, 1.3]);
    expect(valueExtent([8, 8.000000000000002])).toEqual([8, 9]);
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
    const at = (rowLabel: number) =>
      layoutDotplot(800, 600, 4, 4, { showLegend: true }, { rowLabel });
    // Widths in px of labels of 4 and 30 characters.
    const short = at(26);
    const long = at(192);
    expect(long.left).toBeGreaterThan(short.left);
    // But never so far that the grid disappears.
    expect(long.plotW).toBeGreaterThan(0);
    expect(long.left).toBeLessThanOrEqual(150);
  });

  it("sizes the bottom gutter from the longest column label", () => {
    const at = (colLabel: number) =>
      layoutDotplot(800, 600, 4, 4, { showLegend: true }, { colLabel });
    // Turned 45 degrees, a label 100 px longer reaches 100 / sqrt(2) lower.
    expect(at(120).bottom - at(20).bottom).toBeCloseTo(100 * Math.SQRT1_2, 0);
    // At most 35% of the height.
    expect(at(2000).bottom).toBe(Math.floor(600 * 0.35));
  });

  it("widens the left gutter so the first column label stays inside", () => {
    // Eight narrow columns with a 150 px label under each: turned 45
    // degrees, the first one reaches (150 + 1.1 * 11) / sqrt(2) px left of
    // its column.
    const l = layoutDotplot(
      400,
      600,
      4,
      8,
      { showLegend: false },
      { rowLabel: 10, colLabel: 150 },
    );
    expect(l.left).toBeGreaterThan(52);
    expect(l.left + l.cellW / 2).toBeGreaterThanOrEqual(
      (150 + 1.1 * 11) * Math.SQRT1_2,
    );
  });

  it("scales the left gutter's cap and the top with the text size", () => {
    const at = (fontSize: number) =>
      layoutDotplot(
        800,
        600,
        4,
        4,
        { showLegend: true },
        { sizes: textSizes({ fontSize }), rowLabel: 400 },
      );
    expect(at(12).left).toBe(150);
    // 150 px times 22 / 11 is 300 px, past 35% of the width.
    expect(at(24).left).toBe(280);
    expect(at(12).top).toBe(12);
    expect(at(24).top).toBe(18);
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
