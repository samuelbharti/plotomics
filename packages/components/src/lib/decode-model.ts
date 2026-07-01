import { decodeColumns, type BufferSchema, type BiovizData } from "@bioviz/core";

/**
 * Normalizes whatever a host model carries into a single {@link BiovizData}.
 *
 * Two transports converge here:
 *  - Binary (Python/anywidget): a `buffer` (DataView) + `schema` describing
 *    packed numeric columns, decoded zero-copy into typed arrays. Optional
 *    `data.columns` carries string columns / overrides; `meta` carries scalars.
 *  - JSON (R/htmlwidgets): `data.columns` is already plain arrays.
 */
export function decodeModelData(input: {
  buffer?: ArrayBuffer | DataView | Uint8Array | null;
  schema?: BufferSchema | null;
  data?: { columns?: Record<string, unknown>; meta?: Record<string, unknown> } | null;
}): BiovizData {
  const columns: BiovizData["columns"] = {};

  if (input.buffer && input.schema && input.schema.columns?.length) {
    Object.assign(columns, decodeColumns(input.buffer, input.schema));
  }

  // JSON columns (string columns, or the whole dataset on the R path) merge in
  // and win over nothing — binary numeric columns and JSON columns coexist.
  const jsonCols = input.data?.columns;
  if (jsonCols) {
    for (const [k, v] of Object.entries(jsonCols)) {
      if (Array.isArray(v)) columns[k] = v as number[] | string[];
    }
  }

  return { columns, meta: input.data?.meta ?? {} };
}
