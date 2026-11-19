/**
 * Pooling for matrix plots: a matrix with more rows or columns than the
 * image has pixels, or than a texture may have, is drawn from block means.
 */

/** The block each of `n` rows (or columns) falls in, and how many there are. */
export interface Blocks {
  count: number;
  index: Int32Array;
}

/**
 * `n` rows (or columns) split into `count` blocks. Block i holds rows
 * floor(i * n / count) up to floor((i + 1) * n / count), so the blocks
 * differ in size by one row at most and the last rows fill a block like any
 * other. Drawn evenly over the image, a block sits less than a row from its
 * rows.
 */
export function evenBlocks(n: number, count: number): Blocks {
  const index = new Int32Array(n);
  for (let i = 0; i < count; i += 1) {
    const end = Math.floor(((i + 1) * n) / count);
    for (let r = Math.floor((i * n) / count); r < end; r += 1) index[r] = i;
  }
  return { count, index };
}

/**
 * `n` rows (or columns) in blocks of `size` from row 0, the last one short
 * when `size` does not divide `n`. Drawn `size` rows high, each block sits
 * exactly on its rows.
 */
export function alignedBlocks(n: number, size: number): Blocks {
  const index = new Int32Array(n);
  for (let r = 0; r < n; r += 1) index[r] = Math.floor(r / size);
  return { count: Math.ceil(n / size), index };
}

/**
 * Mean-pool a row-major `nrows` x `ncols` matrix into the given row and
 * column blocks, reading the rows and columns in `rowOrder` and `colOrder`
 * when given, the order they are drawn in. Each block is the mean of its
 * finite cells, and NaN (missing) when it has none: a missing cell shows
 * only when every cell of its block is missing. A lone outlier row still
 * shows, fainter the more rows share its block, and noise shows as its
 * average, which is what one pixel can show of many cells.
 */
export function poolBlocks(
  values: ArrayLike<number | null>,
  nrows: number,
  ncols: number,
  rows: Blocks,
  cols: Blocks,
  rowOrder?: ArrayLike<number>,
  colOrder?: ArrayLike<number>,
): Float32Array {
  const size = rows.count * cols.count;
  const sum = new Float64Array(size);
  const cnt = new Uint32Array(size);
  for (let r = 0; r < nrows; r += 1) {
    const base = (rowOrder ? (rowOrder[r] as number) : r) * ncols;
    const krow = (rows.index[r] as number) * cols.count;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + (colOrder ? (colOrder[c] as number) : c)];
      if (v == null || !Number.isFinite(v)) continue;
      const k = krow + (cols.index[c] as number);
      sum[k] = (sum[k] as number) + v;
      cnt[k] = (cnt[k] as number) + 1;
    }
  }
  const out = new Float32Array(size);
  for (let k = 0; k < size; k += 1) {
    const n = cnt[k] as number;
    out[k] = n > 0 ? (sum[k] as number) / n : Number.NaN;
  }
  return out;
}

/**
 * Mean-pool a row-major matrix to `outRows` x `outCols` even blocks (see
 * {@link evenBlocks}), one per pixel of the image, at most as many as there
 * are rows and columns. See {@link poolBlocks} for the rest.
 */
export function poolMean(
  values: ArrayLike<number | null>,
  nrows: number,
  ncols: number,
  outRows: number,
  outCols: number,
  rowOrder?: ArrayLike<number>,
  colOrder?: ArrayLike<number>,
): Float32Array {
  return poolBlocks(
    values,
    nrows,
    ncols,
    evenBlocks(nrows, outRows),
    evenBlocks(ncols, outCols),
    rowOrder,
    colOrder,
  );
}
