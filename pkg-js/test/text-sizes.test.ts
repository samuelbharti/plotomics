import { describe, expect, it } from "vitest";
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
