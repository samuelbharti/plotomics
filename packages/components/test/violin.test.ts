import { describe, expect, it } from "vitest";
import {
  densityRow,
  gridForRow,
  layoutViolin,
  maxDensity,
  violinPolygon,
} from "../src/components/violin.js";

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
    expect(maxDensity([[1, 5], [3, 2]])).toBe(5);
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
    const short = layoutViolin(800, 600, 4, 4, { showFeatureLabels: true }, 4);
    const long = layoutViolin(800, 600, 4, 4, { showFeatureLabels: true }, 30);
    const none = layoutViolin(800, 600, 4, 4, { showFeatureLabels: false }, 30);
    expect(long.left).toBeGreaterThan(short.left);
    expect(long.left).toBeLessThanOrEqual(150);
    expect(none.left).toBeLessThan(short.left);
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
