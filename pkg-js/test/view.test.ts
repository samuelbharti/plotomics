import { describe, expect, it } from "vitest";
import {
  MIN_VIEW_SHARE,
  resetButtonBox,
  resetButtonSize,
} from "../src/core/view.js";

describe("reset button", () => {
  it("grows with the text from 20 to 30 px", () => {
    expect(resetButtonSize({ fontSize: 12 })).toBe(22);
    expect(resetButtonSize({ fontSize: 8 })).toBe(20);
    expect(resetButtonSize({ fontSize: 20 })).toBe(30);
    expect(resetButtonSize({ fontSize: 48 })).toBe(30);
  });

  it("sits in the top right corner of the plot area, 4 px in", () => {
    const box = resetButtonBox(
      { left: 60, top: 16, width: 500, height: 400 },
      22,
    );
    expect(box).toEqual({ left: 534, top: 20, width: 22, height: 22 });
  });

  it("is left out of a plot area too small to hold it", () => {
    expect(
      resetButtonBox({ left: 0, top: 0, width: 29, height: 400 }, 22),
    ).toBeNull();
    expect(
      resetButtonBox({ left: 0, top: 0, width: 400, height: 29 }, 22),
    ).toBeNull();
    expect(
      resetButtonBox({ left: 0, top: 0, width: 30, height: 30 }, 22),
    ).not.toBeNull();
  });

  it("stops zooming in at 1/10,000 of the home view", () => {
    expect(MIN_VIEW_SHARE).toBe(1e-4);
  });
});
