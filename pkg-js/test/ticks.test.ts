import { describe, expect, it } from "vitest";
import {
  domainTicks,
  fitAxisTicks,
  fitDomainTicks,
  fitZeroTicks,
  formatTick,
  formatTicks,
  isFlatRange,
  snapRatio,
  rangeTicks,
  spaceTicks,
  stepDecimals,
  zeroTicks,
} from "../src/core/ticks.js";

describe("round axis ticks", () => {
  it("steps by 1, 2 or 5 x 10^k from 0 to a top that covers the data", () => {
    expect(zeroTicks(10, 4)).toEqual({
      ticks: [0, 2, 4, 6, 8, 10],
      top: 10,
      step: 2,
    });
    expect(zeroTicks(250, 4).ticks).toEqual([0, 50, 100, 150, 200, 250]);
    expect(zeroTicks(0.18, 4).ticks).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
    expect(zeroTicks(2, 4).ticks).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(zeroTicks(0).top).toBe(1);
    expect(zeroTicks(Number.NaN).top).toBe(1);
  });

  it("labels each tick with the decimals its step needs", () => {
    expect(stepDecimals(2)).toBe(0);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(0.5)).toBe(1);
    // The issue's cases: no label states a value its gridline does not have.
    const fractions = zeroTicks(0.5, 4);
    expect(fractions.ticks.map((v) => formatTick(v, fractions.step))).toEqual([
      "0.0",
      "0.1",
      "0.2",
      "0.3",
      "0.4",
      "0.5",
    ]);
    const share = zeroTicks(0.018, 4);
    expect(
      share.ticks.map((v) => formatTick(v, share.step, { percent: true })),
    ).toEqual(["0.0%", "0.5%", "1.0%", "1.5%", "2.0%"]);
  });

  it("prints thousands as k only when the step is whole thousands", () => {
    const counts = zeroTicks(1800, 4);
    expect(counts.ticks.map((v) => formatTick(v, counts.step))).toEqual([
      "0",
      "500",
      "1000",
      "1500",
      "2000",
    ]);
    const big = zeroTicks(18000, 4);
    expect(big.ticks.map((v) => formatTick(v, big.step))).toEqual([
      "0",
      "5k",
      "10k",
      "15k",
      "20k",
    ]);
  });

  it("prints a million and more in M, whatever the step", () => {
    const t = zeroTicks(1.8e6, 4);
    expect(t.ticks.map((v) => formatTick(v, t.step))).toEqual([
      "0",
      "500k",
      "1.0M",
      "1.5M",
      "2.0M",
    ]);
    expect(formatTick(1.05e6, 5e4)).toBe("1.05M");
    expect(formatTick(3e6, 1e6)).toBe("3M");
    expect(formatTick(950000, 50000)).toBe("950k");
  });

  it("puts whole-number ticks from 1 to the length", () => {
    expect(rangeTicks(10)).toEqual([1, 2, 4, 6, 8, 10]);
    expect(rangeTicks(3)).toEqual([1, 2, 3]);
    expect(rangeTicks(1)).toEqual([1]);
  });
});

describe("ticks for tiny values, whole counts and short axes", () => {
  it("handles tiny and absurd maxima", () => {
    expect(stepDecimals(2e-10)).toBe(10);
    const tiny = zeroTicks(3e-10, 4);
    expect(tiny.top).toBeGreaterThanOrEqual(3e-10);
    expect(new Set(tiny.ticks).size).toBe(tiny.ticks.length);
    expect(zeroTicks(Number.MIN_VALUE).top).toBe(1);
  });

  it("keeps whole-number steps for counts", () => {
    expect(zeroTicks(1, 4, { integer: true }).ticks).toEqual([0, 1]);
    expect(zeroTicks(2, 4, { integer: true }).ticks).toEqual([0, 1, 2]);
  });

  it("keeps 0 and the round top when even the coarsest step crowds", () => {
    // A top count of 3 takes a step of 2 at its coarsest, three labels in
    // all, where an axis 25 px long with 20 px between labels holds two.
    expect(fitZeroTicks(3, 25, { integer: true, minGapPx: 20 })).toEqual({
      ticks: [0, 4],
      top: 4,
      step: 4,
    });
    expect(fitZeroTicks(23, 30, { integer: true, minGapPx: 25 }).ticks).toEqual(
      [0, 40],
    );
    // The coarsest step is kept when its labels fit.
    expect(fitZeroTicks(3, 40, { integer: true, minGapPx: 20 }).ticks).toEqual([
      0, 2, 4,
    ]);
  });

  it("keeps 0 and the top when they keep the end gap, closer than the full gap", () => {
    // Before the fix the last pair needed the full gap: at a 16 px font the
    // count labels 0 and 50, 19 px from each other, lost the 0 to a gap of
    // 19.7, though the 14.7 px labels were clear.
    const opts = { integer: true, minGapPx: 14.7 + 5, endGapPx: 14.7 + 2 };
    expect(fitZeroTicks(39, 19, opts)).toEqual({
      ticks: [0, 50],
      top: 50,
      step: 50,
    });
    expect(fitZeroTicks(39, 16, opts).ticks).toEqual([50]);
    // Without an end gap the pair asks the full gap, as before.
    expect(
      fitZeroTicks(39, 19, { integer: true, minGapPx: 19.7 }).ticks,
    ).toEqual([50]);
  });

  it("keeps the top alone when 0 and the top do not fit either", () => {
    // Before the fix an axis 19 px long kept 0 and 4, 19 px from each
    // other where the labels need 20.
    expect(fitZeroTicks(3, 19, { integer: true, minGapPx: 20 })).toEqual({
      ticks: [4],
      top: 4,
      step: 4,
    });
    expect(fitZeroTicks(23, 1, { integer: true, minGapPx: 25 }).ticks).toEqual([
      40,
    ]);
    // No tick on an axis with no length.
    expect(fitZeroTicks(3, 0, { integer: true, minGapPx: 20 }).ticks).toEqual(
      [],
    );
  });

  it("never puts two labels closer than the gap, at any length", () => {
    for (const max of [0.3, 1, 3, 23, 124, 1000]) {
      for (let px = 0; px <= 120; px += 1) {
        const t = fitZeroTicks(max, px, { integer: max >= 1, minGapPx: 16 });
        for (let i = 1; i < t.ticks.length; i += 1) {
          const gap =
            (((t.ticks[i] as number) - (t.ticks[i - 1] as number)) / t.top) *
            px;
          expect(gap, `${max} on ${px} px`).toBeGreaterThanOrEqual(16 - 1e-9);
        }
      }
    }
  });

  it("uses fewer ticks on a short axis", () => {
    const tall = fitZeroTicks(12.4, 300);
    const short = fitZeroTicks(12.4, 60);
    expect(tall.ticks.length).toBeGreaterThan(short.ticks.length);
    expect(60 / (short.ticks.length - 1)).toBeGreaterThanOrEqual(16);
  });

  it("drops a tick whose label would touch its neighbour", () => {
    // Labels 40 px wide, 5 residues per px: 1600 and 1680 would overlap.
    const x = (t: number) => t / 5;
    const kept = spaceTicks([1, 400, 800, 1200, 1600, 1680], x, () => 40);
    expect(kept).toEqual([1, 400, 800, 1200, 1680]);
  });
});

describe("round ticks inside a range that need not start at 0", () => {
  const labels = (t: { ticks: number[]; step: number }) =>
    t.ticks.map((v) => formatTick(v, t.step));

  it("labels round values inside the range, not its raw ends", () => {
    // The colour bars of issue #101: raw ends such as 4.6 and -1.75, or
    // 10.01 and 2.7e-3, and a range of [0, 0.004] that read "0.00" twice.
    expect(domainTicks(-1.75, 4.6, 4)).toEqual({ ticks: [0, 2, 4], step: 2 });
    expect(labels(domainTicks(0.0027, 10.01, 4))).toEqual([
      "2",
      "4",
      "6",
      "8",
      "10",
    ]);
    expect(labels(domainTicks(0, 0.004, 4))).toEqual([
      "0.000",
      "0.001",
      "0.002",
      "0.003",
      "0.004",
    ]);
    expect(labels(domainTicks(1, 3, 4))).toEqual([
      "1.0",
      "1.5",
      "2.0",
      "2.5",
      "3.0",
    ]);
  });

  it("keeps the values clean of float noise", () => {
    expect(domainTicks(0.1, 0.7, 6).ticks).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7,
    ]);
  });

  it("takes a finer step until two ticks fall inside", () => {
    // No multiple of 0.1 lies in [0.31, 0.39], and one multiple of 0.05.
    expect(domainTicks(0.31, 0.39, 1)).toEqual({
      ticks: [0.32, 0.34, 0.36, 0.38],
      step: 0.02,
    });
    expect(domainTicks(-0.004, -0.001, 1).ticks.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("handles a reversed, flat or missing range", () => {
    expect(domainTicks(5, 1, 4)).toEqual(domainTicks(1, 5, 4));
    expect(labels(domainTicks(2.5, 2.5))).toEqual(["2.5"]);
    expect(domainTicks(Number.NaN, 1).ticks).toEqual([]);
  });

  it("fits the ticks to the length of the bar", () => {
    const tall = fitDomainTicks(0, 3, 120, { maxCount: 4, minGapPx: 20 });
    expect(tall.ticks).toEqual([0, 1, 2, 3]);
    const short = fitDomainTicks(0, 3, 30, { maxCount: 4, minGapPx: 20 });
    expect(short.ticks).toEqual([0, 2]);
    // Too short even for two ticks with 20 px between them: one is kept.
    const tiny = fitDomainTicks(0, 3, 20, { maxCount: 4, minGapPx: 20 });
    expect(tiny.ticks).toEqual([0]);
  });
});

describe("ranges too narrow or too small for round steps", () => {
  const labels = (t: { ticks: number[]; step: number }) =>
    t.ticks.map((v) => formatTick(v, t.step));

  it("gives one tick to a range too narrow for a round step, and returns", () => {
    // Before the fix these never returned: the tick index passed 2 ** 53,
    // where adding 1 no longer changes it, and the loop filled memory.
    const cases: [number, number, string][] = [
      [0.3, 0.1 + 0.2, "0.3"],
      [8, 8.000000000000002, "8"],
      [1, 1 + 2 * Number.EPSILON, "1"],
      [0.15, (0.1 + 0.2) / 2, "0.15"],
    ];
    for (const [lo, hi, label] of cases) {
      expect(labels(domainTicks(lo, hi, 4))).toEqual([label]);
      expect(labels(domainTicks(hi, lo, 1))).toEqual([label]);
      expect(
        labels(fitDomainTicks(lo, hi, 120, { maxCount: 4, minGapPx: 18 })),
      ).toEqual([label]);
    }
  });

  it("never repeats a label on a range a few units of the last digit wide", () => {
    // Before the fix such a range read "1.0000000000000009" twice.
    for (const k of [4, 8, 16, 64, 1024]) {
      expect(labels(domainTicks(1, 1 + k * Number.EPSILON))).toEqual(["1"]);
    }
    const wider = labels(domainTicks(1, 1 + 1e-11));
    expect(wider.length).toBeGreaterThan(1);
    expect(new Set(wider).size).toBe(wider.length);
  });

  it("prints the value of a small flat range, not zero", () => {
    // Before the fix these read "0.000000" and "-0.000000".
    expect(labels(domainTicks(1e-7, 1e-7))).toEqual(["1e-7"]);
    expect(labels(domainTicks(-3e-8, -3e-8))).toEqual(["-3e-8"]);
    expect(labels(domainTicks(123.456, 123.456))).toEqual(["123.456"]);
    expect(labels(domainTicks(1 / 3, 1 / 3))).toEqual(["0.333333"]);
    expect(labels(domainTicks(0, 0))).toEqual(["0"]);
  });

  it("prints every whole digit of a large flat value", () => {
    // Before the fix 1234567 read "1234570" and 2 ** 53 "9007200000000000".
    const flat = (v: number) => labels(domainTicks(v, v));
    expect(flat(1234567)).toEqual(["1234567"]);
    expect(flat(-1234567)).toEqual(["-1234567"]);
    expect(flat(123456789)).toEqual(["123456789"]);
    expect(flat(1e15 + 1)).toEqual(["1000000000000001"]);
    expect(flat(2 ** 53)).toEqual(["9007199254740992"]);
    expect(flat(999999)).toEqual(["999999"]);
    // A fraction keeps up to six significant digits in all.
    expect(flat(1234.56789)).toEqual(["1234.57"]);
  });

  it("calls a range flat by its width against its values", () => {
    expect(isFlatRange(2, 2)).toBe(true);
    expect(isFlatRange(0.3, 0.1 + 0.2)).toBe(true);
    expect(isFlatRange(8.000000000000002, 8)).toBe(true);
    expect(isFlatRange(1, 1 + 1e-11)).toBe(false);
    expect(isFlatRange(0, 1e-300)).toBe(false);
  });
});

describe("ticks for float32 values and one unit per axis", () => {
  it("adds no step for the noise of a float32 value", () => {
    // Python sends 0.3 as 0.30000001192092896. Before the fix that gave an
    // axis to 0.35, 0.1 one to 0.12, and a 0.3 + 0.1 stack one to 0.5.
    expect(zeroTicks(Math.fround(0.3), 5).top).toBe(0.3);
    expect(zeroTicks(Math.fround(0.1), 5).top).toBe(0.1);
    expect(zeroTicks(Math.fround(0.3) + Math.fround(0.1), 5).top).toBe(0.4);
    expect(fitZeroTicks(Math.fround(0.3), 300).top).toBe(0.3);
    // 0.7 as a float32 is a little below 0.7, which dropped its tick.
    expect(domainTicks(0, Math.fround(0.7), 7).ticks.at(-1)).toBe(0.7);
    // A value truly past a tick still takes the next step.
    expect(zeroTicks(0.3001, 5).top).toBeGreaterThan(0.3);
  });

  it("prints every tick of an axis in the unit the largest needs", () => {
    // Before the fix an axis read "800k, 1.0M" or "980k, 1.00M, 1.02M".
    expect(formatTicks([0, 2e5, 4e5, 6e5, 8e5, 1e6], 2e5)).toEqual([
      "0",
      "0.2M",
      "0.4M",
      "0.6M",
      "0.8M",
      "1.0M",
    ]);
    expect(formatTicks([980000, 1000000, 1020000], 20000)).toEqual([
      "0.98M",
      "1.00M",
      "1.02M",
    ]);
    expect(formatTicks([0, 5000, 10000, 15000, 20000], 5000)).toEqual([
      "0",
      "5k",
      "10k",
      "15k",
      "20k",
    ]);
    expect(formatTicks([0, 500, 1000, 1500], 500)).toEqual([
      "0",
      "500",
      "1000",
      "1500",
    ]);
    expect(formatTicks([0, 0.5, 1], 0.5, { percent: true })).toEqual([
      "0%",
      "50%",
      "100%",
    ]);
    expect(formatTicks([1, Number.NaN], 1)).toEqual(["1", "NA"]);
  });
});

describe("colour bar ticks far from 0", () => {
  // Narrow ranges far from 0. Before the fix the snap tolerance grew with
  // the value, so 150000123 to 150001123 got a tick at 150001200 or
  // 150000000, and 1000000 to 1000000.5 one at 1000000.6.
  const ranges = [
    [150000123, 150001123],
    [1000000, 1000000.5],
    [123456.7, 123457.3],
    [1000000.03, 1000000.47],
    [99999.95, 100000.45],
  ] as const;

  it("keeps every tick inside the range", () => {
    for (const [lo, hi] of ranges) {
      const sets = [1, 2, 3, 4, 5].map((n) => domainTicks(lo, hi, n).ticks);
      for (const len of [20, 60, 120, 200, 400]) {
        sets.push(fitDomainTicks(lo, hi, len).ticks);
      }
      for (const ticks of sets) {
        expect(ticks.length).toBeGreaterThan(0);
        for (const v of ticks) {
          expect(v, `${lo} to ${hi}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${lo} to ${hi}`).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it("still takes a float32 end for the tick it stands for", () => {
    // 0.7 as a float32 is 0.699999988; its tick is 0.7.
    expect(domainTicks(0, Math.fround(0.7), 7).ticks.at(-1)).toBe(0.7);
    expect(snapRatio(10000004.999999998)).toBe(10000005);
    expect(snapRatio(1500011.23)).toBe(1500011.23);
  });
});

describe("axis ticks fitted to their labels", () => {
  /** Width of a label at about 6 px a character. */
  const wide = (s: string) => 6 * s.length;

  it("labels a narrow range once per tick, at every zoom", () => {
    // A volcano y axis over 0 to 0.03, and an x axis zoomed to -0.015 to
    // 0.015. Before the fix the labels were rounded to 2 decimals and
    // repeated: "0.01, 0.01" and "0.03, 0.03".
    expect(fitAxisTicks(0, 0.03, 400, () => 11).labels).toEqual([
      "0.000",
      "0.005",
      "0.010",
      "0.015",
      "0.020",
      "0.025",
      "0.030",
    ]);
    const x = fitAxisTicks(-0.0165, 0.0165, 700, wide);
    expect(x.labels).toEqual([
      "-0.015",
      "-0.010",
      "-0.005",
      "0.000",
      "0.005",
      "0.010",
      "0.015",
    ]);
    expect(x.ticks).toEqual([-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015]);
  });

  it("takes fewer ticks when the labels would touch", () => {
    // Six intervals over -17 to 27 put labels 13 px wide 30 px from each
    // other on a 150 px axis, closer than they need.
    const t = fitAxisTicks(-17, 27, 150, wide, { maxCount: 6, gapPx: 8 });
    expect(t.ticks).toEqual([-10, 0, 10, 20]);
    expect(t.labels).toEqual(["-10", "0", "10", "20"]);
    const room = (t.step / 44) * 150;
    for (const s of t.labels) expect(room).toBeGreaterThanOrEqual(wide(s) + 8);
  });

  it("keeps every k-th tick when one interval is still too close", () => {
    const t = fitAxisTicks(0, 10, 20, () => 11, { gapPx: 5 });
    // Ticks at 0, 5 and 10 would sit 10 px from each other, for labels
    // that need 16.
    expect(t.ticks).toEqual([0, 10]);
    expect(t.labels).toEqual(["0", "10"]);
  });

  it("prints a flat range as its one value", () => {
    expect(fitAxisTicks(5, 5, 300, wide)).toEqual({
      ticks: [5],
      step: 0,
      labels: ["5"],
    });
  });
});
