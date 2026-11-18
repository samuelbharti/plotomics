import { describe, it, expect } from "vitest";
import {
  columnMax,
  hitTest,
  layoutOncoplot,
  visibleRowLabels,
  wrapLegend,
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
    const off = {
      showBurden: false,
      showFrequency: false,
      showAnnotations: false,
      showLegend: false,
    };
    const l = layoutOncoplot(1000, 600, 20, 100, 2, off);
    expect(l.burdenH).toBe(0);
    expect(l.freqW).toBe(0);
    expect(l.annH).toBe(0);
    expect(l.top).toBe(0);
    // taller grid than the fully-decorated layout
    expect(l.gridH).toBeGreaterThan(
      layoutOncoplot(1000, 600, 20, 100, 2, OPTS).gridH,
    );
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
    const hit = hitTest(
      layout.left + layout.cellW * 3.5,
      layout.top + layout.cellH * 2.5,
      layout,
      20,
      100,
    );
    expect(hit).toEqual({ row: 2, col: 3 });
  });

  it("returns null outside the grid", () => {
    expect(hitTest(0, 0, layout, 20, 100)).toBeNull();
    expect(
      hitTest(layout.left - 1, layout.top + 5, layout, 20, 100),
    ).toBeNull();
    expect(
      hitTest(layout.left + layout.gridW + 1, layout.top + 5, layout, 20, 100),
    ).toBeNull();
    expect(
      hitTest(layout.left + 5, layout.top + layout.gridH + 1, layout, 20, 100),
    ).toBeNull();
  });

  it("clamps at the far edge rather than reporting an out-of-range cell", () => {
    const hit = hitTest(
      layout.left + layout.gridW - 0.5,
      layout.top + layout.gridH - 0.5,
      layout,
      20,
      100,
    );
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

  it("labels every row when they are far enough apart, every k-th when cramped", () => {
    expect(visibleRowLabels(20, 14).size).toBe(20);
    // 1.2 px rows: every 8th row keeps labels 9.6 px apart.
    const thinned = visibleRowLabels(400, 1.2);
    expect(thinned.size).toBe(50);
    expect([...thinned].slice(0, 3)).toEqual([0, 8, 16]);
    expect(visibleRowLabels(10, 0).size).toBe(0);
  });

  it("wraps the legend and starts each group on a new row", () => {
    const width = (s: string) => s.length * 6;
    const items = wrapLegend(
      [
        [
          { label: "Missense", color: "#a" },
          { label: "Truncating", color: "#b" },
          { label: "Splice", color: "#c" },
        ],
        [
          { label: "Subtype:", color: null },
          { label: "LumA", color: "#d" },
        ],
      ],
      150,
      width,
    );
    // Missense (13 + 48) and Truncating (13 + 60) fit in 150; Splice wraps.
    expect(items.map((i) => i.row)).toEqual([0, 0, 1, 2, 2]);
    expect(items[0]?.x).toBe(0);
    expect(items[1]?.x).toBe(13 + 48 + 14);
    expect(items[3]?.entry.label).toBe("Subtype:");
  });
});
