import { describe, expect, it } from "vitest";
import { tipStart } from "../src/core/dom.js";

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
