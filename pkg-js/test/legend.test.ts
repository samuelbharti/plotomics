import { describe, expect, it } from "vitest";
import {
  fitLegend,
  legendCandidates,
  legendLabelsFit,
} from "../src/core/index.js";

describe("legend rows that fit the height", () => {
  it("lists every entry and the NA entry when they fit", () => {
    expect(fitLegend(3, true, 4, 14)).toEqual({
      shown: 3,
      more: 0,
      missing: true,
    });
    expect(fitLegend(0, true, 1)).toEqual({ shown: 0, more: 0, missing: true });
  });

  it("puts entries past the room or the cap into a +N more row, NA last", () => {
    expect(fitLegend(5, true, 5, 14)).toEqual({
      shown: 3,
      more: 2,
      missing: true,
    });
    expect(fitLegend(20, true, 30, 14)).toEqual({
      shown: 14,
      more: 6,
      missing: true,
    });
    expect(fitLegend(20, false, 30, 14)).toEqual({
      shown: 14,
      more: 6,
      missing: false,
    });
  });

  it("leaves out the NA entry, then the +N more row, before running over", () => {
    // Groups A, B and C and an ungrouped node in two rows: before the fix
    // the legend took three.
    expect(fitLegend(3, true, 2, 14)).toEqual({
      shown: 1,
      more: 2,
      missing: false,
    });
    expect(fitLegend(2, true, 2, 14)).toEqual({
      shown: 2,
      more: 0,
      missing: false,
    });
    expect(fitLegend(1, true, 1, 14)).toEqual({
      shown: 1,
      more: 0,
      missing: false,
    });
  });

  it("shows nothing when not one entry and its +N more row fit", () => {
    const none = { shown: 0, more: 0, missing: false };
    expect(fitLegend(3, false, 1, 14)).toEqual(none);
    expect(fitLegend(3, true, 0, 14)).toEqual(none);
    expect(fitLegend(3, true, -2, 14)).toEqual(none);
  });

  it("never uses more rows than it has", () => {
    for (let n = 0; n <= 20; n += 1) {
      for (const missing of [false, true]) {
        for (let rows = -1; rows <= 22; rows += 1) {
          const f = fitLegend(n, missing, rows, 14);
          const used = f.shown + (f.more ? 1 : 0) + (f.missing ? 1 : 0);
          expect(used).toBeLessThanOrEqual(Math.max(0, rows));
          expect(f.shown + f.more).toBe(f.shown ? n : 0);
          expect(f.shown).toBeLessThanOrEqual(14);
        }
      }
    }
  });
});

describe("legend labels in a narrow gutter", () => {
  // Outside a browser textWidth takes 0.58 em a character: 6.38 px at 11 px.
  const fits = (labels: string[], room: number) =>
    legendLabelsFit(labels, room, 11, "sans-serif");

  it("takes labels cut after three characters or more", () => {
    // "Cyt" and the ellipsis: four characters, 25.5 px.
    expect(fits(["Cytotoxic T cells", "B cells"], 26)).toBe(true);
    expect(fits(["Cytotoxic T cells", "B cells"], 25)).toBe(false);
  });

  it("takes a short label only whole", () => {
    expect(fits(["NA"], 13)).toBe(true);
    expect(fits(["NA"], 12)).toBe(false);
    expect(fits([], 0)).toBe(true);
  });
});

describe("legend labels at any height", () => {
  it("lists the labels the legend can show, the widest +N more row and NA", () => {
    expect(legendCandidates(["B", "C", "Wolfram cells"], true, 14)).toEqual([
      "B",
      "C",
      "Wolfram cells",
      "+2 more",
      "NA",
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(legendCandidates(many, false, 14)).toEqual([
      ...many.slice(0, 14),
      "+19 more",
    ]);
    expect(legendCandidates(["only"], false)).toEqual(["only"]);
  });
});
