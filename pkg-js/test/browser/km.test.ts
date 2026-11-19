import { afterEach, describe, expect, it } from "vitest";
import { createKm } from "../../src/components/km.js";
import type { PlotomicsInstance } from "../../src/core/index.js";
import { PLOTS } from "./plots.js";

function container(width = 600, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

/** x of the tick labelled `label` on the time axis. */
function tickX(el: HTMLElement, label: string): number {
  const t = Array.from(
    el.querySelectorAll('svg text[text-anchor="middle"]'),
  ).find((n) => n.textContent === label);
  return Number(t?.getAttribute("x"));
}

/** y of the survival tick labelled `label` (e.g. "50%"). */
function tickY(el: HTMLElement, label: string): number {
  const t = Array.from(el.querySelectorAll('svg text[text-anchor="end"]')).find(
    (n) => n.textContent === label,
  );
  return Number(t?.getAttribute("y")) - 3;
}

/** Hover the plot at time-axis x and return the tooltip text. */
function hoverAt(el: HTMLElement, x: number, y: number): string {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
    }),
  );
  return (
    Array.from(el.children).find((c) => c.tagName === "DIV")?.textContent ?? ""
  );
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("km in a browser", () => {
  it("draws each group from its own rows when the table is sorted by time", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 0, 5, 7, 12, 15],
          surv: [1, 1, 0.9, 0.8, 0.7, 0.5],
          group: ["T", "C", "T", "C", "T", "C"],
        },
        meta: { riskTimes: [0, 4, 8, 12, 16] },
      },
    });
    instances.push(km);
    // At t = 8, T is at 90% (its step at 5) and C at 80% (its step at 7).
    // Before the fix, T's curve ran through C's point at 7 and read 80%.
    const tip = hoverAt(el, tickX(el, "8"), tickY(el, "50%"));
    expect(tip).toContain("T 90%");
    expect(tip).toContain("C 80%");
  });

  it("keeps the confidence band on the axis when y does not start at 0", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 5, 10],
          surv: [1, 0.6, 0.42],
          lower: [1, 0.4, 0.2],
          upper: [1, 0.8, 0.65],
        },
      },
      options: { yFromZero: false },
    });
    instances.push(km);
    const percents = Array.from(
      el.querySelectorAll('svg text[text-anchor="end"]'),
    )
      .map((t) => t.textContent ?? "")
      .filter((s) => s.endsWith("%"))
      .map((s) => Number(s.slice(0, -1)));
    // The axis starts at or below the lowest band value, 20%.
    expect(Math.min(...percents)).toBeLessThanOrEqual(20);
  });

  it("runs a curve on to its last censored subject", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: { time: [0, 5, 10], surv: [1, 0.8, 0.6] },
        meta: {
          censorTime: [20],
          censorSurv: [0.6],
          riskTimes: [0, 5, 10, 15, 20],
        },
      },
      options: { showCI: false },
    });
    instances.push(km);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    // 60% sits 40% of the way from 50% to 75%.
    const y =
      tickY(el, "50%") + ((tickY(el, "75%") - tickY(el, "50%")) * 10) / 25;
    const x = tickX(el, "15");
    // Look a few pixels around the expected line for the curve colour.
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy += 1) {
      const [r, g, b] = ctx.getImageData(
        Math.round(x * ratio),
        Math.round((y + dy) * ratio),
        1,
        1,
      ).data;
      hit = !(r === 255 && g === 255 && b === 255);
    }
    // Before the fix the curve stopped at 10 and this spot was background.
    expect(hit).toBe(true);
  });

  it("gives long stratum names room in the risk table", () => {
    const el = container(500, 420);
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 10, 0, 10],
          surv: [1, 0.5, 1, 0.8],
          group: ["intermediate risk", "intermediate risk", "low", "low"],
        },
        meta: { riskTimes: [0, 10], riskCounts: [140, 70, 170, 136] },
      },
    });
    instances.push(km);
    const name = Array.from(el.querySelectorAll("svg text")).find(
      (t) => t.textContent === "intermediate risk",
    ) as SVGTextElement;
    const count = Array.from(el.querySelectorAll("svg text")).find(
      (t) => t.textContent === "140",
    ) as SVGTextElement;
    const nb = name.getBBox();
    const cb = count.getBBox();
    expect(nb.x).toBeGreaterThanOrEqual(0);
    expect(nb.x + nb.width).toBeLessThan(cb.x);
  });

  it("shortens a stratum name too long for the gutter", () => {
    const el = container(300, 420);
    const long =
      "a very long stratum name, as survfit makes with two variables";
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 10, 0, 10],
          surv: [1, 0.5, 1, 0.8],
          group: [long, long, "b", "b"],
        },
        meta: { riskTimes: [0, 5, 10], riskCounts: [10, 8, 5, 10, 9, 7] },
      },
    });
    instances.push(km);
    const name = Array.from(el.querySelectorAll("svg text")).find((t) =>
      t.textContent?.endsWith("…"),
    ) as SVGTextElement;
    expect(name).toBeDefined();
    expect(name.getBBox().x).toBeGreaterThanOrEqual(0);
    // The panel keeps most of the width: ticks 0 and 10 are far apart.
    expect(tickX(el, "10") - tickX(el, "0")).toBeGreaterThan(150);
  });

  it("draws the full stroke on the 100% line and a tick on the right edge", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: { time: [0, 10], surv: [1, 0.5] },
        meta: { censorTime: [3, 10], censorSurv: [1, 0.5] },
      },
      options: { showCI: false },
    });
    instances.push(km);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    const inked = (x: number, y: number) => {
      const [r, g, b] = ctx.getImageData(
        Math.floor(x * ratio),
        Math.floor(y * ratio),
        1,
        1,
      ).data;
      return !(r === 255 && g === 255 && b === 255);
    };
    const top = tickY(el, "100%");
    // The upper half of the 2 px line sits above the panel's top edge.
    expect(inked(tickX(el, "6"), top - 0.5)).toBe(true);
    // The upper half of the censoring tick at t = 3, on the 100% line.
    const x3 = tickX(el, "0") + ((tickX(el, "10") - tickX(el, "0")) * 3) / 10;
    expect(inked(x3, top - 3)).toBe(true);
    // The right half of the censoring tick at t = 10, the right edge.
    const y50 = tickY(el, "50%");
    expect(inked(tickX(el, "10") + 0.25, y50 - 3)).toBe(true);
  });

  it("prints uneven risk times in full", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: { time: [0, 10], surv: [1, 0.5] },
        meta: { riskTimes: [0, 1, 2.5, 5, 10] },
      },
    });
    instances.push(km);
    const labels = Array.from(
      el.querySelectorAll('svg text[text-anchor="middle"]'),
    )
      .map((t) => t.textContent)
      .filter((s) => s && /^[0-9.]+$/.test(s));
    expect(labels).toEqual(["0.0", "1.0", "2.5", "5.0", "10.0"]);
  });

  it("ignores a lower edge without an upper one for the y floor", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 5, 10],
          surv: [1, 0.8, 0.7],
          lower: [1, 0.4, 0.2],
        },
      },
      options: { yFromZero: false },
    });
    instances.push(km);
    const percents = Array.from(
      el.querySelectorAll('svg text[text-anchor="end"]'),
    )
      .map((t) => t.textContent ?? "")
      .filter((s) => s.endsWith("%"))
      .map((s) => Number(s.slice(0, -1)));
    // No band is drawn, so the axis fits the curve (70%) alone.
    expect(Math.min(...percents)).toBeGreaterThan(50);
  });

  it("does not run every curve on to censoring ticks without a stratum", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 5, 0, 10],
          surv: [1, 0.9, 1, 0.8],
          group: ["T", "T", "C", "C"],
        },
        meta: {
          censorTime: [20],
          censorSurv: [0.8],
          riskTimes: [0, 5, 10, 15, 20],
        },
      },
    });
    instances.push(km);
    const tip = hoverAt(el, tickX(el, "15"), tickY(el, "50%"));
    // T's rows end at 5, so there is no T estimate to show at 15.
    expect(tip).not.toContain("T 90%");
  });

  it("draws no curve or tick for a missing group, and hovers without an error", () => {
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.message);
    window.addEventListener("error", onError);
    try {
      const el = container();
      const km = createKm(el, {
        data: {
          columns: {
            time: [0, 2, 0, 2],
            surv: [1, 0.9, 1, 0.5],
            group: ["a", "a", null, null] as unknown as string[],
          },
          meta: {
            groups: ["a"],
            censorTime: [4, 4],
            censorSurv: [0.9, 0.5],
            censorGroup: ["a", null] as unknown as string[],
          },
        },
        options: { showCI: false },
      });
      instances.push(km);
      const canvas = el.querySelector("canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const ratio = canvas.width / canvas.clientWidth;
      // Ink is any colour but the white background and the grey of the
      // gridline, which the canvas draws under the curves.
      const inkAt = (x: number, y: number) => {
        for (let dy = -3; dy <= 3; dy += 1) {
          const [r, g, b] = ctx.getImageData(
            Math.round(x * ratio),
            Math.round((y + dy) * ratio),
            1,
            1,
          ).data;
          const white = r === 255 && g === 255 && b === 255;
          const grid = r === 0xe5 && g === 0xe7 && b === 0xeb;
          if (!white && !grid) return true;
        }
        return false;
      };
      // Before the fix the missing group ran on at 50% with a grey tick at 4.
      expect(inkAt(tickX(el, "3"), tickY(el, "50%"))).toBe(false);
      expect(inkAt(tickX(el, "4"), tickY(el, "50%"))).toBe(false);
      const tip = hoverAt(el, tickX(el, "3"), tickY(el, "50%"));
      expect(tip).toContain("a 90%");

      // Every group missing: no curve, and hovering throws nothing.
      const none = container();
      const empty = createKm(none, {
        data: {
          columns: {
            time: [0, 2],
            surv: [1, 0.5],
            group: [null, null] as unknown as string[],
          },
          meta: { groups: [] },
        },
      });
      instances.push(empty);
      hoverAt(none, 300, 150);
      expect(none.querySelector("svg")?.textContent).not.toContain("null");
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});

describe("km rows with a missing time or survival", () => {
  /** Whether the canvas has curve ink within 2 px of (x, y). */
  function inkNear(el: HTMLElement, x: number, y: number): boolean {
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    for (let dy = -2; dy <= 2; dy += 1) {
      const [r, g, b] = ctx.getImageData(
        Math.round(x * ratio),
        Math.round((y + dy) * ratio),
        1,
        1,
      ).data;
      const white = r === 255 && g === 255 && b === 255;
      const grid = r === 0xe5 && g === 0xe7 && b === 0xeb;
      if (!white && !grid) return true;
    }
    return false;
  }

  /** y at survival `v`, from the 50% and 75% tick positions. */
  function survY(el: HTMLElement, v: number): number {
    const y50 = tickY(el, "50%");
    const y75 = tickY(el, "75%");
    return y50 + ((v - 0.5) / 0.25) * (y75 - y50);
  }

  /** x at time `t`, from the 0 and 12 tick positions. */
  function timeX(el: HTMLElement, t: number): number {
    const x0 = tickX(el, "0");
    return x0 + ((tickX(el, "12") - x0) * t) / 12;
  }

  const riskTimes = [0, 2, 4, 6, 8, 10, 12];

  for (const [what, missing] of [
    ["NaN", Number.NaN],
    ["null, as R sends NA", null],
  ] as const) {
    it(`holds the step across a survival of ${what}`, () => {
      const el = container();
      const km = createKm(el, {
        data: {
          columns: {
            time: [0, 4, 8, 12],
            surv: [1, 0.8, missing, 0.4] as unknown as number[],
          },
          meta: { riskTimes },
        },
        options: { showCI: false },
      });
      instances.push(km);
      // The curve holds 80% from 4 to 12, then steps down to 40%. Before
      // the fix NaN drew a slope through 60% at 10, and null dropped the
      // curve to 0% at 8.
      expect(inkNear(el, timeX(el, 10), survY(el, 0.8))).toBe(true);
      expect(inkNear(el, timeX(el, 10), survY(el, 0.6))).toBe(false);
      expect(inkNear(el, timeX(el, 10), survY(el, 0))).toBe(false);
      expect(inkNear(el, timeX(el, 12), survY(el, 0.6))).toBe(true);
    });
  }

  for (const [what, missing] of [
    ["NaN", Number.NaN],
    ["null, as R sends NA", null],
  ] as const) {
    it(`leaves a gap in the band where a bound is ${what}`, () => {
      const el = container();
      const km = createKm(el, {
        data: {
          columns: {
            time: [0, 4, 8, 12],
            surv: [1, 0.8, 0.6, 0.4],
            lower: [1, 0.7, missing, 0.3] as unknown as number[],
            upper: [1, 0.9, 0.75, 0.5],
          },
          meta: { riskTimes },
        },
      });
      instances.push(km);
      // From 4 to 8 the band spans 70% to 90%.
      expect(inkNear(el, timeX(el, 6), survY(el, 0.85))).toBe(true);
      // From 8 to 12 the lower bound is missing: no band, and the curve
      // holds 60%. Before the fix null pulled the band down to 0 there, and
      // NaN drew it across the gap, through 70% at 10.
      expect(inkNear(el, timeX(el, 10), survY(el, 0.6))).toBe(true);
      expect(inkNear(el, timeX(el, 10), survY(el, 0.7))).toBe(false);
      expect(inkNear(el, timeX(el, 10), survY(el, 0.2))).toBe(false);
    });
  }

  it("sizes the time axis from the rows that are drawn", () => {
    // A row with no survival at time 100 is left out, and so is its time.
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 4, 8, 100],
          surv: [1, 0.8, 0.6, null] as unknown as number[],
        },
      },
      options: { showCI: false },
    });
    instances.push(km);
    const ticks = Array.from(
      el.querySelectorAll('svg text[text-anchor="middle"]'),
    )
      .map((t) => Number(t.textContent))
      .filter((v) => Number.isFinite(v));
    // Before the fix the time axis ran to 100.
    expect(ticks.length).toBeGreaterThan(1);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(10);
  });

  it("sets the survival floor from the rows that are drawn", () => {
    // A row with no time, low on the curve, does not lower the y axis.
    const low = container();
    const km2 = createKm(low, {
      data: {
        columns: {
          time: [0, 4, null, 8] as unknown as number[],
          surv: [1, 0.8, 0.05, 0.6],
        },
      },
      options: { showCI: false, yFromZero: false },
    });
    instances.push(km2);
    const percents = Array.from(
      low.querySelectorAll('svg text[text-anchor="end"]'),
    )
      .map((t) => t.textContent ?? "")
      .filter((s) => s.endsWith("%"))
      .map((s) => Number(s.slice(0, -1)));
    // Before the fix the axis ran from 0% to fit the 5% of the left-out row.
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(50);
  });

  it("leaves out a row with no time, and hovers at the step before it", () => {
    const el = container();
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 4, null, 12, 0, 6] as unknown as number[],
          surv: [1, 0.8, 0.6, 0.4, 1, 0.9],
          group: ["T", "T", "T", "T", "C", "C"],
        },
        meta: { riskTimes },
      },
      options: { showCI: false },
    });
    instances.push(km);
    // Before the fix the row with no time sorted to 0, so T read 60% from
    // the start and ran back and forth.
    expect(inkNear(el, timeX(el, 10), survY(el, 0.8))).toBe(true);
    expect(inkNear(el, timeX(el, 2), survY(el, 0.6))).toBe(false);
    const tip = hoverAt(el, timeX(el, 5), survY(el, 0.5));
    expect(tip).toContain("T 80%");
    expect(tip).toContain("C 100%");
  });
});

describe("km survival ticks on a short panel", () => {
  // The km of the padding tests: three strata and a risk table, which
  // leave a panel 40 px high in a widget of 200 or 160 px at a 16 px font.
  const km = PLOTS.find((p) => p.name === "km");

  /** The survival tick labels, top first. */
  const survival = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('svg text[text-anchor="end"]')).filter((t) =>
      /%$/.test(t.textContent ?? ""),
    ) as SVGTextElement[];

  it("keeps the labels clear at 200 and 160 px, with a gridline for each", () => {
    // Before the fix the five labels from 0 to 100% stayed, 10 px from each
    // other in a 40 px panel at a 16 px font.
    for (const height of [200, 160]) {
      const el = container(640, height);
      instances.push(
        km?.make(el, { fontSize: 16 }) as PlotomicsInstance<unknown>,
      );
      const labels = survival(el);
      expect(labels.map((t) => t.textContent)).toContain("100%");
      const ys = labels.map((t) => Number(t.getAttribute("y")));
      for (let i = 1; i < ys.length; i += 1) {
        // 14.7 px labels, with 2 px between them at the least.
        expect(
          Math.abs((ys[i] as number) - (ys[i - 1] as number)),
        ).toBeGreaterThanOrEqual(16.7);
      }
      // The canvas draws one gridline for each label, in a column at time
      // 19, where no curve crosses a tick.
      const canvas = el.querySelector("canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const ratio = canvas.width / canvas.clientWidth;
      const x = Math.floor(
        (tickX(el, "0") + 1.9 * (tickX(el, "10") - tickX(el, "0"))) * ratio,
      );
      const column = ctx.getImageData(x, 0, 1, canvas.height).data;
      let runs = 0;
      let inRun = false;
      for (let i = 0; i < column.length; i += 4) {
        const grid =
          column[i] === 0xe5 &&
          column[i + 1] === 0xe7 &&
          column[i + 2] === 0xeb;
        if (grid && !inRun) runs += 1;
        inRun = grid;
      }
      expect(runs, `${height} px`).toBe(labels.length);
    }
  });
});
