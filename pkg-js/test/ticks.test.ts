import { describe, expect, it } from "vitest";
import {
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
