import { describe, expect, it, vi } from "vitest";
import {
  afterQuiet,
  baseDomains,
  boundView,
  createRenderLoop,
  isStartView,
  atView,
  frameView,
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
    expect(boundView(v, 2)).toBe(false);
    expect(Array.from(v)).toEqual(home);
    // Zoomed in 4 times and moved, still inside the home view.
    const w = view(4, 1.5, -2);
    expect(boundView(w, 2)).toBe(false);
    expect(w[12]).toBe(1.5);
    expect(w[13]).toBe(-2);
  });

  it("takes a view zoomed out past home back to home, exactly", () => {
    for (const s of [0.5, 0.99999994, 1.0000001]) {
      const v = view(s, 0.3, -0.2);
      expect(boundView(v, 1.5)).toBe(true);
      // Before the fix nothing kept the camera from zooming out.
      expect(
        isStartView({ get: () => v, set: async () => {}, reset() {} }),
      ).toBe(true);
    }
  });

  it("stops zooming in at 10,000 times the home view", () => {
    const v = view(1e6, 0, 0);
    expect(boundView(v, 1)).toBe(true);
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
      expect(boundView(v, 2)).toBe(true);
      expect(-(v[12] as number) / s).toBeCloseTo(wantX, 6);
      expect(-(v[13] as number) / s).toBeCloseTo(wantY, 6);
      expect(v[0]).toBe(s);
      // A second pass finds it in place.
      expect(boundView(v, 2)).toBe(false);
    }
  });

  it("centres an axis that shows all of the home view", () => {
    // A home view that shows x from -1 to 1 in a plot area three times as
    // wide as high: at an x scale of 3, the view shows all of it.
    const home = view(1);
    home[0] = 3;
    const v = view(3, 0.5, 0.1);
    expect(boundView(v, 3, home)).toBe(true);
    expect(v[12]).toBe(0);
    expect(v[13]).toBeCloseTo(0.1, 6);
  });

  it("bounds each axis by a home view that scales x and y each by its own factor", () => {
    // The home view shows x from 2 to 6 and y from -0.5 to 0.5 at aspect 1.
    const home = frameView([2, 6], [-0.5, 0.5], [-10, 10], [-1, 1], 1);
    // Zoomed out past it on both axes, the view stops at it on each.
    const out = view(0.1, 0, 0);
    expect(boundView(out, 1, home)).toBe(true);
    expect(atView(out, home)).toBe(true);
    // Zoomed in, a pan far left stops with the view's left edge at 2.
    const v = view(10, 0, 0);
    v[5] = 4;
    v[12] = 1000;
    expect(boundView(v, 1, home)).toBe(true);
    const left = (-1 - (v[12] as number)) / (v[0] as number);
    expect(left * 10).toBeCloseTo(2, 5);
    // The zoom on each axis stays.
    expect(v[0]).toBe(10);
    expect(v[5]).toBe(4);
  });

  it("leaves a view inside the bounds exactly as it is", () => {
    const home = frameView([2, 6], [-0.5, 0.5], [-10, 10], [-1, 1], 1);
    const v = view(10, -4, 0.1);
    v[5] = 4;
    const before = Array.from(v);
    expect(boundView(v, 1, home)).toBe(false);
    expect(Array.from(v)).toEqual(before);
  });

  it("takes out a turn of the view", () => {
    const v = view(2);
    const a = 0.3;
    v[0] = 2 * Math.cos(a);
    v[1] = 2 * Math.sin(a);
    v[4] = -2 * Math.sin(a);
    v[5] = 2 * Math.cos(a);
    expect(boundView(v, 1)).toBe(true);
    expect(v[1]).toBe(0);
    expect(v[4]).toBe(0);
    expect(v[0]).toBeCloseTo(2, 6);
    expect(v[5]).toBeCloseTo(2, 6);
  });

  it("leaves a view it cannot read as it is", () => {
    const v = view(0);
    expect(boundView(v, 1)).toBe(false);
    expect(boundView(view(2), 0)).toBe(false);
    expect(boundView(view(2), 1, view(Number.NaN))).toBe(false);
  });
});

describe("frameView", () => {
  it("is the start view right after a fit to the plot area", () => {
    const xShow: [number, number] = [-4, 4];
    const yShow: [number, number] = [0, 20];
    const [xBase, yBase] = baseDomains(xShow, yShow, 600, 400);
    const v = frameView(xShow, yShow, xBase, yBase, 1.5);
    expect(atView(v, view1())).toBe(true);
  });

  it("frames the fit of a new plot area over the old base domains", () => {
    // Fitted at 600 x 400; the plot area is now 300 x 400, and the fit
    // shows the same data, so x takes twice the scale of y.
    const xShow: [number, number] = [-4, 4];
    const yShow: [number, number] = [0, 20];
    const [xBase, yBase] = baseDomains(xShow, yShow, 600, 400);
    const v = frameView(xShow, yShow, xBase, yBase, 0.75);
    expect(v[0]).toBeCloseTo(0.5, 6);
    expect(v[5]).toBeCloseTo(1, 6);
    // It shows x from -4 to 4: (-a - tx) / sx, mapped back through xBase.
    const ndc = (-0.75 - (v[12] as number)) / (v[0] as number);
    const left = xBase[0] + ((ndc + 1) / 2) * (xBase[1] - xBase[0]);
    expect(left).toBeCloseTo(-4, 6);
  });

  it("gives the start view for a range with no width", () => {
    const v = frameView([3, 3], [1, 2], [0, 10], [0, 4], 1);
    expect(Array.from(v)).toEqual(view1());
  });
});

/** The start view, as a list. */
function view1(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
