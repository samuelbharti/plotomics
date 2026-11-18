import { describe, expect, it } from "vitest";
import {
  formatTick,
  rangeTicks,
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
