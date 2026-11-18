import { describe, it, expect } from "vitest";
import {
  headRadius,
  layoutLollipop,
  placeLabels,
  residueTicks,
  stackVariants,
  wrapRows,
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
    const withAll = layoutLollipop(900, 540, {
      showPtms: true,
      showLegend: true,
    });
    const bare = layoutLollipop(900, 540, {
      showPtms: false,
      showLegend: false,
    });
    expect(bare.stemH).toBeGreaterThan(withAll.stemH);
  });

  it("reserves the axis text and the legend rows below the axis", () => {
    const one = layoutLollipop(900, 540, { showPtms: true, showLegend: true });
    // The title (baseline axisY + 28) ends above the first legend row, whose
    // baseline is axisY + 44 and whose 10 px text starts near axisY + 35.
    const firstRow = one.axisY + 44;
    expect(one.axisY + 28 + 3).toBeLessThan(firstRow - 9);
    // The last legend row's baseline stays inside the element.
    expect(firstRow).toBeLessThanOrEqual(540 - 6);
    const three = layoutLollipop(
      900,
      540,
      { showPtms: true, showLegend: true },
      3,
    );
    expect(three.axisY).toBe(one.axisY - 2 * 15);
    expect(three.axisY + 44 + 2 * 15).toBeLessThanOrEqual(540 - 6);
    // Without a legend, the axis text still fits under the axis.
    const bare = layoutLollipop(900, 540, {
      showPtms: true,
      showLegend: false,
    });
    expect(bare.axisY + 28 + 3).toBeLessThanOrEqual(540 - 2);
    // A legend with no entries takes no room.
    const empty = layoutLollipop(
      900,
      540,
      { showPtms: true, showLegend: true },
      0,
    );
    expect(empty.axisY).toBe(bare.axisY);
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

describe("lollipop variant stacking", () => {
  it("stacks the variants of one residue, most recurrent at the bottom", () => {
    // Residue 248: R248W (1) is listed first, R248Q (3) second.
    const s = stackVariants([248, 248, 175], [1, 3, 5]);
    expect(s.base).toEqual([3, 0, 0]);
    expect(s.top).toEqual([4, 3, 5]);
    // Drawing order: by residue, bottom head first.
    expect(s.order).toEqual([2, 1, 0]);
  });

  it("keeps the row order for equal counts, so the later row is on top", () => {
    const s = stackVariants([248, 248], [1, 1]);
    expect(s.top).toEqual([1, 2]);
    expect(s.order).toEqual([0, 1]);
  });

  it("handles empty input", () => {
    expect(stackVariants([], [])).toEqual({ base: [], top: [], order: [] });
  });
});

describe("lollipop label placement", () => {
  const bounds = { left: 0, right: 1000, top: 0 };

  it("puts well-separated labels at their preferred spot", () => {
    const spots = placeLabels(
      [
        { x: 100, y: 100, width: 30 },
        { x: 300, y: 80, width: 30 },
      ],
      [],
      bounds,
    );
    expect(spots).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 80 },
    ]);
  });

  it("lifts a label that would overlap one already placed", () => {
    // Two heads at nearly the same height and x: one row up still overlaps
    // the first label by 2 px, so the second climbs two rows.
    const spots = placeLabels(
      [
        { x: 576, y: 40, width: 40 },
        { x: 576, y: 42, width: 40 },
      ],
      [],
      { left: 0, right: 1000, top: 0 },
    );
    expect(spots[0]).toEqual({ x: 576, y: 40 });
    expect(spots[1]?.y).toBe(42 - 2 * 12);
  });

  it("never covers a head", () => {
    const head = { x0: 90, y0: 88, x1: 110, y1: 108 };
    const spots = placeLabels([{ x: 100, y: 100, width: 30 }], [head], bounds);
    // Baseline 100 and 88 overlap the head; 76 clears it.
    expect(spots[0]?.y).toBe(76);
  });

  it("drops a label with no free spot inside the bounds", () => {
    const spots = placeLabels(
      [
        { x: 50, y: 14, width: 30 },
        { x: 50, y: 14, width: 30 },
      ],
      [],
      { left: 0, right: 1000, top: 2 },
    );
    expect(spots[0]).toEqual({ x: 50, y: 14 });
    expect(spots[1]).toBeNull();
  });

  it("clamps x so a label near either end stays inside", () => {
    const spots = placeLabels(
      [
        { x: 2, y: 100, width: 40 },
        { x: 998, y: 100, width: 40 },
      ],
      [],
      bounds,
    );
    expect(spots[0]?.x).toBe(20);
    expect(spots[1]?.x).toBe(980);
  });
});

describe("lollipop legend wrapping", () => {
  it("starts a new row when an entry would pass the width", () => {
    expect(wrapRows([50, 50, 50], 130, 14)).toEqual([
      { x: 0, row: 0 },
      { x: 64, row: 0 },
      { x: 0, row: 1 },
    ]);
  });

  it("keeps an entry wider than the row on a row of its own", () => {
    expect(wrapRows([200, 20], 100, 14)).toEqual([
      { x: 0, row: 0 },
      { x: 0, row: 1 },
    ]);
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
