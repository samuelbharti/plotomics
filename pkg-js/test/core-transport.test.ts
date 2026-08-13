import { describe, it, expect } from "vitest";
import { decodeColumns, type BufferSchema } from "../src/core/transport.js";

describe("decodeColumns", () => {
  it("decodes contiguous float32 + int32 columns", () => {
    // Two columns: x = float32[3], cat = int32[3]
    const x = new Float32Array([1.5, -2.25, 3.0]);
    const cat = new Int32Array([0, 1, 0]);
    const buf = new ArrayBuffer(x.byteLength + cat.byteLength);
    new Uint8Array(buf).set(new Uint8Array(x.buffer), 0);
    new Uint8Array(buf).set(new Uint8Array(cat.buffer), x.byteLength);

    const schema: BufferSchema = {
      columns: [
        { name: "x", dtype: "float32", length: 3, byteOffset: 0 },
        { name: "cat", dtype: "int32", length: 3, byteOffset: x.byteLength },
      ],
    };

    const cols = decodeColumns(buf, schema);
    expect(Array.from(cols.x as Float32Array)).toEqual([1.5, -2.25, 3.0]);
    expect(Array.from(cols.cat as Int32Array)).toEqual([0, 1, 0]);
  });

  it("decodes through a DataView with a non-zero base offset", () => {
    const values = new Float64Array([10, 20, 30]);
    const outer = new ArrayBuffer(8 + values.byteLength);
    new Uint8Array(outer).set(new Uint8Array(values.buffer), 8);
    const view = new DataView(outer, 8); // base offset 8 bytes

    const cols = decodeColumns(view, {
      columns: [{ name: "v", dtype: "float64", length: 3, byteOffset: 0 }],
    });
    expect(Array.from(cols.v as Float64Array)).toEqual([10, 20, 30]);
  });

  it("throws when a column reads past the buffer", () => {
    const buf = new ArrayBuffer(8);
    expect(() =>
      decodeColumns(buf, {
        columns: [{ name: "x", dtype: "float32", length: 100, byteOffset: 0 }],
      }),
    ).toThrow(/exceeds buffer/);
  });
});
