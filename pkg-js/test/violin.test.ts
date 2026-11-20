import { describe, expect, it } from "vitest";
import {
  densityRow,
  gridForRow,
  layoutViolin,
  maxDensity,
  resolveViolinAspect,
  violinMaxWidth,
  violinPolygon,
  violinValueTicks,
} from "../src/components/violin.js";
import { defaultTheme, textSizes } from "../src/core/index.js";

describe("violin value axis", () => {
  it("labels round values of a row in one format, each at its place", () => {
    // Before, the raw ends of the grid: "4.02" over "-2.9".
    const t = violinValueTicks(-2.9, 4.02, 400, 11);
    expect(t.labels).toEqual(["-2", "0", "2", "4"]);
    expect(t.ticks).toEqual([-2, 0, 2, 4]);
    expect(t.at[1]).toBeCloseTo(2.9 / 6.92, 9);
    expect(violinValueTicks(0, 2.5, 200, 11).labels).toEqual([
      "0.0",
      "0.5",
      "1.0",
      "1.5",
      "2.0",
      "2.5",
    ]);
  });

  it("keeps a line and a half of text between labels", () => {
    for (const length of [20, 40, 80, 160]) {
      const t = violinValueTicks(0, 10, length, 11);
      for (let i = 1; i < t.at.length; i += 1) {
        const gap = ((t.at[i] as number) - (t.at[i - 1] as number)) * length;
        expect(gap).toBeGreaterThanOrEqual(1.6 * 11);
      }
    }
  });

  it("takes the round value nearest the middle of a row too short for two", () => {
    expect(violinValueTicks(-0.0000456, 123_456_789, 2, 11).labels).toEqual([
      "100M",
    ]);
  });

  it("labels a flat grid once, at the middle", () => {
    expect(violinValueTicks(3, 3, 100, 11)).toEqual({
      ticks: [3],
      labels: ["3"],
      at: [0.5],
    });
  });
});

describe("violin helpers", () => {
  it("reads a density row out of the flattened matrix", () => {
    const d = [1, 2, 3, 4, 5, 6];
    expect(densityRow(d, 0, 3)).toEqual([1, 2, 3]);
    expect(densityRow(d, 1, 3)).toEqual([4, 5, 6]);
  });

  it("returns zeros rather than throwing on a malformed matrix", () => {
    expect(densityRow(undefined, 0, 3)).toEqual([0, 0, 0]);
    expect(densityRow([1, 2], 5, 2)).toEqual([0, 0]);
    expect(densityRow([1, 2], -1, 2)).toEqual([0, 0]);
    // A truncated final row is not read half-way.
    expect(densityRow([1, 2, 3], 1, 2)).toEqual([0, 0]);
  });

  it("takes the largest density across rows", () => {
    expect(
      maxDensity([
        [1, 5],
        [3, 2],
      ]),
    ).toBe(5);
    // Degenerate input must not divide by zero downstream.
    expect(maxDensity([])).toBe(1);
    expect(maxDensity([[0, 0]])).toBe(1);
    expect(maxDensity([[Number.NaN]])).toBe(1);
  });

  it("builds a closed, mirrored violin outline", () => {
    const poly = violinPolygon([0, 1, 2], [1, 2, 1], 2);
    // Two points per grid step: up one side, back down the other.
    expect(poly).toHaveLength(6);
    expect(poly[0]).toEqual({ x: 0.5, y: 0 });
    expect(poly[1]).toEqual({ x: 1, y: 1 });
    expect(poly[2]).toEqual({ x: 0.5, y: 2 });
    // The mirrored half retraces the grid in reverse with negated x, so the
    // turn happens at the top of the grid and the widest point is index 4.
    expect(poly[3]).toEqual({ x: -0.5, y: 2 });
    expect(poly[4]).toEqual({ x: -1, y: 1 });
    expect(poly[5]).toEqual({ x: -0.5, y: 0 });
  });

  it("keeps the outline symmetric about zero", () => {
    const poly = violinPolygon([0, 1, 2, 3], [0.2, 1, 0.7, 0.1], 1);
    const half = poly.length / 2;
    for (let i = 0; i < half; i += 1) {
      const a = poly[i] as { x: number; y: number };
      const b = poly[poly.length - 1 - i] as { x: number; y: number };
      expect(b.x).toBeCloseTo(-a.x, 12);
      expect(b.y).toBeCloseTo(a.y, 12);
    }
  });

  it("returns an empty outline for degenerate input", () => {
    expect(violinPolygon([], [], 1)).toEqual([]);
    expect(violinPolygon([0, 1], [1, 1], 0)).toEqual([]);
    // A grid longer than the density uses the shorter of the two.
    expect(violinPolygon([0, 1, 2], [1, 1], 1)).toHaveLength(4);
  });

  it("divides the grid evenly among rows and columns", () => {
    const l = layoutViolin(800, 600, 10, 5, { showFeatureLabels: true });
    expect(l.cellW).toBeCloseTo(l.plotW / 5, 10);
    expect(l.rowH).toBeCloseTo(l.plotH / 10, 10);
    expect(l.left + l.plotW).toBeLessThanOrEqual(800);
  });

  it("widens the left gutter for long feature names and can drop it", () => {
    const at = (showFeatureLabels: boolean, rowLabel: number) =>
      layoutViolin(800, 600, 4, 4, { showFeatureLabels }, { rowLabel });
    // Widths in px of labels of 4 and 30 characters.
    const short = at(true, 26);
    const long = at(true, 192);
    const none = at(false, 192);
    expect(long.left).toBeGreaterThan(short.left);
    expect(long.left).toBeLessThanOrEqual(150);
    expect(none.left).toBeLessThan(short.left);
  });

  it("sizes the bottom gutter from the longest group label", () => {
    const at = (colLabel: number) =>
      layoutViolin(800, 600, 4, 4, { showFeatureLabels: true }, { colLabel });
    // Turned 45 degrees, a label 100 px longer reaches 100 / sqrt(2) lower.
    expect(at(120).bottom - at(20).bottom).toBeCloseTo(100 * Math.SQRT1_2, 0);
    expect(at(2000).bottom).toBe(Math.floor(600 * 0.35));
  });

  it("widens the left gutter so the first group label stays inside", () => {
    const l = layoutViolin(
      400,
      600,
      4,
      8,
      { showFeatureLabels: false },
      { colLabel: 150 },
    );
    expect(l.left).toBeGreaterThan(16);
    expect(l.left + l.cellW / 2).toBeGreaterThanOrEqual(
      (150 + 1.1 * 11) * Math.SQRT1_2,
    );
  });

  it("widens the value axis gutter for wide labels", () => {
    const at = (valueLabel: number) =>
      layoutViolin(
        800,
        600,
        4,
        3,
        { showFeatureLabels: true, showValueAxis: true },
        { valueLabel },
      );
    // Labels start 9 px right of the grid and keep 4 px from the edge.
    expect(800 - at(20).left - at(20).plotW).toBe(44);
    expect(800 - at(60).left - at(60).plotW).toBe(73);
  });

  it("makes room on the right for the value axis", () => {
    const off = layoutViolin(800, 600, 4, 3, { showFeatureLabels: true });
    const on = layoutViolin(800, 600, 4, 3, {
      showFeatureLabels: true,
      showValueAxis: true,
    });
    expect(on.plotW).toBe(off.plotW - (44 - 14));
  });

  it("caps the widest violin at violinAspect times the row height", () => {
    const at = (cellW: number, rowH: number, width: number, aspect = 0.8) =>
      violinMaxWidth({ cellW, rowH }, width, aspect);
    // A wide cell: the row height sets the width.
    expect(at(260, 130, 0.85)).toBeCloseTo(104, 10);
    expect(at(260, 130, 0.85, 1.2)).toBeCloseTo(156, 10);
    // A narrow cell: violinWidth of the cell.
    expect(at(40, 130, 0.85)).toBeCloseTo(34, 10);
    expect(at(40, 130, 0.5)).toBeCloseTo(20, 10);
  });

  it("never caps a violin under four times the label size", () => {
    const at = (cellW: number, labelSize?: number) =>
      violinMaxWidth({ cellW, rowH: 22 }, 0.85, 0.8, labelSize);
    // 0.8 x 22 = 17.6 px is under the floor of 4 x 11 = 44 px.
    expect(at(140, 11)).toBe(44);
    // The floor does not grow with the column.
    expect(at(900, 11)).toBe(44);
    // It grows with the text.
    expect(at(140, 16)).toBe(64);
    expect(at(140)).toBe(4 * textSizes(defaultTheme).label);
    // It never takes a violin past violinWidth of its cell.
    expect(at(40, 11)).toBeCloseTo(34, 10);
  });

  it("reads violinAspect as a cap, no cap or the default 0.8", () => {
    expect(resolveViolinAspect(1.2)).toBe(1.2);
    expect(resolveViolinAspect(1e-9)).toBe(1e-9);
    expect(resolveViolinAspect(null)).toBeNull();
    expect(resolveViolinAspect(Number.POSITIVE_INFINITY)).toBeNull();
    const others = [
      undefined,
      0,
      -1,
      Number.NEGATIVE_INFINITY,
      Number.NaN,
      "1.2",
      {},
      [1.2],
      true,
    ];
    for (const v of others) {
      expect(resolveViolinAspect(v), String(v)).toBe(0.8);
    }
  });

  it("turns the cap off for a null or infinite violinAspect", () => {
    const layout = { cellW: 260, rowH: 130 };
    expect(violinMaxWidth(layout, 0.85, null)).toBeCloseTo(221, 10);
    expect(violinMaxWidth(layout, 0.85, Number.POSITIVE_INFINITY)).toBe(
      violinMaxWidth(layout, 0.85, null),
    );
  });

  it("stays well-defined with no rows or columns", () => {
    const l = layoutViolin(400, 300, 0, 0, { showFeatureLabels: true });
    expect(l.cellW).toBeGreaterThan(0);
    expect(l.rowH).toBeGreaterThan(0);
  });
});

describe("violin per-row grids", () => {
  it("gives each row its own grid when grids is supplied", () => {
    const grid = [0, 1, 2];
    const grids = [0, 1, 2, 10, 20, 30];
    expect(gridForRow(grid, grids, 0)).toEqual([0, 1, 2]);
    expect(gridForRow(grid, grids, 1)).toEqual([10, 20, 30]);
  });

  it("shares one grid when grids is absent", () => {
    const grid = [0, 5, 10];
    expect(gridForRow(grid, undefined, 0)).toEqual([0, 5, 10]);
    expect(gridForRow(grid, undefined, 7)).toEqual([0, 5, 10]);
  });

  it("falls back to the shared grid rather than blanking a row", () => {
    const grid = [0, 1, 2];
    // grids too short for row 1: better a shared-scale row than an empty one.
    expect(gridForRow(grid, [0, 1, 2], 1)).toEqual([0, 1, 2]);
    expect(gridForRow(grid, [0, 1, 2, 3], 1)).toEqual([0, 1, 2]);
    expect(gridForRow(grid, [9, 9, 9], -1)).toEqual([0, 1, 2]);
  });

  it("returns an empty grid when there is no shared grid either", () => {
    expect(gridForRow([], undefined, 0)).toEqual([]);
    expect(gridForRow([], [1, 2, 3], 0)).toEqual([]);
  });
});
