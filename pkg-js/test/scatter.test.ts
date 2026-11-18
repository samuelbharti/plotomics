import { describe, expect, it, vi } from "vitest";
import {
  baseDomains,
  createDrawQueue,
  isStartView,
  toNdc,
} from "../src/core/scatter.js";

describe("scatter helpers", () => {
  it("maps a domain onto [-1, 1]", () => {
    expect(Array.from(toNdc([5, 10, 15], [5, 15]))).toEqual([-1, 0, 1]);
    // Values outside the domain land outside [-1, 1].
    expect(Array.from(toNdc([0, 20], [5, 15]))).toEqual([-2, 2]);
  });

  it("does not divide by zero for an empty domain", () => {
    expect(Array.from(toNdc([3], [3, 3]))).toEqual([-1]);
  });

  it("keeps y and spreads x over [-w/h, w/h]", () => {
    // A 2:1 plot area: x has [-2, 2] to fill, so [-1, 1] stands for half
    // of the range to show.
    const [x, y] = baseDomains([0, 8], [-3, 3], 400, 200);
    expect(x).toEqual([2, 6]);
    expect(y).toEqual([-3, 3]);
    expect(Array.from(toNdc([0, 8], x))).toEqual([-2, 2]);
  });

  it("widens x on a tall plot area", () => {
    const [x] = baseDomains([0, 8], [-3, 3], 200, 400);
    expect(x).toEqual([-4, 12]);
  });

  it("treats a degenerate plot area as square", () => {
    expect(baseDomains([0, 8], [0, 1], 0, 0)).toEqual([
      [0, 8],
      [0, 1],
    ]);
  });

  it("recognises the starting camera view", () => {
    const at = (view: number[]) => ({
      set: async () => {},
      reset: () => {},
      get: () => view,
    });
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(isStartView(at(identity))).toBe(true);
    const zoomed = identity.slice();
    zoomed[0] = 2;
    zoomed[5] = 2;
    expect(isStartView(at(zoomed))).toBe(false);
    const panned = identity.slice();
    panned[12] = 0.3;
    expect(isStartView(at(panned))).toBe(false);
  });

  it("runs queued steps one after another, past a failed one", async () => {
    const queue = createDrawQueue();
    const log: string[] = [];
    const step = (name: string, ms: number) => async () => {
      log.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name} end`);
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    void queue(step("a", 20));
    void queue(async () => {
      throw new Error("b failed");
    });
    await queue(step("c", 0));
    expect(log).toEqual(["a start", "a end", "c start", "c end"]);
    expect(quiet).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});
