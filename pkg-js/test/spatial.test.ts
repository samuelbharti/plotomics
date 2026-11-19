import { describe, it, expect } from "vitest";
import {
  fitTransform,
  isCategorical,
  medianNeighbourDistance,
  numericExtent,
  spatialLevels,
  spotRadius,
} from "../src/components/spatial.js";

/** Spots on a square grid, with `step` between neighbours. */
function grid(cols: number, rows: number, step: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      xs.push(c * step);
      ys.push(r * step);
    }
  }
  return { xs, ys };
}

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
    for (const [w, h] of [
      [300, 700],
      [1200, 200],
      [500, 500],
    ]) {
      const f = fitTransform(w as number, h as number, 600, 450);
      expect(f.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(f.offsetY).toBeGreaterThanOrEqual(-1e-9);
      expect(f.offsetX + 600 * f.scale).toBeLessThanOrEqual(
        (w as number) + 1e-9,
      );
      expect(f.offsetY + 450 * f.scale).toBeLessThanOrEqual(
        (h as number) + 1e-9,
      );
    }
  });

  it("maps the image centre to the container centre", () => {
    const f = fitTransform(1000, 500, 600, 600);
    expect(f.offsetX + 300 * f.scale).toBeCloseTo(500);
    expect(f.offsetY + 300 * f.scale).toBeCloseTo(250);
  });

  it("degrades safely on zero-sized input", () => {
    expect(fitTransform(0, 0, 600, 600)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(fitTransform(100, 100, 0, 0)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
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

describe("spatial levels and missing values", () => {
  it("decides the colour type from the first value that is not missing", () => {
    expect(isCategorical([null, "a", "b"], "auto")).toBe(true);
    expect(isCategorical([null, 1, 2], "auto")).toBe(false);
    expect(isCategorical([Number.NaN, 1], "auto")).toBe(false);
  });

  it("sorts levels in natural order and leaves out missing values", () => {
    expect(spatialLevels([10, 2, null, 0, 1])).toEqual(["0", "1", "2", "10"]);
    expect(spatialLevels(["b", "a"], ["b", "a"])).toEqual(["b", "a"]);
    // Numeric levels from R arrive as numbers; they are read as text.
    expect(spatialLevels([], [0, 1])).toEqual(["0", "1"]);
    // Numbers read as categories sort by value.
    expect(spatialLevels([0.5, 0.25, 1, 1.5])).toEqual([
      "0.25",
      "0.5",
      "1",
      "1.5",
    ]);
  });
});

describe("spatial spot spacing", () => {
  it("measures the spacing of a square grid", () => {
    const { xs, ys } = grid(20, 15, 10);
    expect(medianNeighbourDistance(xs, ys)).toBeCloseTo(10);
  });

  it("measures the spacing of a hexagonal grid like Visium", () => {
    // Rows offset by half a step, so every neighbour is 100 away.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let r = 0; r < 30; r += 1) {
      for (let c = 0; c < 30; c += 1) {
        xs.push(c * 100 + (r % 2) * 50);
        ys.push(r * 50 * Math.sqrt(3));
      }
    }
    expect(medianNeighbourDistance(xs, ys)).toBeCloseTo(100);
  });

  it("measures spots on one line", () => {
    expect(medianNeighbourDistance([20, 60, 100, 140], [50, 50, 50, 50])).toBe(
      40,
    );
    expect(medianNeighbourDistance([5, 5, 5], [0, 30, 60])).toBe(30);
  });

  it("leaves out missing coordinates and spots at the same place", () => {
    const xs = [0, 0, 5, null, Number.NaN];
    const ys = [0, 0, 0, 3, 1];
    expect(medianNeighbourDistance(xs, ys)).toBe(5);
  });

  it("gives null when the spots show no spacing", () => {
    expect(medianNeighbourDistance([], [])).toBeNull();
    expect(medianNeighbourDistance([3], [4])).toBeNull();
    expect(medianNeighbourDistance([3, 3], [4, 4])).toBeNull();
    expect(medianNeighbourDistance([3, null], [4, 9])).toBeNull();
  });

  it("measures a large slide from a sample, and a thin strip", () => {
    const { xs, ys } = grid(300, 300, 12);
    expect(medianNeighbourDistance(xs, ys)).toBeCloseTo(12);
    // Nearly flat: the grid keeps no more cells than spots along the strip.
    const n = 5000;
    const sx = Array.from({ length: n }, (_, i) => i * 2);
    const sy = Array.from({ length: n }, (_, i) => (i % 2) * 1e-9);
    expect(medianNeighbourDistance(sx, sy)).toBeCloseTo(2);
  });
});

/** The same median as medianNeighbourDistance, checking every pair. */
function bruteForce(xs: (number | null)[], ys: (number | null)[]) {
  const pts: [number, number][] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
      pts.push([x, y]);
    }
  });
  const dists: number[] = [];
  for (const [qx, qy] of pts) {
    let best = Infinity;
    for (const [x, y] of pts) {
      const d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d > 0 && d < best) best = d;
    }
    if (best < Infinity) dists.push(Math.sqrt(best));
  }
  if (dists.length === 0) return null;
  dists.sort((a, b) => a - b);
  const mid = dists.length >> 1;
  return dists.length % 2
    ? (dists[mid] as number)
    : ((dists[mid - 1] as number) + (dists[mid] as number)) / 2;
}

describe("spatial spot spacing on awkward layouts", () => {
  it("stays fast on a thin strip with one spot far off", () => {
    // Before the fix each ring of the search walked rows above and below
    // the one-row grid: 21 s at this size.
    const n = 90_000;
    const xs = Array.from({ length: n }, (_, i) => i * 0.01);
    xs[0] = 1e6;
    const ys = new Array<number>(n).fill(0);
    const t = performance.now();
    expect(medianNeighbourDistance(xs, ys)).toBeCloseTo(0.01, 6);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("stays fast with every spot at one of two places", () => {
    // Before the fix: 3 s for 1,000 spots, and longer with more.
    for (const n of [1000, 90_000]) {
      const xs = Array.from({ length: n }, (_, i) => (i % 2) * 50);
      const ys = new Array<number>(n).fill(0);
      const t = performance.now();
      expect(medianNeighbourDistance(xs, ys)).toBe(50);
      expect(performance.now() - t).toBeLessThan(1000);
    }
  });

  it("gives the result of checking every pair, on random layouts", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 300; k += 1) {
      const n = 2 + Math.floor(rand() * 200);
      // Coarse coordinates, so spots share places; some layouts are thin,
      // some have a spot far off, some have missing coordinates.
      const grid = 1 + Math.floor(rand() * 20);
      const thin = rand() < 0.3;
      const xs: (number | null)[] = [];
      const ys: (number | null)[] = [];
      for (let i = 0; i < n; i += 1) {
        xs.push(Math.floor(rand() * grid) * 3);
        ys.push(thin ? 0 : Math.floor(rand() * grid) * 2);
      }
      if (rand() < 0.3) xs[0] = 1e5 * rand();
      if (rand() < 0.2) ys[n - 1] = null;
      expect(medianNeighbourDistance(xs, ys), `layout ${k}`).toBe(
        bruteForce(xs, ys),
      );
    }
  });
});
