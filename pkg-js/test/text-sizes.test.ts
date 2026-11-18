import { describe, expect, it } from "vitest";
import { fitText } from "../src/core/dom.js";
import { textSizes } from "../src/core/theme.js";

describe("textSizes", () => {
  it("gives 11, 13, 14 and 9 px for the default font size", () => {
    expect(textSizes({ fontSize: 12 })).toEqual({
      label: 11,
      axisTitle: 13,
      title: 14,
      small: 9,
    });
  });

  it("scales every role with theme.fontSize", () => {
    expect(textSizes({ fontSize: 24 })).toEqual({
      label: 22,
      axisTitle: 26,
      title: 28,
      small: 18,
    });
    expect(textSizes({ fontSize: 16 }).label).toBeCloseTo(14.7, 5);
  });

  it("reads a size that is not a positive number as 12", () => {
    for (const fontSize of [0, -3, Number.NaN]) {
      expect(textSizes({ fontSize }).label).toBe(11);
    }
  });
});

describe("fitText", () => {
  // Outside a browser, textWidth estimates 0.58 em a character: 5.8 px at
  // 10 px.
  it("keeps text that fits", () => {
    expect(fitText("abcde", 29, 10, "sans-serif")).toBe("abcde");
  });

  it("cuts longer text with an ellipsis to the width", () => {
    expect(fitText("abcdefghij", 35, 10, "sans-serif")).toBe("abcde\u2026");
  });

  it("drops a space left before the ellipsis", () => {
    expect(fitText("ab cdefgh", 23.2, 10, "sans-serif")).toBe("ab\u2026");
  });

  it("returns nothing when not even the ellipsis fits", () => {
    expect(fitText("abc", 3, 10, "sans-serif")).toBe("");
  });
});
