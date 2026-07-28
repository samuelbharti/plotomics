import { describe, it, expect } from "vitest";
import {
  categoryToIndex,
  equalAspectDomains,
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

describe("equalAspectDomains", () => {
  const unitsPerPx = (d: [number, number], px: number) => (d[1] - d[0]) / px;

  it("gives both axes the same units per pixel", () => {
    const [x, y] = equalAspectDomains([0, 100], [0, 10], 400, 400);
    expect(unitsPerPx(x, 400)).toBeCloseTo(unitsPerPx(y, 400), 10);
  });

  it("only ever zooms out, so nothing that fitted before is cropped", () => {
    const [x, y] = equalAspectDomains([0, 100], [0, 10], 400, 400);
    expect(x[0]).toBeLessThanOrEqual(0);
    expect(x[1]).toBeGreaterThanOrEqual(100);
    expect(y[0]).toBeLessThanOrEqual(0);
    expect(y[1]).toBeGreaterThanOrEqual(10);
  });

  it("expands around the midpoint, leaving the centre put", () => {
    const [, y] = equalAspectDomains([0, 100], [4, 6], 400, 400);
    expect((y[0] + y[1]) / 2).toBeCloseTo(5, 10);
  });

  it("leaves an already-square pairing alone", () => {
    const [x, y] = equalAspectDomains([0, 100], [0, 50], 400, 200);
    expect(x).toEqual([0, 100]);
    expect(y).toEqual([0, 50]);
  });

  it("accounts for a non-square plot area", () => {
    // Twice as wide as tall, so x may span twice the data range.
    const [x, y] = equalAspectDomains([0, 100], [0, 100], 800, 400);
    expect(unitsPerPx(x, 800)).toBeCloseTo(unitsPerPx(y, 400), 10);
    expect(x[1] - x[0]).toBeCloseTo(2 * (y[1] - y[0]), 10);
  });

  it("is idempotent, so repeated application cannot creep outward", () => {
    const once = equalAspectDomains([0, 100], [0, 10], 640, 480);
    const twice = equalAspectDomains(once[0], once[1], 640, 480);
    expect(twice[0][0]).toBeCloseTo(once[0][0], 10);
    expect(twice[0][1]).toBeCloseTo(once[0][1], 10);
    expect(twice[1][0]).toBeCloseTo(once[1][0], 10);
    expect(twice[1][1]).toBeCloseTo(once[1][1], 10);
  });

  it("returns the inputs untouched while the box is still degenerate", () => {
    expect(equalAspectDomains([0, 1], [0, 1], 0, 0)).toEqual([[0, 1], [0, 1]]);
    expect(equalAspectDomains([0, 0], [0, 1], 100, 100)).toEqual([[0, 0], [0, 1]]);
  });
});
