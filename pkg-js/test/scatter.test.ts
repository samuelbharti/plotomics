import { describe, expect, it, vi } from "vitest";
import {
  afterQuiet,
  baseDomains,
  createRenderLoop,
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

  it("merges requests made together, and requests made during a render", async () => {
    const calls: boolean[] = [];
    let finish: () => void = () => {};
    const loop = createRenderLoop(async (fit) => {
      calls.push(fit);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    // Made in the same task, as setData() then setOptions() are: one render.
    loop.request(true);
    loop.request(false);
    expect(calls).toEqual([]);
    await vi.waitFor(() => expect(calls).toEqual([true]));
    // Made while it runs: merged into one next render, which fits because
    // one of them asked.
    loop.request(false);
    loop.request(true);
    loop.request(false);
    finish();
    await vi.waitFor(() => expect(calls).toEqual([true, true]));
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([true, true]);
  });

  it("goes on after a failed render, and runs nothing after stop()", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: boolean[] = [];
    let fail = true;
    const loop = createRenderLoop(async (fit) => {
      calls.push(fit);
      if (fail) {
        fail = false;
        throw new Error("render failed");
      }
    });
    loop.request(true);
    await vi.waitFor(() => expect(quiet).toHaveBeenCalledTimes(1));
    loop.request(false);
    await vi.waitFor(() => expect(calls).toEqual([true, false]));
    loop.stop();
    loop.request(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([true, false]);
    quiet.mockRestore();
  });

  it("calls once, after the last of a run of calls has gone quiet", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const call = afterQuiet(fn, 100);
      for (let i = 0; i < 5; i += 1) {
        call();
        vi.advanceTimersByTime(50);
      }
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60);
      expect(fn).toHaveBeenCalledTimes(1);
      call();
      call.cancel();
      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
