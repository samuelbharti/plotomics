import { describe, it, expect } from "vitest";
import {
  headRadius,
  layoutLollipop,
  residueTicks,
  stackLabels,
} from "../src/components/lollipop.js";

describe("lollipop layout", () => {
  it("stacks the stem area, backbone, PTM track and axis top to bottom", () => {
    const l = layoutLollipop(900, 540, { showPtms: true, showLegend: true });
    expect(l.top).toBeLessThan(l.baseline);
    expect(l.baseline).toBe(l.backboneTop);
    expect(l.backboneTop).toBeLessThan(l.backboneBottom);
    expect(l.backboneBottom).toBeLessThanOrEqual(l.ptmTop);
    expect(l.ptmTop).toBeLessThan(l.axisY);
    expect(l.innerW).toBe(900 - 52 - 16);
    expect(l.stemH).toBeGreaterThan(0);
  });

  it("gives the stems more room when the PTM track and legend are hidden", () => {
    const withAll = layoutLollipop(900, 540, { showPtms: true, showLegend: true });
    const bare = layoutLollipop(900, 540, { showPtms: false, showLegend: false });
    expect(bare.stemH).toBeGreaterThan(withAll.stemH);
  });

  it("never returns a degenerate stem area for a tiny container", () => {
    const l = layoutLollipop(40, 40, { showPtms: true, showLegend: true });
    expect(l.stemH).toBeGreaterThan(0);
    expect(l.innerW).toBeGreaterThan(0);
  });
});

describe("lollipop head radius", () => {
  it("scales head AREA with count, not radius", () => {
    // A count of 4x should give a radius 2x above the minimum.
    const r1 = headRadius(25, 100, 0, 10);
    const r2 = headRadius(100, 100, 0, 10);
    expect(r1).toBeCloseTo(5);
    expect(r2).toBeCloseTo(10);
  });

  it("clamps to the configured range", () => {
    expect(headRadius(0, 100, 3, 11)).toBe(3);
    expect(headRadius(100, 100, 3, 11)).toBe(11);
    expect(headRadius(-5, 100, 3, 11)).toBe(3);
  });

  it("falls back to the minimum when there is no maximum", () => {
    expect(headRadius(5, 0, 3, 11)).toBe(3);
  });
});

describe("lollipop label stacking", () => {
  it("keeps well-separated labels on the first row", () => {
    expect(stackLabels([10, 100, 200], [20, 20, 20])).toEqual([0, 0, 0]);
  });

  it("pushes an overlapping label to the next row", () => {
    const rows = stackLabels([10, 15, 20], [20, 20, 20]);
    expect(rows[0]).toBe(0);
    expect(rows[1]).toBe(1);
    expect(rows[2]).toBe(2);
  });

  it("returns -1 when every row is taken, so the caller can skip it", () => {
    const rows = stackLabels([10, 12, 14, 16], [20, 20, 20, 20], 3);
    expect(rows[3]).toBe(-1);
  });

  it("reuses a row once the previous label has ended", () => {
    const rows = stackLabels([10, 12, 300], [20, 20, 20]);
    expect(rows[2]).toBe(0);
  });
});

describe("lollipop residue ticks", () => {
  it("always includes the first and last residue", () => {
    const t = residueTicks(393);
    expect(t[0]).toBe(1);
    expect(t[t.length - 1]).toBe(393);
  });

  it("is monotonic increasing", () => {
    const t = residueTicks(1068);
    for (let i = 1; i < t.length; i += 1) {
      expect(t[i] as number).toBeGreaterThan(t[i - 1] as number);
    }
  });

  it("handles a degenerate length", () => {
    expect(residueTicks(1)).toEqual([1]);
  });
});
