import { describe, it, expect } from "vitest";
import {
  isValidSpec,
  embedOptions,
  mergeGoslingOptions,
  defaultGoslingOptions,
} from "../src/components/gosling-spec.js";

describe("gosling helpers", () => {
  it("accepts specs with a recognised composition key", () => {
    expect(isValidSpec({ tracks: [] })).toBe(true);
    expect(isValidSpec({ views: [] })).toBe(true);
    expect(isValidSpec({ alignment: "stack", tracks: [] })).toBe(true);
  });

  it("rejects non-spec values", () => {
    expect(isValidSpec(null)).toBe(false);
    expect(isValidSpec(undefined)).toBe(false);
    expect(isValidSpec("tracks")).toBe(false);
    expect(isValidSpec([{ tracks: [] }])).toBe(false);
    expect(isValidSpec({})).toBe(false);
    expect(isValidSpec({ title: "no tracks here" })).toBe(false);
  });

  it("builds embed options dropping undefined values", () => {
    expect(embedOptions({ padding: undefined, theme: undefined })).toEqual({});
    expect(embedOptions({ padding: 30, theme: undefined })).toEqual({
      padding: 30,
    });
    expect(embedOptions({ padding: 0, theme: "dark" })).toEqual({
      padding: 0,
      theme: "dark",
    });
  });

  it("merges options, replacing spec wholesale", () => {
    const base = { ...defaultGoslingOptions, spec: { tracks: [1] } };
    const merged = mergeGoslingOptions(base, {
      spec: { tracks: [2] },
    });
    expect(merged.spec).toEqual({ tracks: [2] });
    // absent keys are preserved
    expect(mergeGoslingOptions(base, { padding: 5 }).spec).toBe(base.spec);
    // no patch -> shallow copy
    expect(mergeGoslingOptions(base)).toEqual(base);
    expect(mergeGoslingOptions(base)).not.toBe(base);
  });
});
