import { describe, expect, it } from "vitest";
import { tipPosition, tipStart } from "../src/core/dom.js";

// Where a tooltip goes along one side of a widget: past the pointer, before
// it near the end, and inside the widget when neither side has the room.

describe("tipStart", () => {
  it("puts the tooltip 12 px past the pointer when it fits there", () => {
    expect(tipStart(100, 80, 400)).toBe(112);
    expect(tipStart(0, 80, 400)).toBe(12);
    // Ending on the far edge still fits.
    expect(tipStart(308, 80, 400)).toBe(320);
  });

  it("puts the tooltip 12 px before the pointer near the far edge", () => {
    expect(tipStart(390, 80, 400)).toBe(298);
    expect(tipStart(309, 80, 400)).toBe(217);
  });

  it("keeps the tooltip inside the widget when neither side has the room", () => {
    // 120 px long at the middle of a 200 px widget: against the far edge.
    expect(tipStart(100, 120, 200)).toBe(80);
    // Longer than the widget: from its start.
    expect(tipStart(100, 250, 200)).toBe(0);
    expect(tipStart(5, 80, 0)).toBe(0);
  });
});

describe("tipPosition", () => {
  /** Whether the tooltip at `p`, `w` x `h` px, covers the point (x, y). */
  const covers = (
    p: { left: number; top: number },
    w: number,
    h: number,
    x: number,
    y: number,
  ) => p.left <= x && x <= p.left + w && p.top <= y && y <= p.top + h;

  it("places each side as tipStart does when that clears the pointer", () => {
    expect(tipPosition(100, 50, 80, 40, 400, 300)).toEqual({
      left: 112,
      top: 62,
    });
    expect(tipPosition(390, 290, 80, 40, 400, 300)).toEqual({
      left: 298,
      top: 238,
    });
    // Too wide for either side, but it fits below: kept inside across.
    expect(tipPosition(150, 20, 250, 40, 300, 300)).toEqual({
      left: 50,
      top: 32,
    });
  });

  it("moves off the pointer when it fits on no side of it", () => {
    // Before, it was clamped inside along each side, over the pointer.
    for (const [w, h, roomW, roomH] of [
      [160, 92, 160, 100],
      [300, 100, 300, 120],
      [200, 120, 200, 150],
    ] as const) {
      const x = roomW / 2;
      const y = roomH / 2;
      const p = tipPosition(x, y, w, h, roomW, roomH);
      expect(covers(p, w, h, x, y), `${roomW} x ${roomH}`).toBe(false);
      // It stays inside the widget across, and leaves it on one side.
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left + w).toBeLessThanOrEqual(roomW);
    }
  });

  it("moves below or above, never sideways past the widget", () => {
    // A 600 x 140 widget, pointer at its centre, a 320 x 92 tooltip: right
    // runs 32 px past the widget and below 34. Before, it went right, which
    // can give the page a horizontal scroll.
    expect(tipPosition(300, 70, 320, 92, 600, 140)).toEqual({
      left: 280,
      top: 82,
    });
  });

  it("leaves the widget on the side where it runs past the least", () => {
    // Pointer near the top: below runs 34 px past, above 74.
    expect(tipPosition(80, 30, 160, 92, 160, 100).top).toBe(42);
    // Pointer near the bottom: above runs past the least.
    expect(tipPosition(80, 80, 160, 92, 160, 100).top).toBe(-24);
  });
});
