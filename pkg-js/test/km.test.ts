import { describe, expect, it } from "vitest";
import {
  flowLegend,
  groupSlices,
  groupRows,
  formatTime,
  layoutKm,
  stepPoints,
  survivalLabel,
  survivalTicks,
  tickDecimals,
  tickStride,
  timeTicks,
} from "../src/components/km.js";
import { textSizes } from "../src/core/theme.js";

describe("km helpers", () => {
  it("expands points into a right-continuous step", () => {
    // Survival holds flat between event times and then drops, so between two
    // estimates the path must go across before it goes down.
    const pts = stepPoints([0, 10, 20], [1, 0.8, 0.5]);
    expect(pts).toEqual([0, 1, 10, 1, 10, 0.8, 20, 0.8, 20, 0.5]);
  });

  it("handles degenerate step input", () => {
    expect(stepPoints([], [])).toEqual([]);
    expect(stepPoints([5], [1])).toEqual([5, 1]);
    // Mismatched lengths use the shorter of the two rather than reading undefined.
    expect(stepPoints([0, 1, 2], [1, 0.5])).toEqual([0, 1, 1, 1, 1, 0.5]);
  });

  it("never emits a diagonal segment", () => {
    const pts = stepPoints([0, 3, 7, 9], [1, 0.9, 0.4, 0.1]);
    for (let i = 2; i < pts.length; i += 2) {
      const dx = (pts[i] as number) !== (pts[i - 2] as number);
      const dy = (pts[i + 1] as number) !== (pts[i - 1] as number);
      expect(dx && dy).toBe(false);
    }
  });

  it("finds each group's contiguous slice in the given order", () => {
    const slices = groupSlices(["a", "a", "b", "b", "b"], ["b", "a"]);
    expect(slices).toEqual([
      { group: "b", start: 2, end: 4 },
      { group: "a", start: 0, end: 1 },
    ]);
  });

  it("skips groups with no points", () => {
    expect(groupSlices(["a", "a"], ["a", "b"])).toEqual([
      { group: "a", start: 0, end: 1 },
    ]);
    expect(groupSlices([], ["a"])).toEqual([]);
  });

  it("produces readable time ticks", () => {
    expect(timeTicks(100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(timeTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    // Degenerate input still yields a usable single tick.
    expect(timeTicks(0)).toEqual([0]);
    expect(timeTicks(Number.NaN)).toEqual([0]);
  });

  it("reserves room under the axis for one risk row per stratum", () => {
    const withTable = layoutKm(800, 600, 4, { showRiskTable: true });
    const without = layoutKm(800, 600, 4, { showRiskTable: false });
    expect(withTable.axisY).toBeLessThan(without.axisY);
    expect(withTable.riskTop).toBeGreaterThan(withTable.axisY);
    expect(withTable.plotH).toBe(withTable.axisY - withTable.top);
  });

  it("keeps the curve panel usable when the table would starve it", () => {
    // Twelve strata in a short element: the panel keeps its 40 px floor,
    // so it never collapses to nothing, and the table, with no room for
    // a row per stratum under it, is left out.
    const l = layoutKm(800, 200, 12, { showRiskTable: true });
    expect(l.plotH).toBeGreaterThanOrEqual(40);
    expect(l.table).toBe(false);
    // Eight strata fit at the tightest rows, so the panel keeps half.
    expect(layoutKm(800, 340, 8, { showRiskTable: true }).axisY).toBe(170);
    // Twelve strata at 300 px: the rows tighten to fit.
    const tight = layoutKm(800, 300, 12, { showRiskTable: true });
    expect(tight.table).toBe(true);
    expect(tight.riskRowH).toBeLessThan(16);
    expect(tight.riskRowH).toBeGreaterThanOrEqual(8);
  });
});

describe("km rows, labels and layout", () => {
  it("collects each group's rows in time order when groups interleave", () => {
    // A table sorted by time overall: T and C alternate.
    const rows = groupRows(
      ["T", "C", "T", "C", "T", "C"],
      ["T", "C"],
      [0, 0, 5, 7, 12, 15],
    );
    expect(rows).toEqual([
      { group: "T", rows: [0, 2, 4] },
      { group: "C", rows: [1, 3, 5] },
    ]);
    // Out-of-order times within a group are sorted.
    expect(groupRows(["a", "a", "a"], ["a"], [5, 0, 2])).toEqual([
      { group: "a", rows: [1, 2, 0] },
    ]);
  });

  it("labels ticks with the decimals the most precise one needs", () => {
    expect(tickDecimals([0, 2.5, 5, 7.5, 10, 12.5])).toBe(1);
    expect(tickDecimals([0, 0.25, 0.5])).toBe(2);
    expect(tickDecimals([0, 200, 400])).toBe(0);
    // Uneven risk times: the first gap is 1, but 2.5 still needs a decimal.
    expect(tickDecimals([0, 1, 2.5, 5, 10])).toBe(1);
    // Floating-point noise from a tick generator does not add decimals.
    expect(tickDecimals([0, 0.1 * 3])).toBe(1);
    expect(formatTime(200)).toBe("200");
    expect(formatTime(8.333)).toBe("8.33");
  });

  it("widens the left gutter for long stratum names and skips an empty table", () => {
    const narrow = layoutKm(800, 600, 3, { showRiskTable: true }, true, 30);
    const wide = layoutKm(800, 600, 3, { showRiskTable: true }, true, 120);
    expect(narrow.left).toBe(58);
    expect(wide.left).toBeGreaterThanOrEqual(120 + 18);
    // No counts: no table, so the curves keep the height.
    const noCounts = layoutKm(800, 600, 3, { showRiskTable: true }, false, 120);
    expect(noCounts.axisY).toBeGreaterThan(wide.axisY);
    expect(noCounts.left).toBe(58);
    // A very long name stops at a share of the width, so the panel survives.
    const capped = layoutKm(300, 420, 2, { showRiskTable: true }, true, 400);
    expect(capped.left).toBeLessThanOrEqual(300 * 0.35);
    expect(300 - capped.left - capped.right).toBeGreaterThan(150);
  });

  it("keeps every risk row inside the element at small heights", () => {
    for (const [h, n] of [
      [200, 6],
      [250, 9],
      [300, 12],
    ] as const) {
      const l = layoutKm(600, h, n, { showRiskTable: true });
      // The last row's baseline sits at riskTop + (n - 1) * rowH + 3.
      const lastBaseline = l.riskTop + (n - 1) * l.riskRowH + 3;
      expect(lastBaseline).toBeLessThanOrEqual(h - 2);
      expect(l.riskRowH).toBeGreaterThanOrEqual(8);
      expect(l.plotH).toBeGreaterThan(30);
    }
  });
});

describe("km layout at other text sizes", () => {
  const big = textSizes({ fontSize: 16 });
  const noTable = { showRiskTable: false };

  it("widens the left gutter for wider y tick labels", () => {
    const narrow = layoutKm(600, 520, 2, noTable, false, 0, big, 30);
    const wide = layoutKm(600, 520, 2, noTable, false, 0, big, 70);
    expect(wide.left - narrow.left).toBeGreaterThanOrEqual(39);
    // The labels end 8 px short of the panel, and the rotated y title keeps
    // more than an em to the left of them.
    expect(wide.left - 8 - 70).toBeGreaterThanOrEqual(1.3 * big.axisTitle);
  });

  it("leaves room for half the last tick label right of the panel", () => {
    expect(
      layoutKm(600, 520, 2, noTable, false, 0, big, 0, 50).right,
    ).toBeGreaterThanOrEqual(25);
    expect(layoutKm(600, 520, 2, noTable, false, 0, big, 0, 10).right).toBe(16);
  });

  it("starts the panel low enough for the top tick label", () => {
    // The "100%" label is centred on the top of the panel: its font box
    // reaches 1.08 em above the baseline, which sits 0.35 em under the top.
    for (const fontSize of [16, 24, 30]) {
      const s = textSizes({ fontSize });
      const l = layoutKm(600, 520, 2, noTable, false, 0, s);
      expect(l.top).toBeGreaterThanOrEqual((1.08 - 0.35) * s.label);
    }
  });

  it("keeps each risk-table row taller than a name", () => {
    const cases = [
      [260, 12],
      [300, 12],
      [360, 16],
      [400, 16],
    ] as const;
    for (const [h, fontSize] of cases) {
      const s = textSizes({ fontSize });
      const l = layoutKm(600, h, 8, { showRiskTable: true }, true, 50, s);
      expect(l.riskRowH).toBeGreaterThan(s.label);
      // The last row ends inside the element.
      expect(l.riskTop + 7.5 * l.riskRowH).toBeLessThanOrEqual(h);
    }
  });

  it("moves the table down and opens its rows for larger text", () => {
    const small = layoutKm(600, 520, 3, { showRiskTable: true });
    const large = layoutKm(600, 520, 3, { showRiskTable: true }, true, 0, big);
    expect(large.riskTop - large.axisY).toBeGreaterThan(
      small.riskTop - small.axisY,
    );
    expect(large.riskRowH).toBeGreaterThan(small.riskRowH);
  });
});

describe("km survival ticks", () => {
  it("takes 25% steps when their labels keep clear", () => {
    expect(survivalTicks(0, 200, 11)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(survivalTicks(0.4, 200, 11)).toEqual([0.4, 0.6, 0.8, 1]);
  });

  it("takes fewer ticks on a short axis, never closer than the label size", () => {
    // Before the fix the five ticks stayed at any height: on a 40 px axis
    // with 14.7 px labels they were 10 px from each other.
    expect(survivalTicks(0, 40, 14.7)).toEqual([0, 0.5, 1]);
    expect(survivalTicks(0, 30, 14.7)).toEqual([0, 1]);
    expect(survivalTicks(0, 10, 14.7)).toEqual([1]);
    expect(survivalTicks(0, 0, 14.7)).toEqual([]);
    for (let px = 0; px <= 120; px += 1) {
      const t = survivalTicks(0.2, px, 14.7);
      for (let i = 1; i < t.length; i += 1) {
        const gap = (((t[i] as number) - (t[i - 1] as number)) / 0.8) * px;
        expect(gap, `${px} px`).toBeGreaterThanOrEqual(14.7 + 2 - 1e-9);
      }
    }
  });
});

describe("km survival ticks above a floor", () => {
  /** The floors yMin gives: 0.1 under a tenth, as 0.2 - 0.05. */
  const floors = Array.from({ length: 11 }, (_, d) =>
    Math.max(0, d / 10 - 0.05),
  );

  it("puts the ticks on round percentages above a floor that is not 0", () => {
    // Before the fix a floor of 15% gave ticks at 15, 36.25, 57.5, 78.75
    // and 100%, labelled 15, 36, 58, 79 and 100%.
    expect(survivalTicks(0.2 - 0.05, 300, 11)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    expect(survivalTicks(0.9 - 0.05, 300, 11)).toEqual([0.85, 0.9, 0.95, 1]);
    for (const lo of floors) {
      for (const px of [40, 80, 160, 300, 500]) {
        const t = survivalTicks(lo, px, 11);
        expect(t[t.length - 1]).toBe(1);
        // Two ticks at most: the floor and 1, or 1 alone.
        if (t.length < 3) continue;
        expect(t.length).toBeLessThanOrEqual(5);
        expect(t[0] as number).toBeGreaterThanOrEqual(lo - 1e-9);
        const pct = t.map((v) => v * 100);
        const step = Math.round((pct[1] as number) - (pct[0] as number));
        expect([1, 2, 5, 10, 20, 25, 50]).toContain(step);
        for (const p of pct) {
          // A whole multiple of the step, so its label states it exactly.
          expect(Math.abs(p - Math.round(p / step) * step)).toBeLessThan(1e-9);
        }
        for (let i = 1; i < pct.length; i += 1) {
          const gap =
            (((t[i] as number) - (t[i - 1] as number)) / (1 - lo)) * px;
          expect(gap, `${lo} at ${px} px`).toBeGreaterThanOrEqual(16 - 1e-9);
        }
      }
    }
  });

  it("labels each tick with the percentage it sits on", () => {
    expect(survivalLabel(0.2 - 0.05)).toBe("15%");
    expect(survivalLabel(0.6)).toBe("60%");
    expect(survivalLabel(0)).toBe("0%");
    expect(survivalLabel(0.3625)).toBe("36.25%");
  });
});

describe("km layout at short heights", () => {
  it("keeps the risk table inside the element, or leaves it out", () => {
    // Before the fix the panel kept 40 px and the rows ran on past the
    // bottom: in an 800 px element below 160 px with 2 strata, 180 px with
    // 4 and 240 px with 8.
    for (const fontSize of [12, 16]) {
      const s = textSizes({ fontSize });
      for (let h = 60; h <= 400; h += 5) {
        for (let n = 1; n <= 12; n += 1) {
          const l = layoutKm(780, h, n, { showRiskTable: true }, true, 40, s);
          // The panel gives up its least height only when the axis has no
          // labels left to drop.
          if (l.xTicks) expect(l.plotH).toBeGreaterThanOrEqual(40);
          if (l.table === false) continue;
          expect(l.xTicks && l.xTitle).toBe(true);
          // The font box of the last name ends 0.61 em under the middle of
          // its row.
          const bottom =
            l.riskTop + (n - 1) * l.riskRowH + (0.35 + 0.26) * s.label;
          expect(bottom, `${h} px, ${n} strata`).toBeLessThanOrEqual(h);
        }
      }
    }
  });

  it("drops the table heading first, then the table", () => {
    // The plot box of an 800 x 150 px element: two rows fit under the panel
    // without the heading.
    const bare = layoutKm(780, 130, 2, { showRiskTable: true });
    expect(bare.table).toBe(true);
    expect(bare.tableHeading).toBe(false);
    // At 120 px they do not, and the gutter for the names goes too.
    const none = layoutKm(780, 100, 2, { showRiskTable: true }, true, 120);
    expect(none.table).toBe(false);
    expect(none.left).toBe(58);
    expect(none.plotH).toBeGreaterThanOrEqual(40);
    const full = layoutKm(780, 500, 2, { showRiskTable: true });
    expect(full.table && full.tableHeading).toBe(true);
  });

  it("puts the legend in a band above the panel, a fifth of the height at most", () => {
    const widths = Array.from({ length: 8 }, () => 200);
    for (const h of [200, 300, 500]) {
      const l = layoutKm(
        780,
        h,
        8,
        { showRiskTable: true },
        true,
        0,
        undefined,
        0,
        0,
        widths,
        50,
      );
      expect(l.legend.length).toBeGreaterThan(0);
      for (const e of l.legend) {
        expect(e.x).toBeGreaterThanOrEqual(l.left);
        expect(e.x + e.width).toBeLessThanOrEqual(780 - l.right);
        // The font box of each entry ends above the top half of the
        // "100%" label, centred on the top of the panel.
        expect(e.y + 0.26 * 11).toBeLessThanOrEqual(l.top - (1.08 - 0.35) * 11);
        expect(e.y + 0.26 * 11).toBeLessThanOrEqual(0.2 * h);
      }
      const shown = l.legend.filter((e) => e.index >= 0).length;
      expect(shown + l.legendMore).toBe(8);
    }
    // No legend widths, no band: the panel starts where it did.
    const plain = layoutKm(780, 500, 2, { showRiskTable: true });
    expect(plain.legend).toEqual([]);
    expect(plain.top).toBe(14);
  });
});

describe("km legend rows", () => {
  it("wraps the entries onto rows in order, and cuts one wider than a row", () => {
    const f = flowLegend([50, 60, 70, 300], 200, 5, 40);
    expect(f.entries).toEqual([
      { index: 0, x: 0, row: 0, width: 50 },
      { index: 1, x: 62, row: 0, width: 60 },
      { index: 2, x: 0, row: 1, width: 70 },
      { index: 3, x: 0, row: 2, width: 200 },
    ]);
    expect(f.rows).toBe(3);
    expect(f.more).toBe(0);
  });

  it('ends the last row with a "+N more" note', () => {
    // Two entries a row, five entries, two rows: the second entry of the
    // last row gives way to the note.
    const f = flowLegend([90, 90, 90, 90, 90], 200, 2, 50);
    expect(f.entries).toEqual([
      { index: 0, x: 0, row: 0, width: 90 },
      { index: 1, x: 102, row: 0, width: 90 },
      { index: 2, x: 0, row: 1, width: 90 },
      { index: -1, x: 102, row: 1, width: 50 },
    ]);
    expect(f.rows).toBe(2);
    expect(f.more).toBe(2);
  });

  it("cuts a lone entry short for the note, and shows nothing when it cannot", () => {
    const f = flowLegend([300, 300], 200, 1, 50);
    expect(f.entries).toEqual([
      { index: 0, x: 0, row: 0, width: 138 },
      { index: -1, x: 150, row: 0, width: 50 },
    ]);
    expect(f.more).toBe(1);
    expect(flowLegend([300, 300], 60, 1, 50).entries).toEqual([]);
    expect(flowLegend([10], 200, 0, 50).entries).toEqual([]);
    expect(flowLegend([], 200, 3, 50).entries).toEqual([]);
  });
});

describe("km time labels on a narrow axis", () => {
  // Times 0 to 1000 by 50 on a 304 px axis: 15.2 px from one to the next.
  const xs = Array.from({ length: 21 }, (_, i) => i * 15.2);

  it("labels every k-th time, with k the least that keeps them clear", () => {
    // Before the fix every one of the 19 px labels was drawn.
    expect(
      tickStride(
        xs,
        xs.map(() => 19),
      ),
    ).toBe(2);
    expect(tickStride([0, 100], [10, 10])).toBe(1);
    // Two labels that cannot both fit: the first alone.
    expect(tickStride([0, 5], [10, 10])).toBe(2);
    expect(tickStride([], [])).toBe(1);
  });

  it("keeps a round grid round", () => {
    // Three steps would clear 36 px labels, but 0, 150, 300 is not a round
    // grid: four steps give 0, 200, 400.
    expect(
      tickStride(
        xs,
        xs.map(() => 36),
      ),
    ).toBe(4);
    expect(
      tickStride(
        xs,
        xs.map(() => 66),
      ),
    ).toBe(5);
  });
});
