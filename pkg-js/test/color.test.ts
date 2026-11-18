import { describe, it, expect } from "vitest";
import {
  viridis,
  rdbu,
  ltc,
  ltcdiv,
  ramp,
  rgbToHex,
  categoricalColors,
} from "../src/core/color.js";
import { OKABE_ITO, PALETTE_20 } from "../src/core/theme.js";

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

  it("names an unknown colormap", () => {
    expect(() => ramp("magma" as never)).toThrow(/unknown colormap "magma"/);
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

describe("categoricalColors", () => {
  it("keeps Okabe-Ito up to 8 categories", () => {
    expect(categoricalColors(OKABE_ITO, 3)).toEqual(OKABE_ITO.slice(0, 3));
    expect(categoricalColors(OKABE_ITO, 8)).toEqual(OKABE_ITO);
    expect(categoricalColors(undefined, 2)).toEqual(OKABE_ITO.slice(0, 2));
    expect(categoricalColors([], 2)).toEqual(OKABE_ITO.slice(0, 2));
  });

  it("switches to the 20-colour palette past 8, so no colour repeats", () => {
    const nine = categoricalColors(OKABE_ITO, 9);
    expect(nine).toEqual(PALETTE_20.slice(0, 9));
    expect(new Set(nine).size).toBe(9);
    expect(new Set(categoricalColors(OKABE_ITO, 20)).size).toBe(20);
    // Past 20 the colours repeat.
    expect(categoricalColors(OKABE_ITO, 21)[20]).toBe(PALETTE_20[0]);
    // The default palette sent from R or Python, in lower case, counts too.
    const sent = OKABE_ITO.map((c) => c.toLowerCase());
    expect(categoricalColors(sent, 9)).toEqual(PALETTE_20.slice(0, 9));
  });

  it("uses a palette the caller set as given", () => {
    expect(categoricalColors(["#a", "#b"], 5)).toEqual([
      "#a",
      "#b",
      "#a",
      "#b",
      "#a",
    ]);
    expect(categoricalColors(["#a"], 0)).toEqual([]);
  });

  it("holds 20 distinct colours in PALETTE_20", () => {
    expect(PALETTE_20).toHaveLength(20);
    expect(new Set(PALETTE_20).size).toBe(20);
  });
});
