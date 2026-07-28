import { describe, it, expect } from "vitest";
import {
  columnMax,
  hitTest,
  layoutOncoplot,
  visibleRowLabels,
} from "../src/components/oncoplot.js";

const OPTS = {
  showBurden: true,
  showFrequency: true,
  showAnnotations: true,
  showLegend: true,
};

describe("oncoplot layout", () => {
  it("splits the container into grid, marginal and annotation regions", () => {
    const l = layoutOncoplot(1000, 600, 20, 100, 2, OPTS);
    expect(l.left).toBe(96);
    expect(l.freqW).toBe(96);
    expect(l.burdenH).toBeGreaterThan(0);
    // two strips plus the gap
    expect(l.annH).toBe(6 + 2 * 13);
    // grid fills what is left over
    expect(l.left + l.gridW + l.freqW).toBeLessThanOrEqual(1000);
    expect(l.cellW).toBeCloseTo(l.gridW / 100);
    expect(l.cellH).toBeCloseTo(l.gridH / 20);
  });

  it("reclaims the marginal space when those panels are hidden", () => {
    const off = { showBurden: false, showFrequency: false, showAnnotations: false, showLegend: false };
    const l = layoutOncoplot(1000, 600, 20, 100, 2, off);
    expect(l.burdenH).toBe(0);
    expect(l.freqW).toBe(0);
    expect(l.annH).toBe(0);
    expect(l.top).toBe(0);
    // taller grid than the fully-decorated layout
    expect(l.gridH).toBeGreaterThan(layoutOncoplot(1000, 600, 20, 100, 2, OPTS).gridH);
  });

  it("has no annotation band when there are no annotations", () => {
    expect(layoutOncoplot(1000, 600, 20, 100, 0, OPTS).annH).toBe(0);
  });

  it("never returns a degenerate grid for a tiny container", () => {
    const l = layoutOncoplot(10, 10, 5, 5, 3, OPTS);
    expect(l.gridW).toBeGreaterThan(0);
    expect(l.gridH).toBeGreaterThan(0);
  });
});

describe("oncoplot hit testing", () => {
  const layout = layoutOncoplot(1000, 600, 20, 100, 2, OPTS);

  it("maps a pixel inside the grid to its cell", () => {
    const hit = hitTest(layout.left + layout.cellW * 3.5, layout.top + layout.cellH * 2.5,
      layout, 20, 100);
    expect(hit).toEqual({ row: 2, col: 3 });
  });

  it("returns null outside the grid", () => {
    expect(hitTest(0, 0, layout, 20, 100)).toBeNull();
    expect(hitTest(layout.left - 1, layout.top + 5, layout, 20, 100)).toBeNull();
    expect(hitTest(layout.left + layout.gridW + 1, layout.top + 5, layout, 20, 100)).toBeNull();
    expect(hitTest(layout.left + 5, layout.top + layout.gridH + 1, layout, 20, 100)).toBeNull();
  });

  it("clamps at the far edge rather than reporting an out-of-range cell", () => {
    const hit = hitTest(layout.left + layout.gridW - 0.5, layout.top + layout.gridH - 0.5,
      layout, 20, 100);
    expect(hit).toEqual({ row: 19, col: 99 });
  });
});

describe("oncoplot column helpers", () => {
  it("returns the max of a column", () => {
    expect(columnMax([1, 7, 3])).toBe(7);
  });

  it("floors at 1 so bar scales never divide by zero", () => {
    expect(columnMax([0, 0, 0])).toBe(1);
    expect(columnMax([])).toBe(1);
    expect(columnMax(undefined)).toBe(1);
  });

  it("labels every row when they are far enough apart, none when cramped", () => {
    expect(visibleRowLabels(20, 14).size).toBe(20);
    expect(visibleRowLabels(400, 1.2).size).toBe(0);
  });
});
