/**
 * Pure data + hierarchical-clustering helpers for the clustered heatmap.
 *
 * Everything here is GPU-free and deterministic so it can be unit-tested
 * without a browser (see test/clustermap.test.ts). The factory in
 * `clustermap.ts` wires these into canvas + SVG rendering.
 *
 * Clustering uses agglomerative nesting (AGNES) from `ml-hclust`. That
 * implementation materializes a full n×n distance matrix and merges the two
 * closest clusters each step, so it is O(n^2) memory and ~O(n^3) time. We
 * therefore only auto-cluster small-to-moderate axes (<= MAX_CLUSTER_N); larger
 * inputs should pass a precomputed `order` (or `linkage`) through `meta`.
 */
import { agnes, type AgglomerationMethod, type Cluster } from "ml-hclust";

/** Above this many rows/cols, refuse to auto-cluster (document precomputed path). */
export const MAX_CLUSTER_N = 2000;

export type Metric = "euclidean" | "correlation";
export type Linkage = "average" | "complete" | "ward";

/**
 * Serializable dendrogram. `merges[k]` describes the k-th agglomeration and
 * refers to earlier nodes by index: leaves are `0..n-1`, internal node k is
 * `n + k`. `left`/`right` are those references, `height` is the merge
 * dissimilarity. `order` is the leaf sequence to lay branches out without
 * crossings. This is what we render and what a host may precompute and pass in.
 */
export interface Dendrogram {
  /** Number of leaves (rows or columns). */
  n: number;
  merges: { left: number; right: number; height: number }[];
  /** Leaf indices in dendrogram (no-crossing) order. */
  order: number[];
}

/** Identity order 0..n-1 (used when clustering is disabled or skipped). */
export function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Read cell (r, c) from a row-major numeric buffer of shape nrows × ncols. */
export function cellAt(
  values: ArrayLike<number>,
  ncols: number,
  r: number,
  c: number,
): number {
  return values[r * ncols + c] as number;
}

/**
 * Extract rows as vectors (each of length ncols) for row clustering, or
 * columns as vectors (each of length nrows) for column clustering.
 */
export function toRowVectors(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
): number[][] {
  const out: number[][] = new Array(nrows);
  for (let r = 0; r < nrows; r += 1) {
    const v = new Array<number>(ncols);
    const base = r * ncols;
    for (let c = 0; c < ncols; c += 1) v[c] = values[base + c] as number;
    out[r] = v;
  }
  return out;
}

export function toColVectors(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
): number[][] {
  const out: number[][] = new Array(ncols);
  for (let c = 0; c < ncols; c += 1) {
    const v = new Array<number>(nrows);
    for (let r = 0; r < nrows; r += 1) v[r] = values[r * ncols + c] as number;
    out[c] = v;
  }
  return out;
}

/**
 * Euclidean distance between two equal-length vectors, over the positions
 * where both are finite. As in R's `dist()`, the sum is scaled up by the
 * share of positions used, so a missing cell does not pull two rows
 * together. Returns NaN when no position is finite in both.
 */
export function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let s = 0;
  let m = 0;
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    // d - d is 0 for a finite d and NaN when either value is NaN or
    // infinite; this test is several times faster than Number.isFinite.
    if (d - d !== 0) continue;
    s += d * d;
    m += 1;
  }
  if (m === 0) return Number.NaN;
  return Math.sqrt((s * n) / m);
}

/**
 * Correlation distance: 1 - Pearson r, over the positions where both vectors
 * are finite. Returns 1 (max dissimilarity for the clustering) when either
 * vector is constant there, and NaN when fewer than two positions are finite
 * in both.
 */
export function correlationDistance(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  const n = a.length;
  let m = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    // NaN unless both are finite (see euclidean).
    if (x - x + (y - y) !== 0) continue;
    ma += x;
    mb += y;
    m += 1;
  }
  if (m < 2) return n === 0 ? 1 : Number.NaN;
  ma /= m;
  mb /= m;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x - x + (y - y) !== 0) continue;
    const xa = x - ma;
    const xb = y - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  if (denom === 0) return 1;
  const r = num / denom;
  return 1 - r;
}

/**
 * Pairwise distances between `vectors`. A pair with no finite overlap gets
 * the largest finite distance in the matrix, so the clustering never sees a
 * NaN. (With average linkage such a row joins last; Ward's method can still
 * merge it earlier.)
 */
export function distanceMatrix(
  vectors: number[][],
  metric: Metric,
): number[][] {
  const n = vectors.length;
  const fn = metric === "correlation" ? correlationDistance : euclidean;
  const d: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const v = fn(vectors[i] as number[], vectors[j] as number[]);
      (d[i] as number[])[j] = v;
      (d[j] as number[])[i] = v;
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  const fill = max > 0 ? max : 1;
  for (let i = 0; i < n; i += 1) {
    const row = d[i] as number[];
    for (let j = 0; j < n; j += 1) {
      if (i !== j && !Number.isFinite(row[j] as number)) row[j] = fill;
    }
  }
  return d;
}

// "ward" is Ward's method as scipy and R's ward.D2 compute it, which is
// ml-hclust's "ward2". Its "ward" works on unsquared distances (R's ward.D).
const METHOD_MAP: Record<Linkage, AgglomerationMethod> = {
  average: "average",
  complete: "complete",
  ward: "ward2",
};

/**
 * Flatten an `ml-hclust` {@link Cluster} tree into a serializable
 * {@link Dendrogram}. Leaves keep their original index; internal nodes are
 * assigned ids `n, n+1, ...` in post-order so `left`/`right` always reference
 * an already-emitted node.
 */
export function clusterToDendrogram(root: Cluster, n: number): Dendrogram {
  const merges: Dendrogram["merges"] = [];
  let nextInternal = n;
  const idOf = new Map<Cluster, number>();

  // Post-order: children before parents, so references resolve.
  function visit(node: Cluster): number {
    if (node.isLeaf || node.children.length === 0) {
      idOf.set(node, node.index);
      return node.index;
    }
    // AGNES is strictly binary; guard anyway by folding extra children left.
    let leftId = visit(node.children[0] as Cluster);
    for (let k = 1; k < node.children.length; k += 1) {
      const rightId = visit(node.children[k] as Cluster);
      const id = nextInternal;
      nextInternal += 1;
      merges.push({ left: leftId, right: rightId, height: node.height });
      leftId = id;
    }
    idOf.set(node, leftId);
    return leftId;
  }
  visit(root);

  return { n, merges, order: root.indices() };
}

export interface ClusterResult {
  order: number[];
  dendrogram: Dendrogram | null;
}

/**
 * Cluster a set of `vectors` and return their leaf order + dendrogram.
 * Returns identity order (no dendrogram) when there are fewer than two
 * vectors, or when `n > MAX_CLUSTER_N` (too expensive — caller should pass a
 * precomputed order/linkage instead).
 */
export function clusterVectors(
  vectors: number[][],
  metric: Metric,
  linkage: Linkage,
): ClusterResult {
  const n = vectors.length;
  if (n < 2) return { order: identityOrder(n), dendrogram: null };
  if (n > MAX_CLUSTER_N) return { order: identityOrder(n), dendrogram: null };

  const root = agnes(distanceMatrix(vectors, metric), {
    method: METHOD_MAP[linkage],
    isDistanceMatrix: true,
  });
  const order = root.indices();
  // A leaf order that is not a permutation would drop and repeat rows on
  // screen; keep the input order then.
  if (!isValidOrder(order, n)) {
    return { order: identityOrder(n), dendrogram: null };
  }
  return { order, dendrogram: clusterToDendrogram(root, n) };
}

/**
 * Validate + normalize a precomputed dendrogram supplied via meta. Accepts our
 * {@link Dendrogram} shape or a bare `number[]` leaf order. Returns null if the
 * value is unusable (wrong length, out-of-range indices) so callers fall back
 * to clustering / identity order rather than rendering garbage.
 */
export function normalizePrecomputed(
  value: unknown,
  n: number,
): ClusterResult | null {
  // Bare leaf order.
  if (
    Array.isArray(value) &&
    (value.length === 0 || typeof value[0] === "number")
  ) {
    const order = value as number[];
    if (!isValidOrder(order, n)) return null;
    return { order, dendrogram: null };
  }
  if (value && typeof value === "object" && "order" in value) {
    const d = value as Partial<Dendrogram>;
    if (!Array.isArray(d.order) || !isValidOrder(d.order, n)) return null;
    const merges = Array.isArray(d.merges) ? d.merges : [];
    return {
      order: d.order,
      dendrogram: { n, order: d.order, merges },
    };
  }
  return null;
}

function isValidOrder(order: number[], n: number): boolean {
  if (order.length !== n) return false;
  const seen = new Uint8Array(n);
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen[i]) return false;
    seen[i] = 1;
  }
  return true;
}

/**
 * Per-row z-score standardization: subtract the row mean and divide by the row
 * standard deviation (population), both over the finite cells of the row, so
 * one missing cell does not turn the row into NaN. Missing cells stay NaN and
 * constant rows map to zeros. Returns a new Float32Array; the input is
 * untouched.
 */
export function zScoreByRow(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
): Float32Array {
  const out = new Float32Array(nrows * ncols);
  for (let r = 0; r < nrows; r += 1) {
    const base = r * ncols;
    let n = 0;
    let mean = 0;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) continue;
      n += 1;
      mean += v;
    }
    mean /= n || 1;
    let variance = 0;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) continue;
      variance += (v - mean) * (v - mean);
    }
    variance /= n || 1;
    const sd = Math.sqrt(variance);
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + c] as number;
      if (!Number.isFinite(v)) out[base + c] = Number.NaN;
      else out[base + c] = sd === 0 ? 0 : (v - mean) / sd;
    }
  }
  return out;
}

/** Finite [min, max] over a numeric buffer; falls back to [0, 1] if empty. */
export function dataExtent(values: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

/** Symmetric extent around 0 (for diverging maps): [-m, m], m = max|v|. */
export function symmetricExtent(values: ArrayLike<number>): [number, number] {
  const [lo, hi] = dataExtent(values);
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  return [-m, m];
}

/**
 * Pool a row-major matrix, in the drawn row and column order, to `outRows` x
 * `outCols` blocks, one per pixel of the image. Block i spans the drawn rows
 * from floor(i * n / outRows) up to floor((i + 1) * n / outRows), so blocks
 * differ by one row at most, and columns likewise; `outRows` and `outCols`
 * are at most the row and column counts. Each block keeps the cell farthest
 * from the mean of its block, so a lone outlier row still shows: a block mean
 * would fade it by the block size, and a block maximum would hide a low one.
 * Missing cells (NaN) are left out, and a block with no other cell stays NaN.
 */
export function poolBlocks(
  values: ArrayLike<number>,
  ncols: number,
  rowOrder: ArrayLike<number>,
  colOrder: ArrayLike<number>,
  outRows: number,
  outCols: number,
): Float32Array {
  const nr = rowOrder.length;
  const nc = colOrder.length;
  const out = new Float32Array(outRows * outCols).fill(Number.NaN);
  // Block j holds the drawn columns from colEnd[j] up to colEnd[j + 1].
  const colEnd = new Int32Array(outCols + 1);
  for (let j = 0; j <= outCols; j += 1) {
    colEnd[j] = Math.floor((j * nc) / outCols);
  }
  const sum = new Float64Array(outCols);
  const cnt = new Uint32Array(outCols);
  for (let i = 0; i < outRows; i += 1) {
    const r0 = Math.floor((i * nr) / outRows);
    const r1 = Math.floor(((i + 1) * nr) / outRows);
    sum.fill(0);
    cnt.fill(0);
    for (let r = r0; r < r1; r += 1) {
      const base = (rowOrder[r] as number) * ncols;
      for (let j = 0; j < outCols; j += 1) {
        const end = colEnd[j + 1] as number;
        for (let c = colEnd[j] as number; c < end; c += 1) {
          const v = values[base + (colOrder[c] as number)] as number;
          if (!Number.isFinite(v)) continue;
          sum[j] = (sum[j] as number) + v;
          cnt[j] = (cnt[j] as number) + 1;
        }
      }
    }
    const row = i * outCols;
    for (let r = r0; r < r1; r += 1) {
      const base = (rowOrder[r] as number) * ncols;
      for (let j = 0; j < outCols; j += 1) {
        const mean = (sum[j] as number) / (cnt[j] as number);
        const end = colEnd[j + 1] as number;
        for (let c = colEnd[j] as number; c < end; c += 1) {
          const v = values[base + (colOrder[c] as number)] as number;
          if (!Number.isFinite(v)) continue;
          const kept = out[row + j] as number;
          if (
            Number.isNaN(kept) ||
            Math.abs(v - mean) > Math.abs(kept - mean)
          ) {
            out[row + j] = v;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Compute pixel y-position of each dendrogram node for a horizontal (column)
 * dendrogram drawn above the heatmap, or the transposed layout for rows. This
 * is layout-only math kept pure so it is testable.
 *
 * Returns, for every node id (leaves 0..n-1 then internal n..2n-2), its
 * position along the *leaf* axis (in leaf-slot units, 0..n-1) and its height
 * (dissimilarity). Leaves sit at their slot in `order`; internal nodes sit at
 * the mean of their children's positions.
 */
export function dendrogramPositions(d: Dendrogram): {
  pos: number[];
  height: number[];
} {
  const total = d.n + d.merges.length;
  const pos = new Array<number>(total).fill(0);
  const height = new Array<number>(total).fill(0);
  // Leaf slot = index of the leaf within the ordered layout.
  const slotOf = new Array<number>(d.n);
  for (let slot = 0; slot < d.order.length; slot += 1) {
    slotOf[d.order[slot] as number] = slot;
  }
  for (let leaf = 0; leaf < d.n; leaf += 1) {
    pos[leaf] = slotOf[leaf] as number;
    height[leaf] = 0;
  }
  for (let k = 0; k < d.merges.length; k += 1) {
    const m = d.merges[k]!;
    const id = d.n + k;
    pos[id] = ((pos[m.left] as number) + (pos[m.right] as number)) / 2;
    height[id] = m.height;
  }
  return { pos, height };
}
