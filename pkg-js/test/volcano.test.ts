import { describe, it, expect } from "vitest";
import {
  classify,
  paddedExtent,
  symmetricExtent,
  niceTicks,
} from "../src/components/volcano.js";

describe("volcano helpers", () => {
  it("classifies up / down / NS by thresholds", () => {
    const yThresh = -Math.log10(0.05); // ~1.30
    // significant + positive FC -> up (2)
    expect(classify(2, 3, 1, yThresh)).toBe(2);
    // significant + negative FC -> down (0)
    expect(classify(-2, 3, 1, yThresh)).toBe(0);
    // below significance -> NS (1)
    expect(classify(2, 1, 1, yThresh)).toBe(1);
    // significant but small FC -> NS (1)
    expect(classify(0.5, 3, 1, yThresh)).toBe(1);
  });

  it("computes a symmetric x extent centered on 0", () => {
    const [lo, hi] = symmetricExtent([-3, 1, 2], 0);
    expect(lo).toBe(-3);
    expect(hi).toBe(3);
  });

  it("pads an extent and handles degenerate input", () => {
    expect(paddedExtent([5, 5])).toEqual([4, 6]);
    expect(paddedExtent([])).toEqual([0, 1]);
  });

  it("produces nice ticks within a domain", () => {
    const t = niceTicks([0, 10], 5);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(10);
    expect(t.length).toBeGreaterThan(2);
  });
});
