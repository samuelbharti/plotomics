/**
 * Binary columnar transport.
 *
 * Large datasets are the whole point of this project, so the Python wrapper
 * does not ship millions of numbers as JSON. Instead it packs numeric columns
 * contiguously into a single ArrayBuffer and sends a tiny JSON schema next to
 * it (anywidget delivers the bytes as a DataView). This module decodes that
 * buffer back into typed arrays with no per-element JS work.
 *
 * The R/htmlwidgets path uses plain JSON arrays (jsonlite), which arrive as
 * `number[]` and are accepted everywhere a `Column` is. Both paths converge on
 * the same {@link BiovizData} shape.
 */

export type Dtype =
  | "float32"
  | "float64"
  | "int32"
  | "uint32"
  | "int16"
  | "uint16"
  | "int8"
  | "uint8";

export interface ColumnSpec {
  name: string;
  dtype: Dtype;
  /** Number of elements. */
  length: number;
  /** Byte offset into the buffer where this column begins. */
  byteOffset: number;
}

export interface BufferSchema {
  columns: ColumnSpec[];
}

type TypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

const CTORS: Record<Dtype, { ctor: new (b: ArrayBuffer, o: number, l: number) => TypedArray; bytes: number }> = {
  float32: { ctor: Float32Array, bytes: 4 },
  float64: { ctor: Float64Array, bytes: 8 },
  int32: { ctor: Int32Array, bytes: 4 },
  uint32: { ctor: Uint32Array, bytes: 4 },
  int16: { ctor: Int16Array, bytes: 2 },
  uint16: { ctor: Uint16Array, bytes: 2 },
  int8: { ctor: Int8Array, bytes: 1 },
  uint8: { ctor: Uint8Array, bytes: 1 },
};

function toArrayBuffer(
  buffer: ArrayBuffer | DataView | Uint8Array,
): { buf: ArrayBuffer; base: number } {
  if (buffer instanceof ArrayBuffer) return { buf: buffer, base: 0 };
  // DataView (anywidget) or Uint8Array view onto a possibly larger buffer.
  return { buf: buffer.buffer as ArrayBuffer, base: buffer.byteOffset };
}

/**
 * Decode a packed buffer into named typed arrays according to `schema`.
 * Throws if a column would read out of bounds, since silently truncating
 * scientific data is worse than failing loudly.
 */
export function decodeColumns(
  buffer: ArrayBuffer | DataView | Uint8Array,
  schema: BufferSchema,
): Record<string, TypedArray> {
  const { buf, base } = toArrayBuffer(buffer);
  const out: Record<string, TypedArray> = {};
  for (const spec of schema.columns) {
    const { ctor, bytes } = CTORS[spec.dtype];
    const start = base + spec.byteOffset;
    const needed = spec.length * bytes;
    if (start + needed > buf.byteLength) {
      throw new RangeError(
        `Column "${spec.name}" (${spec.dtype}[${spec.length}]) at byte ${spec.byteOffset} exceeds buffer of ${buf.byteLength} bytes`,
      );
    }
    if (start % bytes !== 0) {
      // Typed arrays require aligned offsets; copy into an aligned buffer.
      const slice = buf.slice(start, start + needed);
      out[spec.name] = new ctor(slice, 0, spec.length);
    } else {
      out[spec.name] = new ctor(buf, start, spec.length);
    }
  }
  return out;
}
