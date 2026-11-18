import { describe, expect, it } from "vitest";
import { dropsOptionKeys } from "../src/lib/rerender.js";

describe("dropsOptionKeys", () => {
  it("is false when every key is still sent, whatever the values", () => {
    expect(dropsOptionKeys({ a: 1, b: "x" }, { a: 2, b: "y", c: 3 })).toBe(
      false,
    );
    expect(dropsOptionKeys({}, { a: 1 })).toBe(false);
    expect(dropsOptionKeys({ a: [1, 2] }, { a: [3] })).toBe(false);
    expect(dropsOptionKeys({ a: 1 }, { a: null })).toBe(false);
  });

  it("is true when a key is left out", () => {
    expect(
      dropsOptionKeys(
        { vmin: -2, colormap: "viridis" },
        { colormap: "viridis" },
      ),
    ).toBe(true);
    expect(dropsOptionKeys({ a: 1 }, {})).toBe(true);
    expect(dropsOptionKeys({ a: 1 }, undefined)).toBe(true);
  });

  it("looks inside nested objects such as theme and colors", () => {
    expect(
      dropsOptionKeys(
        { theme: { background: "#000", foreground: "#fff" } },
        { theme: { background: "#000" } },
      ),
    ).toBe(true);
    expect(dropsOptionKeys({ theme: { background: "#000" } }, {})).toBe(true);
    expect(
      dropsOptionKeys(
        { colors: { up: "red" } },
        { colors: { up: "blue", down: "x" } },
      ),
    ).toBe(false);
  });

  it("ignores keys that were undefined before", () => {
    expect(dropsOptionKeys({ a: undefined, b: 1 }, { b: 1 })).toBe(false);
  });
});
