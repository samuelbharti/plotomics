import { describe, it, expect } from "vitest";
import {
  fitTransform,
  isCategorical,
  numericExtent,
  spotRadius,
} from "../src/components/spatial.js";

describe("spatial fit transform", () => {
  it("letterboxes a square image into a wide container", () => {
    const f = fitTransform(1000, 500, 600, 600);
    // Height is the binding constraint.
    expect(f.scale).toBeCloseTo(500 / 600);
    expect(f.offsetY).toBe(0);
    expect(f.offsetX).toBeCloseTo((1000 - 600 * (500 / 600)) / 2);
  });

  it("pillarboxes a wide image into a tall container", () => {
    const f = fitTransform(400, 900, 800, 400);
    expect(f.scale).toBeCloseTo(400 / 800);
    expect(f.offsetX).toBe(0);
    expect(f.offsetY).toBeCloseTo((900 - 400 * 0.5) / 2);
  });

  it("keeps the whole image inside the container", () => {
    for (const [w, h] of [[300, 700], [1200, 200], [500, 500]]) {
      const f = fitTransform(w as number, h as number, 600, 450);
      expect(f.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(f.offsetY).toBeGreaterThanOrEqual(-1e-9);
      expect(f.offsetX + 600 * f.scale).toBeLessThanOrEqual((w as number) + 1e-9);
      expect(f.offsetY + 450 * f.scale).toBeLessThanOrEqual((h as number) + 1e-9);
    }
  });

  it("maps the image centre to the container centre", () => {
    const f = fitTransform(1000, 500, 600, 600);
    expect(f.offsetX + 300 * f.scale).toBeCloseTo(500);
    expect(f.offsetY + 300 * f.scale).toBeCloseTo(250);
  });

  it("degrades safely on zero-sized input", () => {
    expect(fitTransform(0, 0, 600, 600)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(fitTransform(100, 100, 0, 0)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe("spatial spot radius", () => {
  it("scales with the fit and the user multiplier", () => {
    expect(spotRadius(10, 2, 1)).toBe(10);
    expect(spotRadius(10, 2, 0.5)).toBe(5);
  });

  it("never goes below one pixel", () => {
    expect(spotRadius(0.5, 0.1, 1)).toBe(1);
    expect(spotRadius(0, 1, 1)).toBe(1);
  });
});

describe("spatial colour handling", () => {
  it("detects categorical from string columns and continuous from numbers", () => {
    expect(isCategorical(["a", "b"], "auto")).toBe(true);
    expect(isCategorical([1, 2], "auto")).toBe(false);
  });

  it("honours an explicit mode over the column type", () => {
    expect(isCategorical([1, 2], "categorical")).toBe(true);
    expect(isCategorical(["a"], "continuous")).toBe(false);
  });

  it("treats a missing or empty column as not categorical", () => {
    expect(isCategorical(undefined, "auto")).toBe(false);
    expect(isCategorical([], "auto")).toBe(false);
  });

  it("computes a numeric extent, widening a degenerate one", () => {
    expect(numericExtent([1, 5, 3])).toEqual([1, 5]);
    expect(numericExtent([2, 2])).toEqual([2, 3]);
  });

  it("ignores non-finite values", () => {
    expect(numericExtent([NaN, 2, Infinity, 6])).toEqual([2, 6]);
    expect(numericExtent([NaN, NaN])).toEqual([0, 1]);
    expect(numericExtent([])).toEqual([0, 1]);
  });
});
