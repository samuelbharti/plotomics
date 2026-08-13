import { describe, it, expect } from "vitest";
import {
  MAX_CLUSTER_N,
  cellAt,
  clusterVectors,
  correlationDistance,
  dataExtent,
  dendrogramPositions,
  euclidean,
  identityOrder,
  normalizePrecomputed,
  symmetricExtent,
  toColVectors,
  toRowVectors,
  zScoreByRow,
} from "../src/components/clustermap-cluster.js";
import { computeLayout } from "../src/components/clustermap.js";

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
    const { order, dendrogram } = clusterVectors(vectors, "euclidean", "average");
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
