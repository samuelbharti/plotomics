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

/** Euclidean distance between two equal-length vectors. */
export function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Correlation distance: 1 - Pearson r. Returns 1 (max dissimilarity for the
 * clustering) when either vector is constant (undefined correlation).
 */
export function correlationDistance(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  const n = a.length;
  if (n === 0) return 1;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = (a[i] as number) - ma;
    const xb = (b[i] as number) - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  if (denom === 0) return 1;
  const r = num / denom;
  return 1 - r;
}

const METHOD_MAP: Record<Linkage, AgglomerationMethod> = {
  average: "average",
  complete: "complete",
  ward: "ward",
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

  const distanceFunction =
    metric === "correlation" ? correlationDistance : euclidean;
  const root = agnes(vectors, {
    method: METHOD_MAP[linkage],
    distanceFunction,
  });
  return { order: root.indices(), dendrogram: clusterToDendrogram(root, n) };
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
  if (Array.isArray(value) && (value.length === 0 || typeof value[0] === "number")) {
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
 * standard deviation (population). Constant rows map to all-zeros. Returns a
 * new Float32Array; the input is untouched.
 */
export function zScoreByRow(
  values: ArrayLike<number>,
  nrows: number,
  ncols: number,
): Float32Array {
  const out = new Float32Array(nrows * ncols);
  for (let r = 0; r < nrows; r += 1) {
    const base = r * ncols;
    let mean = 0;
    for (let c = 0; c < ncols; c += 1) mean += values[base + c] as number;
    mean /= ncols;
    let variance = 0;
    for (let c = 0; c < ncols; c += 1) {
      const d = (values[base + c] as number) - mean;
      variance += d * d;
    }
    variance /= ncols;
    const sd = Math.sqrt(variance);
    if (sd === 0) {
      // row stays zero-filled
      continue;
    }
    for (let c = 0; c < ncols; c += 1) {
      out[base + c] = ((values[base + c] as number) - mean) / sd;
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
 * Compute pixel y-position of each dendrogram node for a horizontal (column)
 * dendrogram drawn above the heatmap, or the transposed layout for rows. This
 * is layout-only math kept pure so it is testable.
 *
 * Returns, for every node id (leaves 0..n-1 then internal n..2n-2), its
 * position along the *leaf* axis (in leaf-slot units, 0..n-1) and its height
 * (dissimilarity). Leaves sit at their slot in `order`; internal nodes sit at
 * the mean of their children's positions.
 */
export function dendrogramPositions(
  d: Dendrogram,
): { pos: number[]; height: number[] } {
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
