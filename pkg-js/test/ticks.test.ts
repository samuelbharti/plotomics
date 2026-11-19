import { describe, expect, it } from "vitest";
import {
  domainTicks,
  fitDomainTicks,
  fitZeroTicks,
  formatTick,
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
