import { describe, expect, it, vi } from "vitest";
import {
  afterQuiet,
  baseDomains,
  boundView,
  createRenderLoop,
  isStartView,
  regionView,
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

describe("boundView", () => {
  /** A camera view that scales by `s` and moves by (tx, ty). */
  const view = (s: number, tx = 0, ty = 0) => {
    const v = new Float32Array(16);
    v[0] = s;
    v[5] = s;
    v[10] = 1;
    v[15] = 1;
    v[12] = tx;
    v[13] = ty;
    return v;
  };
  const home = Array.from(view(1));

  it("leaves the home view and a view inside it as they are", () => {
    const v = view(1);
    expect(boundView(v, 2, 2)).toBe(false);
    expect(Array.from(v)).toEqual(home);
    // Zoomed in 4 times and moved, still inside the home view.
    const w = view(4, 1.5, -2);
    expect(boundView(w, 2, 2)).toBe(false);
    expect(w[12]).toBe(1.5);
    expect(w[13]).toBe(-2);
  });

  it("takes a view zoomed out past home back to home, exactly", () => {
    for (const s of [0.5, 0.99999994, 1.0000001]) {
      const v = view(s, 0.3, -0.2);
      expect(boundView(v, 1.5, 1.5)).toBe(true);
      // Before the fix nothing kept the camera from zooming out.
      expect(
        isStartView({ get: () => v, set: async () => {}, reset() {} }),
      ).toBe(true);
    }
  });

  it("stops zooming in at 10,000 times the home view", () => {
    const v = view(1e6, 0, 0);
    expect(boundView(v, 1, 1)).toBe(true);
    expect(v[0]).toBe(1e4);
    expect(v[5]).toBe(1e4);
  });

  it("stops a pan at each edge of the home view", () => {
    // At 4 times, a plot area 2 wide per unit of height shows half a unit
    // each side of its centre in x, and a quarter in y, of a home view
    // from -2 to 2 and -1 to 1: the centre stays within 1.5 and 0.75.
    const s = 4;
    for (const [cx, cy, wantX, wantY] of [
      [-10, 0, -1.5, 0],
      [10, 0, 1.5, 0],
      [0, -10, 0, -0.75],
      [0, 10, 0, 0.75],
    ] as const) {
      const v = view(s, -cx * s, -cy * s);
      expect(boundView(v, 2, 2)).toBe(true);
      expect(-(v[12] as number) / s).toBeCloseTo(wantX, 6);
      expect(-(v[13] as number) / s).toBeCloseTo(wantY, 6);
      expect(v[0]).toBe(s);
      // A second pass finds it in place.
      expect(boundView(v, 2, 2)).toBe(false);
    }
  });

  it("centres an axis that shows more than the home view", () => {
    // After a resize to a plot area three times as wide as the one the
    // data was fitted to, x at 1.2 times shows more than all of it.
    const v = view(1.2, 0.5, 0.1);
    expect(boundView(v, 3, 1)).toBe(true);
    expect(v[12]).toBe(0);
    expect(v[13]).toBeCloseTo(0.1, 6);
  });

  it("takes out a turn of the view", () => {
    const v = view(2);
    const a = 0.3;
    v[0] = 2 * Math.cos(a);
    v[1] = 2 * Math.sin(a);
    v[4] = -2 * Math.sin(a);
    v[5] = 2 * Math.cos(a);
    expect(boundView(v, 1, 1)).toBe(true);
    expect(v[1]).toBe(0);
    expect(v[4]).toBe(0);
    expect(v[0]).toBeCloseTo(2, 6);
    expect(v[5]).toBeCloseTo(2, 6);
  });

  it("leaves a view it cannot read as it is", () => {
    const v = view(0);
    expect(boundView(v, 1, 1)).toBe(false);
    expect(boundView(view(2), 0, 1)).toBe(false);
    expect(boundView(view(2), 1, Number.NaN)).toBe(false);
  });
});

describe("regionView", () => {
  it("shows exactly a region of the same share on both axes", () => {
    // Base x 0 to 10 and y 0 to 4, on a plot area twice as wide as high.
    // x 2.5 to 5 is -0.5 to 0 in [-1, 1], half 0.25 of the 2 a unit of
    // height holds across, so a scale of 8; y 1 to 1.5 is -0.5 to -0.25,
    // half 0.125 of 1, a scale of 8 too.
    const v = regionView([2.5, 5], [1, 1.5], [0, 10], [0, 4], 2);
    expect(v[0]).toBeCloseTo(8, 6);
    expect(v[5]).toBeCloseTo(8, 6);
    expect(-(v[12] as number) / 8).toBeCloseTo(-0.25, 6);
    expect(-(v[13] as number) / 8).toBeCloseTo(-0.375, 6);
  });

  it("keeps all of the region in view, centred where it is", () => {
    const v = regionView([2, 4], [1, 2], [0, 10], [0, 4], 1);
    // x: -0.6 to -0.2 in [-1, 1], half 0.2, so s = 1 / 0.2 = 5 from x;
    // y: -0.5 to 0, half 0.25, so s = 4 from y. The smaller is 4.
    expect(v[0]).toBeCloseTo(4, 6);
    expect(v[5]).toBeCloseTo(4, 6);
    expect(-(v[12] as number) / 4).toBeCloseTo(-0.4, 6);
    expect(-(v[13] as number) / 4).toBeCloseTo(-0.25, 6);
    // What it shows holds the region on both axes.
    const s = v[0] as number;
    const cx = -(v[12] as number) / s;
    const cy = -(v[13] as number) / s;
    expect(cx - 1 / s).toBeLessThanOrEqual(-0.6 + 1e-6);
    expect(cx + 1 / s).toBeGreaterThanOrEqual(-0.2 - 1e-6);
    expect(cy - 1 / s).toBeLessThanOrEqual(-0.5 + 1e-6);
    expect(cy + 1 / s).toBeGreaterThanOrEqual(0 - 1e-6);
  });

  it("gives the home view for a region with no width", () => {
    const v = regionView([3, 3], [1, 2], [0, 10], [0, 4], 1);
    expect(isStartView({ get: () => v, set: async () => {}, reset() {} })).toBe(
      true,
    );
  });
});
