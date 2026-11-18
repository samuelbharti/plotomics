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

  it("gives a missing or negative count no height on the stem", () => {
    // R sends NA as null; Python sends NaN.
    const s = stackVariants(
      [248, 248, 248, 248],
      [Number.NaN, 5, null as unknown as number, -2],
    );
    expect(s.top[1]).toBe(5);
    expect(s.base[1]).toBe(0);
    expect(s.top.every((t) => Number.isFinite(t))).toBe(true);
    expect(Math.max(...s.top)).toBe(5);
  });
});

describe("lollipop label placement", () => {
  const bounds = { left: 0, right: 1000, top: 0 };
  const above = (x: number, y: number) => ({
    x,
    y,
    anchor: "middle" as const,
  });
  /** Spots straight above a head, climbing `rows` rows with a leader. */
  const climb = (x: number, y: number, rows = 4) =>
    Array.from({ length: rows }, (_, row) => ({
      x,
      y: y - row * 12,
      anchor: "middle" as const,
      leader: row > 0 ? { x, y: y + 3 } : undefined,
    }));

  it("puts well-separated labels at their first spot", () => {
    const spots = placeLabels(
      [
        { width: 30, spots: [above(100, 100)] },
        { width: 30, spots: [above(300, 80)] },
      ],
      [],
      bounds,
    );
    expect(spots.map((s) => s && [s.x, s.y])).toEqual([
      [100, 100],
      [300, 80],
    ]);
  });

  it("climbs past a label already placed", () => {
    // The first label blocks the second one's first spot and the row above
    // (by 2 px), but not its leader path, so the second climbs two rows.
    const spots = placeLabels(
      [
        { width: 40, spots: [above(560, 40)] },
        { width: 40, spots: climb(595, 42) },
      ],
      [],
      bounds,
    );
    expect(spots[0]?.y).toBe(40);
    expect(spots[1]?.y).toBe(42 - 2 * 12);
    expect(spots[1]?.leader).toBeDefined();
  });

  it("never covers a head", () => {
    const head = { x0: 90, y0: 88, x1: 110, y1: 108 };
    const spots = placeLabels(
      [{ width: 30, spots: climb(100, 100) }],
      [head],
      bounds,
    );
    // Baseline 100 and 88 overlap the head; 76 clears it.
    expect(spots[0]?.y).toBe(76);
  });

  it("takes a spot beside the head, measured from its anchor", () => {
    const head = { x0: 90, y0: 90, x1: 110, y1: 110 };
    const spots = placeLabels(
      [
        {
          width: 30,
          spots: [
            { x: 113, y: 103, anchor: "start" },
            { x: 87, y: 103, anchor: "end" },
          ],
        },
        // Same spots again: the right is taken now, so the left is used.
        {
          width: 30,
          spots: [
            { x: 113, y: 103, anchor: "start" },
            { x: 87, y: 103, anchor: "end" },
          ],
        },
      ],
      [head],
      bounds,
    );
    expect(spots[0]?.anchor).toBe("start");
    expect(spots[1]?.anchor).toBe("end");
  });

  it("keeps a leader line from crossing a label already placed", () => {
    // A narrow label right above the head: every higher spot would run the
    // leader line through it.
    const blocked = placeLabels(
      [
        { width: 10, spots: [above(100, 95)] },
        { width: 30, spots: climb(100, 100).slice(1) },
      ],
      [],
      bounds,
    );
    expect(blocked[0]?.y).toBe(95);
    expect(blocked[1]).toBeNull();
    // Moved off the path, the same label leaves the climb free.
    const clear = placeLabels(
      [
        { width: 10, spots: [above(130, 95)] },
        { width: 30, spots: climb(100, 100).slice(1) },
      ],
      [],
      bounds,
    );
    expect(clear[1]?.y).toBe(88);
  });

  it("drops a label with no free spot inside the bounds", () => {
    const spots = placeLabels(
      [
        { width: 30, spots: climb(50, 14) },
        { width: 30, spots: climb(50, 14) },
      ],
      [],
      { left: 0, right: 1000, top: 2 },
    );
    expect(spots[0]?.y).toBe(14);
    expect(spots[1]).toBeNull();
  });

  it("clamps a centred label near either end and skips a side spot past it", () => {
    const spots = placeLabels(
      [
        { width: 40, spots: [above(2, 100)] },
        { width: 40, spots: [above(998, 100)] },
        { width: 40, spots: [{ x: 990, y: 50, anchor: "start" }] },
      ],
      [],
      bounds,
    );
    expect(spots[0]?.x).toBe(20);
    expect(spots[1]?.x).toBe(980);
    expect(spots[2]).toBeNull();
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

  it("puts round ticks between the ends, never two labels together", () => {
    expect(residueTicks(393)).toEqual([
      1, 50, 100, 150, 200, 250, 300, 350, 393,
    ]);
    // PTEN (403) and CTNNB1 (781): 400 and 780 sit too close to the end.
    expect(residueTicks(403)).toEqual([
      1, 50, 100, 150, 200, 250, 300, 350, 403,
    ]);
    expect(residueTicks(781).slice(-2)).toEqual([700, 781]);
  });
});
