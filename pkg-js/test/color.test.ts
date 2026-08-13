import { describe, it, expect } from "vitest";
import { viridis, rdbu, ltc, ltcdiv, ramp, rgbToHex } from "../src/core/color.js";

const RAMP_FNS = [
  ["viridis", viridis],
  ["rdbu", rdbu],
  ["ltc", ltc],
  ["ltcdiv", ltcdiv],
] as const;

describe("ramps guard against a non-finite input", () => {
  // Regression: a NaN t indexed the stop array with NaN, handed back undefined
  // and threw on the next property read, blanking whichever view was mid
  // render. It reached the ramp whenever a caller's colour mode said
  // "continuous" one render before the numeric column arrived.
  it("returns the low stop rather than throwing", () => {
    for (const [name, fn] of RAMP_FNS) {
      expect(() => fn(Number.NaN), name).not.toThrow();
      expect(fn(Number.NaN), name).toEqual(fn(0));
      expect(fn(Number.POSITIVE_INFINITY), name).toEqual(fn(0));
      expect(fn(Number.NEGATIVE_INFINITY), name).toEqual(fn(0));
    }
  });

  it("guards the string-keyed ramp() accessor too", () => {
    expect(() => ramp("ltc")(Number.NaN)).not.toThrow();
    expect(ramp("ltc")(Number.NaN)).toBe(ramp("ltc")(0));
  });
});

describe("ramps still behave normally", () => {
  it("clamps ordinary out-of-range values to the ends", () => {
    for (const [name, fn] of RAMP_FNS) {
      expect(fn(-1), name).toEqual(fn(0));
      expect(fn(2), name).toEqual(fn(1));
    }
  });

  it("moves through the ramp rather than returning one flat colour", () => {
    for (const [name, fn] of RAMP_FNS) {
      expect(rgbToHex(fn(0)), name).not.toBe(rgbToHex(fn(1)));
      expect(rgbToHex(fn(0.5)), name).not.toBe(rgbToHex(fn(0)));
    }
  });

  it("returns three channels in 0-255", () => {
    for (const [name, fn] of RAMP_FNS) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const c = fn(t);
        expect(c.length, name).toBe(3);
        for (const v of c) {
          expect(Number.isFinite(v), name).toBe(true);
          expect(v >= 0 && v <= 255, `${name} @ ${t}`).toBe(true);
        }
      }
    }
  });
});
