/**
 * Pooling for matrix plots: a matrix with more rows or columns than the
 * image has pixels is drawn from block means, one block per pixel.
 */

/**
 * The block of each of `n` rows (or columns) split into `blocks` blocks.
 * Block i holds rows floor(i * n / blocks) up to floor((i + 1) * n /
 * blocks), so the blocks differ in size by one row at most and the last
 * rows fill a block like any other.
 */
function blockIndex(n: number, blocks: number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < blocks; i += 1) {
    const end = Math.floor(((i + 1) * n) / blocks);
    for (let r = Math.floor((i * n) / blocks); r < end; r += 1) out[r] = i;
  }
  return out;
}

/**
 * Mean-pool a row-major `nrows` x `ncols` matrix to `outRows` x `outCols`
 * blocks, one per pixel (or texel) of the image, at most as many as there
 * are rows and columns. The rows and columns are split evenly (see
 * `blockIndex`) and read in `rowOrder` and `colOrder` when given, the order
 * they are drawn in. Each block is the mean of its finite cells, and NaN
 * (missing) when it has none: a missing cell shows only when every cell of
 * its block is missing. A lone outlier row still shows, fainter the more
 * rows share its block, and noise shows as its average, which is what one
 * pixel can show of many cells.
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
  const rowBlock = blockIndex(nrows, outRows);
  const colBlock = blockIndex(ncols, outCols);
  const sum = new Float64Array(outRows * outCols);
  const cnt = new Uint32Array(outRows * outCols);
  for (let r = 0; r < nrows; r += 1) {
    const base = (rowOrder ? (rowOrder[r] as number) : r) * ncols;
    const krow = (rowBlock[r] as number) * outCols;
    for (let c = 0; c < ncols; c += 1) {
      const v = values[base + (colOrder ? (colOrder[c] as number) : c)];
      if (v == null || !Number.isFinite(v)) continue;
      const k = krow + (colBlock[c] as number);
      sum[k] = (sum[k] as number) + v;
      cnt[k] = (cnt[k] as number) + 1;
    }
  }
  const out = new Float32Array(outRows * outCols);
  for (let k = 0; k < out.length; k += 1) {
    const n = cnt[k] as number;
    out[k] = n > 0 ? (sum[k] as number) / n : Number.NaN;
  }
  return out;
}
