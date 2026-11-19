import { describe, it, expect } from "vitest";
import {
  MAX_CLUSTER_N,
  cellAt,
  clusterVectors,
  correlationDistance,
  dataExtent,
  dendrogramPositions,
  distanceMatrix,
  euclidean,
  identityOrder,
  normalizePrecomputed,
  symmetricExtent,
  toColVectors,
  toRowVectors,
  zScoreByRow,
} from "../src/components/clustermap-cluster.js";
import { computeLayout } from "../src/components/clustermap.js";
import { textSizes } from "../src/core/theme.js";

describe("clustermap data helpers", () => {
  it("reads row-major cells", () => {
    // 2 rows × 3 cols
    const v = [1, 2, 3, 4, 5, 6];
    expect(cellAt(v, 3, 0, 0)).toBe(1);
    expect(cellAt(v, 3, 0, 2)).toBe(3);
    expect(cellAt(v, 3, 1, 0)).toBe(4);
    expect(cellAt(v, 3, 1, 2)).toBe(6);
  });

  it("extracts row and column vectors", () => {
    const v = [1, 2, 3, 4, 5, 6]; // 2×3
    expect(toRowVectors(v, 2, 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(toColVectors(v, 2, 3)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("computes data extent and handles degenerate/non-finite input", () => {
    expect(dataExtent([3, 1, 2])).toEqual([1, 3]);
    expect(dataExtent([5, 5])).toEqual([4, 6]);
    expect(dataExtent([])).toEqual([0, 1]);
    expect(dataExtent([NaN, Infinity])).toEqual([0, 1]);
  });

  it("computes a symmetric extent around zero", () => {
    expect(symmetricExtent([-3, 1, 2])).toEqual([-3, 3]);
    expect(symmetricExtent([0.2, 0.5])).toEqual([-0.5, 0.5]);
  });
});

describe("distance metrics", () => {
  it("euclidean distance", () => {
    expect(euclidean([0, 0], [3, 4])).toBe(5);
    expect(euclidean([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("correlation distance: perfectly correlated -> 0, anti -> 2", () => {
    expect(correlationDistance([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 10);
    expect(correlationDistance([1, 2, 3], [-1, -2, -3])).toBeCloseTo(2, 10);
  });

  it("correlation distance: constant vector -> max dissimilarity (1)", () => {
    expect(correlationDistance([1, 1, 1], [1, 2, 3])).toBe(1);
  });
});

describe("z-score standardization (per row)", () => {
  it("centers and scales each row to unit sd", () => {
    // row0: [1,2,3] mean 2 sd sqrt(2/3); row1 constant
    const z = zScoreByRow([1, 2, 3, 5, 5, 5], 2, 3);
    // row means ~0
    const r0 = [z[0]!, z[1]!, z[2]!];
    const mean0 = (r0[0]! + r0[1]! + r0[2]!) / 3;
    expect(mean0).toBeCloseTo(0, 5);
    // population sd == 1 (output stored as float32, so use a float32 tolerance)
    const var0 = r0.reduce((s, x) => s + x * x, 0) / 3;
    expect(var0).toBeCloseTo(1, 5);
    // constant row -> all zeros (no divide-by-zero)
    expect([z[3], z[4], z[5]]).toEqual([0, 0, 0]);
  });
});

describe("clustering", () => {
  it("recovers block structure: identical rows end up adjacent in leaf order", () => {
    // Two clear groups: rows 0,1 near [0,0,0]; rows 2,3 near [10,10,10].
    const vectors = [
      [0, 0, 0],
      [0.1, 0, 0.1],
      [10, 10, 10],
      [10.1, 9.9, 10],
    ];
    const { order, dendrogram } = clusterVectors(
      vectors,
      "euclidean",
      "average",
    );
    expect(order).toHaveLength(4);
    // The two low rows are adjacent and the two high rows are adjacent.
    const posOf = new Map(order.map((leaf, slot) => [leaf, slot]));
    expect(Math.abs(posOf.get(0)! - posOf.get(1)!)).toBe(1);
    expect(Math.abs(posOf.get(2)! - posOf.get(3)!)).toBe(1);
    // n-1 merges for n leaves.
    expect(dendrogram!.merges).toHaveLength(3);
    expect(dendrogram!.n).toBe(4);
  });

  it("returns identity order for < 2 vectors and no dendrogram", () => {
    expect(clusterVectors([], "euclidean", "average")).toEqual({
      order: [],
      dendrogram: null,
    });
    expect(clusterVectors([[1, 2]], "euclidean", "complete")).toEqual({
      order: [0],
      dendrogram: null,
    });
  });

  it("refuses to auto-cluster above MAX_CLUSTER_N", () => {
    const n = MAX_CLUSTER_N + 1;
    const vectors = Array.from({ length: n }, () => [Math.random()]);
    const res = clusterVectors(vectors, "euclidean", "average");
    expect(res.dendrogram).toBeNull();
    expect(res.order).toEqual(identityOrder(n));
  });

  it("dendrogram merges reference already-emitted nodes", () => {
    const vectors = [[0], [1], [8], [9], [20]];
    const { dendrogram } = clusterVectors(vectors, "euclidean", "complete");
    const n = dendrogram!.n;
    dendrogram!.merges.forEach((m, k) => {
      const maxId = n + k; // ids emitted before this merge
      expect(m.left).toBeLessThan(maxId);
      expect(m.right).toBeLessThan(maxId);
      expect(m.height).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("precomputed order/linkage validation", () => {
  it("accepts a valid bare permutation", () => {
    expect(normalizePrecomputed([2, 0, 1], 3)).toEqual({
      order: [2, 0, 1],
      dendrogram: null,
    });
  });

  it("rejects wrong length, duplicates and out-of-range indices", () => {
    expect(normalizePrecomputed([0, 1], 3)).toBeNull();
    expect(normalizePrecomputed([0, 0, 1], 3)).toBeNull();
    expect(normalizePrecomputed([0, 1, 3], 3)).toBeNull();
    expect(normalizePrecomputed("nope", 3)).toBeNull();
  });

  it("accepts a dendrogram object with order + merges", () => {
    const d = {
      n: 3,
      order: [0, 1, 2],
      merges: [
        { left: 0, right: 1, height: 1 },
        { left: 3, right: 2, height: 2 },
      ],
    };
    const res = normalizePrecomputed(d, 3);
    expect(res!.order).toEqual([0, 1, 2]);
    expect(res!.dendrogram!.merges).toHaveLength(2);
  });
});

describe("dendrogram layout positions", () => {
  it("places leaves at their slot and internal nodes at child midpoints", () => {
    // 3 leaves, order [2,0,1]. Merge 0 joins leaves 0&1 -> node 3; merge 1 joins node 3 & leaf 2.
    const d = {
      n: 3,
      order: [2, 0, 1],
      merges: [
        { left: 0, right: 1, height: 1 },
        { left: 3, right: 2, height: 2 },
      ],
    };
    const { pos, height } = dendrogramPositions(d);
    // slots: leaf2->0, leaf0->1, leaf1->2
    expect(pos[2]).toBe(0);
    expect(pos[0]).toBe(1);
    expect(pos[1]).toBe(2);
    // node 3 = midpoint of leaves 0 (slot1) and 1 (slot2) = 1.5
    expect(pos[3]).toBe(1.5);
    // node 4 = midpoint of node3 (1.5) and leaf2 (0) = 0.75
    expect(pos[4]).toBe(0.75);
    expect(height[3]).toBe(1);
    expect(height[4]).toBe(2);
  });
});

describe("layout math", () => {
  it("reserves dendrogram bands only when shown AND present", () => {
    const l = computeLayout(800, 600, {
      showRowDendrogram: true,
      showColDendrogram: true,
      hasRowDendro: true,
      hasColDendro: true,
      showLabels: true,
    });
    expect(l.rowDendroW).toBeGreaterThan(0);
    expect(l.colDendroH).toBeGreaterThan(0);
    expect(l.heat.w).toBeGreaterThan(0);
    expect(l.heat.h).toBeGreaterThan(0);

    const collapsed = computeLayout(800, 600, {
      showRowDendrogram: true,
      showColDendrogram: true,
      hasRowDendro: false, // no dendrogram computed -> no band
      hasColDendro: false,
      showLabels: false,
    });
    expect(collapsed.rowDendroW).toBe(0);
    expect(collapsed.colDendroH).toBe(0);
    // Heatmap starts closer to the origin when bands collapse.
    expect(collapsed.heat.x).toBeLessThan(l.heat.x);
  });

  it("keeps the heatmap non-degenerate for tiny containers", () => {
    const l = computeLayout(10, 10, {
      showRowDendrogram: true,
      showColDendrogram: true,
      hasRowDendro: true,
      hasColDendro: true,
      showLabels: true,
    });
    expect(l.heat.w).toBeGreaterThanOrEqual(1);
    expect(l.heat.h).toBeGreaterThanOrEqual(1);
  });
});

describe("clustermap with missing values and Ward linkage", () => {
  const isPermutation = (order: number[], n: number) =>
    order.length === n &&
    new Set(order).size === n &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < n);

  it("measures distance over the cells both rows have, scaled up", () => {
    // Positions 0 and 2 are shared: 0^2 + 2^2 = 4, times 3/2 for the gap.
    expect(euclidean([1, Number.NaN, 3], [1, 2, 5])).toBeCloseTo(
      Math.sqrt(6),
      9,
    );
    expect(Number.isNaN(euclidean([Number.NaN, 1], [2, Number.NaN]))).toBe(
      true,
    );
    // Correlation over the shared positions only.
    expect(
      correlationDistance([1, 2, Number.NaN, 4], [2, 4, 100, 8]),
    ).toBeCloseTo(0, 9);
  });

  it("gives a pair with no shared cell the largest distance", () => {
    const d = distanceMatrix(
      [
        [0, Number.NaN],
        [Number.NaN, 1],
        [3, 4],
      ],
      "euclidean",
    );
    expect(d.flat().every((v) => Number.isFinite(v))).toBe(true);
    expect(d[0]?.[1]).toBe(Math.max(d[0]?.[2] as number, d[1]?.[2] as number));
  });

  it("keeps the leaf order a permutation when a row has NaN", () => {
    // The example from the issue: rows came out as 3, 1, 0, 3, 1, 0.
    const rows = [
      [0, 0],
      [1, 1],
      [Number.NaN, 5],
      [10, 10],
    ];
    for (const linkage of ["average", "complete", "ward"] as const) {
      for (const metric of ["euclidean", "correlation"] as const) {
        const res = clusterVectors(rows, metric, linkage);
        expect(isPermutation(res.order, 4)).toBe(true);
        // A real dendrogram, not the input order the fallback would give.
        expect(res.dendrogram?.merges).toHaveLength(3);
        for (const m of res.dendrogram?.merges ?? []) {
          expect(Number.isFinite(m.height)).toBe(true);
        }
      }
    }
    // Columns of the same matrix: [0, 1, NaN, 10] and [0, 1, 5, 10].
    const cols = clusterVectors(
      [
        [0, 1, Number.NaN, 10],
        [0, 1, 5, 10],
      ],
      "euclidean",
      "average",
    );
    expect(isPermutation(cols.order, 2)).toBe(true);
    expect(cols.dendrogram?.merges).toHaveLength(1);
    // The NaN row is placed by its shared cell: (NaN, 5) is closest to
    // (1, 1), so with average linkage it joins rows 0 and 1 before row 3.
    const avg = clusterVectors(rows, "euclidean", "average");
    const merges = avg.dendrogram?.merges ?? [];
    expect([merges[0]?.left, merges[0]?.right].sort()).toEqual([0, 1]);
    expect([merges[1]?.left, merges[1]?.right]).toContain(2);
  });

  it("computes Ward's method as R's ward.D2 and scipy do", () => {
    const pts = [
      [0, 0],
      [1, 0],
      [0, 3],
      [5, 5],
      [6, 5],
      [10, 0],
    ];
    const res = clusterVectors(pts, "euclidean", "ward");
    const heights = (res.dendrogram?.merges ?? [])
      .map((m) => m.height)
      .sort((a, b) => a - b);
    // hclust(dist(pts), "ward.D2")$height; ward.D gives 3.77, 8.65, 15.96.
    const expected = [1, 1, 3.511885, 7.767453, 12.233833];
    expect(heights).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      expect(heights[i]).toBeCloseTo(expected[i] as number, 5);
    }
  });

  it("z-scores a row over its finite cells and keeps NaN missing", () => {
    const z = zScoreByRow([1, Number.NaN, 3], 1, 3);
    expect(z[0]).toBeCloseTo(-1, 6);
    expect(Number.isNaN(z[1] as number)).toBe(true);
    expect(z[2]).toBeCloseTo(1, 6);
  });
});

describe("clustermap layout from its labels", () => {
  const flags = {
    showRowDendrogram: true,
    showColDendrogram: true,
    hasRowDendro: true,
    hasColDendro: true,
    showLabels: true,
  };

  it("sizes the label gutters from the longest label", () => {
    const none = computeLayout(800, 560, flags);
    const some = computeLayout(800, 560, flags, 60, 50);
    expect(none.labelW).toBe(12);
    expect(some.labelW).toBe(70);
    expect(some.labelH).toBe(60);
    // Capped for very long labels.
    expect(computeLayout(800, 560, flags, 500, 500).labelW).toBe(140);
    expect(computeLayout(800, 560, flags, 500, 500).labelH).toBe(120);
  });

  it("gives the colour bar the gutter it is measured to need", () => {
    const base = computeLayout(800, 560, flags, 60, 50);
    const wide = computeLayout(800, 560, flags, 60, 50, 120);
    // The heatmap gives up the 42 px past the default 78, and the bar moves
    // left with it.
    expect(wide.heat.w).toBe(base.heat.w - 42);
    expect(wide.colorbarX).toBe(base.colorbarX - 42);
  });

  it("scales the label caps with the text size", () => {
    const l = computeLayout(
      800,
      560,
      flags,
      500,
      500,
      78,
      textSizes({ fontSize: 16 }),
    );
    // 140 and 120 px for 11 px labels, times 14.7 / 11.
    expect(l.labelW).toBe(187);
    expect(l.labelH).toBe(160);
  });

  it("puts the colour bar right of the row labels and gives the height back", () => {
    const l = computeLayout(800, 560, flags, 60, 50);
    expect(l.colorbarX).toBeGreaterThanOrEqual(l.heat.x + l.heat.w + l.labelW);
    expect(l.colorbarX + 12).toBeLessThanOrEqual(800);
    // 60 px dendrogram, 12 px padding, 60 px column labels.
    expect(l.heat.h).toBe(560 - 12 - 60 - 60);
  });
});
