import { describe, expect, it } from "vitest";
import { goslingPadding } from "../src/components/gosling-spec.js";
import {
  DEFAULT_PADDING,
  defaultTheme,
  darkTheme,
  resolveTheme,
  themePadding,
} from "../src/core/theme.js";

const all = (v: number) => ({ top: v, right: v, bottom: v, left: v });

describe("themePadding", () => {
  it("gives 10 px on each side for the default themes", () => {
    expect(DEFAULT_PADDING).toBe(10);
    expect(themePadding(defaultTheme)).toEqual(all(10));
    expect(themePadding(darkTheme)).toEqual(all(10));
    expect(themePadding({})).toEqual(all(10));
  });

  it("sets every side from a number", () => {
    expect(themePadding({ padding: 0 })).toEqual(all(0));
    expect(themePadding({ padding: 16 })).toEqual(all(16));
    expect(themePadding({ padding: 2.5 })).toEqual(all(2.5));
  });

  it("sets each side from an object, a side left out taking the default", () => {
    expect(
      themePadding({ padding: { top: 4, right: 16, bottom: 4, left: 16 } }),
    ).toEqual({ top: 4, right: 16, bottom: 4, left: 16 });
    expect(themePadding({ padding: { left: 30 } })).toEqual({
      top: 10,
      right: 10,
      bottom: 10,
      left: 30,
    });
  });

  it("reads a value that is not a number of 0 or more as the default", () => {
    for (const padding of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "16",
      null,
      [1, 2, 3, 4],
      true,
    ]) {
      expect(themePadding({ padding: padding as never })).toEqual(all(10));
    }
    expect(
      themePadding({
        padding: { top: -4, right: Number.NaN, bottom: "8", left: 20 } as never,
      }),
    ).toEqual({ top: 10, right: 10, bottom: 10, left: 20 });
  });

  it("comes through resolveTheme", () => {
    expect(themePadding(resolveTheme({ padding: 24 }))).toEqual(all(24));
    expect(themePadding(resolveTheme({ fontSize: 16 }))).toEqual(all(10));
  });
});

describe("goslingPadding", () => {
  it("gives Gosling the rest of its 60 px after the host padding", () => {
    expect(goslingPadding(undefined, 10)).toBe(50);
    expect(goslingPadding(undefined, 0)).toBe(60);
    expect(goslingPadding(undefined, 80)).toBe(0);
  });

  it("keeps a padding that is set", () => {
    expect(goslingPadding(30, 10)).toBe(30);
    expect(goslingPadding(0, 10)).toBe(0);
  });
});
