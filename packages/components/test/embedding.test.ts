import { describe, it, expect } from "vitest";
import {
  categoryToIndex,
  isStringColumn,
  niceTicks,
  normalizeToUnit,
  paddedExtent,
  resolveColorMode,
} from "../src/components/embedding.js";

describe("embedding helpers", () => {
  it("pads an extent and handles degenerate/empty input", () => {
    expect(paddedExtent([0, 10], 0)).toEqual([0, 10]);
    expect(paddedExtent([5, 5])).toEqual([4, 6]);
    expect(paddedExtent([])).toEqual([0, 1]);
  });

  it("detects string vs numeric columns", () => {
    expect(isStringColumn(["a", "b"])).toBe(true);
    expect(isStringColumn([1, 2, 3])).toBe(false);
    expect(isStringColumn(new Float32Array([1, 2]))).toBe(false);
    // An empty column has no discernible type -> treated as non-string.
    expect(isStringColumn([])).toBe(false);
  });

  it("resolves color mode from the column type, honoring a forced mode", () => {
    expect(resolveColorMode(["cl1", "cl2"], "auto")).toBe("categorical");
    expect(resolveColorMode([0.1, 0.2], "auto")).toBe("continuous");
    expect(resolveColorMode(new Float32Array([1, 2]), "auto")).toBe("continuous");
    // Force overrides detection.
    expect(resolveColorMode(["cl1"], "continuous")).toBe("continuous");
    expect(resolveColorMode([1, 2], "categorical")).toBe("categorical");
    // No column defaults to continuous under "auto".
    expect(resolveColorMode(undefined, "auto")).toBe("continuous");
  });

  it("maps categorical labels to dense indices + ordered categories", () => {
    const { indices, categories } = categoryToIndex(["b", "a", "b", "c", "a"]);
    // First-appearance order: b=0, a=1, c=2.
    expect(categories).toEqual(["b", "a", "c"]);
    expect(Array.from(indices)).toEqual([0, 1, 0, 2, 1]);
    expect(indices).toBeInstanceOf(Int32Array);
  });

  it("honors an explicit category order", () => {
    const { indices, categories } = categoryToIndex(
      ["b", "a", "b", "c", "a"], ["a", "b", "c"]);
    expect(categories).toEqual(["a", "b", "c"]);
    expect(Array.from(indices)).toEqual([1, 0, 1, 2, 0]);
  });

  it("keeps ordered categories that no point carries", () => {
    // The whole point of pinning an order: a category can vanish from the data
    // (filtered out, or a facet with none of it) without the colors shuffling.
    const { indices, categories } = categoryToIndex(["c", "a"], ["a", "b", "c"]);
    expect(categories).toEqual(["a", "b", "c"]);
    expect(Array.from(indices)).toEqual([2, 0]);
  });

  it("appends categories missing from the explicit order", () => {
    const { indices, categories } = categoryToIndex(
      ["a", "z", "y", "z"], ["a", "b"]);
    expect(categories).toEqual(["a", "b", "z", "y"]);
    expect(Array.from(indices)).toEqual([0, 2, 3, 2]);
  });

  it("ignores duplicates in the explicit order", () => {
    expect(categoryToIndex(["a"], ["a", "a", "b"]).categories)
      .toEqual(["a", "b"]);
  });

  it("falls back to first-appearance order for a null/empty order", () => {
    expect(categoryToIndex(["b", "a"], null).categories).toEqual(["b", "a"]);
    expect(categoryToIndex(["b", "a"], []).categories).toEqual(["b", "a"]);
  });

  it("normalizes a column to [0,1] over its own extent", () => {
    const out = normalizeToUnit([0, 5, 10]);
    expect(Array.from(out)).toEqual([0, 0.5, 1]);
    expect(out).toBeInstanceOf(Float32Array);
  });

  it("normalizes with an explicit range and clamps out-of-range values", () => {
    const out = normalizeToUnit([-5, 0, 5, 15], [0, 10]);
    expect(Array.from(out)).toEqual([0, 0, 0.5, 1]);
  });

  it("maps a degenerate range to 0.5", () => {
    expect(Array.from(normalizeToUnit([7, 7, 7]))).toEqual([0.5, 0.5, 0.5]);
  });

  it("produces nice ticks within a domain", () => {
    const t = niceTicks([0, 10], 5);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(10);
    expect(t.length).toBeGreaterThan(2);
  });
});
