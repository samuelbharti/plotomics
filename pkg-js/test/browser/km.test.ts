import { afterEach, describe, expect, it } from "vitest";
import { createKm } from "../../src/components/km.js";
import type { PlotomicsData, PlotomicsInstance } from "../../src/core/index.js";
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

/** Eight strata, some with long names, as in a table with two variables. */
const EIGHT_LONG = [
  "other",
  "Stage I adenocarcinoma, never smoker",
  "Stage II squamous, former smoker",
  "Stage III",
  "Stage IIIB",
  "Stage IV metastatic disease with brain involvement",
  "T4N2M0",
  "unknown",
];

/**
 * A km plot of `names`, each falling from 100% at its own pace, with
 * censoring ticks, a confidence band, a log-rank p and a risk table on
 * `riskTimes`.
 */
function strataData(
  names: readonly string[],
  riskTimes: number[] = [0, 200, 400, 600, 800, 1000],
): PlotomicsData {
  const time: number[] = [];
  const surv: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const group: string[] = [];
  const riskCounts: number[] = [];
  for (let g = 0; g < names.length; g += 1) {
    const name = names[g] as string;
    for (let k = 0; k <= 10; k += 1) {
      const s = Math.max(0.02, 1 - k * (0.06 + 0.012 * g));
      time.push(k * 100);
      surv.push(s);
      lower.push(Math.max(0, s - 0.1));
      upper.push(Math.min(1, s + 0.1));
      group.push(name);
    }
    for (let j = 0; j < riskTimes.length; j += 1) {
      riskCounts.push(Math.max(0, 140 - 7 * g - j * 6));
    }
  }
  return {
    columns: { time, surv, lower, upper, group },
    meta: {
      groups: [...names],
      riskTimes,
      riskCounts,
      censorTime: [150, 550],
      censorSurv: [0.9, 0.6],
      censorGroup: [names[0] as string, names[0] as string],
      pLabel: "log-rank p = 0.003",
    },
  };
}

/** The SVG texts of a plot. */
function svgTexts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

/** The curve panel, from the time axis line and the "100%" label. */
function panel(el: HTMLElement) {
  const axis = Array.from(el.querySelectorAll("svg line")).find(
    (l) =>
      l.getAttribute("y1") === l.getAttribute("y2") &&
      Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")) > 50,
  ) as SVGLineElement;
  const top = svgTexts(el).find((t) => t.textContent === "100%");
  const size = Number(top?.getAttribute("font-size"));
  return {
    x0: Number(axis.getAttribute("x1")),
    x1: Number(axis.getAttribute("x2")),
    y0: Number(top?.getAttribute("y")) - 0.35 * size,
    y1: Number(axis.getAttribute("y1")),
  };
}

/** The box of an SVG element, in the coordinates of the plot's layers. */
function boxIn(el: HTMLElement, node: Element) {
  const svg = el.querySelector("svg") as SVGSVGElement;
  const s = svg.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return {
    x0: r.left - s.left,
    x1: r.right - s.left,
    y0: r.top - s.top,
    y1: r.bottom - s.top,
  };
}

describe("km y ticks when y does not start at 0", () => {
  it("labels round percentages, each on its gridline", () => {
    // The lowest estimate is 25%, so the axis starts at 15%. Before the fix
    // the ticks sat at 15, 36.25, 57.5, 78.75 and 100% and read 15, 36, 58,
    // 79 and 100%.
    const el = container(800, 520);
    const km = createKm(el, {
      data: {
        columns: {
          time: [0, 10, 20, 30, 0, 10, 20, 30],
          surv: [1, 0.8, 0.5, 0.25, 1, 0.9, 0.7, 0.6],
          group: ["a", "a", "a", "a", "b", "b", "b", "b"],
        },
      },
      options: { yFromZero: false },
    });
    instances.push(km);
    const labels = Array.from(
      el.querySelectorAll('svg text[text-anchor="end"]'),
    ).filter((t) => /%$/.test(t.textContent ?? "")) as SVGTextElement[];
    expect(labels.map((t) => t.textContent)).toEqual([
      "20%",
      "40%",
      "60%",
      "80%",
      "100%",
    ]);
    // Each label is centred on its gridline, which the canvas draws at
    // time 25, where no curve crosses one.
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const ratio = canvas.width / canvas.clientWidth;
    const x = Math.round(tickX(el, "25") * ratio);
    for (const t of labels) {
      const y = Number(t.getAttribute("y")) - 0.35 * 11;
      const [r, g, b] = ctx.getImageData(x, Math.round(y * ratio), 1, 1).data;
      expect([r, g, b], t.textContent ?? "").toEqual([0xe5, 0xe7, 0xeb]);
    }
  });
});

describe("km risk table at short heights", () => {
  it("keeps every text inside the plot box, leaving the table out when it cannot fit", () => {
    // Before the fix the panel kept 40 px and the rows ran past the bottom
    // edge: below 160 px with 2 strata, 180 px with 4 and 240 px with 8.
    const cases: [string[], number[]][] = [
      [
        ["1", "2"],
        [140, 150],
      ],
      [
        ["0", "1", "2", "3"],
        [160, 170],
      ],
      [EIGHT_LONG, [200, 220, 230]],
    ];
    for (const [names, heights] of cases) {
      for (const h of heights) {
        const el = container(800, h);
        instances.push(createKm(el, { data: strataData(names) }));
        const box = (
          el.querySelector("canvas") as HTMLCanvasElement
        ).getBoundingClientRect();
        const outside = svgTexts(el)
          .filter((t) => {
            const r = t.getBoundingClientRect();
            return (
              r.top < box.top - 0.5 ||
              r.bottom > box.bottom + 0.5 ||
              r.left < box.left - 0.5 ||
              r.right > box.right + 0.5
            );
          })
          .map((t) => t.textContent);
        expect(outside, `${names.length} strata, ${h} px`).toEqual([]);
      }
    }
  });
});

describe("km time labels on a narrow axis", () => {
  it("thins the time labels and the counts under them so none run together", () => {
    // risk_times = seq(0, 1000, 50) at 400 px. Before the fix all 21 labels
    // and counts were drawn, as "0 50100150..." and "138128114102...".
    const times = Array.from({ length: 21 }, (_, i) => i * 50);
    const el = container(400, 520);
    instances.push(createKm(el, { data: strataData(["1", "2"], times) }));
    const numbers = (size: number) =>
      svgTexts(el).filter(
        (t) =>
          t.getAttribute("text-anchor") === "middle" &&
          /^\d+$/.test(t.textContent ?? "") &&
          Number(t.getAttribute("font-size")) === size,
      );
    const labels = numbers(11);
    const counts = numbers(9);
    expect(labels[0]?.textContent).toBe("0");
    expect(labels.length).toBeGreaterThan(3);
    expect(labels.length).toBeLessThan(21);
    /** Texts of one row whose letters come within 2 px of the next. */
    const crowded = (row: SVGTextElement[]) => {
      const spans = row
        .map((t) => {
          const x = Number(t.getAttribute("x"));
          const w = t.getComputedTextLength();
          return { s: t.textContent, x0: x - w / 2, x1: x + w / 2 };
        })
        .sort((a, b) => a.x0 - b.x0);
      const out: string[] = [];
      for (let i = 1; i < spans.length; i += 1) {
        const [a, b] = [spans[i - 1], spans[i]];
        if (a && b && b.x0 - a.x1 < 2) out.push(`${a.s}/${b.s}`);
      }
      return out;
    };
    expect(crowded(labels)).toEqual([]);
    const rows = new Map<string, SVGTextElement[]>();
    for (const c of counts) {
      const y = c.getAttribute("y") ?? "";
      rows.set(y, [...(rows.get(y) ?? []), c]);
    }
    expect(rows.size).toBe(2);
    const xs = labels.map((t) => t.getAttribute("x"));
    for (const row of rows.values()) {
      expect(crowded(row)).toEqual([]);
      // A count under each time label, centred on it.
      expect(row.map((t) => t.getAttribute("x"))).toEqual(xs);
    }
  });
});

describe("km legend", () => {
  it("keeps the legend off the curve panel with many long strata names", () => {
    // Before the fix the legend sat in the top-right corner of the panel
    // and, with eight strata at 400 px, covered the curves.
    for (const [w, h] of [
      [400, 520],
      [800, 520],
      [400, 300],
    ] as const) {
      const el = container(w, h);
      instances.push(createKm(el, { data: strataData(EIGHT_LONG) }));
      const p = panel(el);
      const covering = Array.from(el.querySelectorAll("svg text, svg rect"))
        .filter((n) => !(n.textContent ?? "").startsWith("log-rank"))
        .filter((n) => {
          const b = boxIn(el, n);
          return (
            b.x0 < p.x1 - 1 &&
            b.x1 > p.x0 + 1 &&
            b.y0 < p.y1 - 1 &&
            b.y1 > p.y0 + 1
          );
        })
        .map((n) => n.textContent || n.getAttribute("fill"));
      expect(covering, `${w} x ${h} px`).toEqual([]);
      // Every stratum is in the legend, or counted in its "+N more" note.
      const legend = svgTexts(el).filter(
        (t) => Number(t.getAttribute("y")) < p.y0,
      );
      const note = legend.find((t) => /^\+\d+ more$/.test(t.textContent ?? ""));
      const more = note ? Number(note.textContent?.slice(1, -5)) : 0;
      expect(legend.length - (note ? 1 : 0) + more, `${w} x ${h} px`).toBe(8);
      if (h === 300) expect(more).toBeGreaterThan(0);
    }
  });
});

describe("km at the smallest heights", () => {
  it("draws no text outside the plot box at any height", () => {
    // Before the fix the panel kept 40 px at any height, so in an element
    // shorter than about 115 px the time labels and the x title ran past
    // the bottom of the plot box, and below 75 px the survival labels too.
    const single: PlotomicsData = {
      columns: { time: [0, 300, 700, 1000], surv: [1, 0.8, 0.5, 0.3] },
      meta: { pLabel: "log-rank p = 0.003" },
    };
    const plots: [string, PlotomicsData][] = [
      ["one curve", single],
      ["2 strata", strataData(["1", "2"])],
      ["8 strata", strataData(EIGHT_LONG)],
    ];
    const outside: string[] = [];
    let drawn = 0;
    for (const fontSize of [12, 16]) {
      for (const [name, data] of plots) {
        // From an element with no room inside its padding upwards.
        for (let h = 20; h <= 200; h += 2) {
          const el = container(600, h);
          const km = createKm(el, { data, options: { theme: { fontSize } } });
          const box = (
            el.querySelector("canvas") as HTMLCanvasElement
          ).getBoundingClientRect();
          for (const t of svgTexts(el)) {
            if (!t.textContent) continue;
            drawn += 1;
            const r = t.getBoundingClientRect();
            if (
              r.top < box.top - 0.5 ||
              r.bottom > box.bottom + 0.5 ||
              r.left < box.left - 0.5 ||
              r.right > box.right + 0.5
            ) {
              outside.push(`${name}, ${fontSize}, ${h} px: "${t.textContent}"`);
            }
          }
          km.destroy();
          el.remove();
        }
      }
    }
    expect(drawn).toBeGreaterThan(1000);
    expect(outside.slice(0, 12), `${outside.length} texts outside`).toEqual([]);
  });

  it("drops the x title, then the time labels, before the panel shrinks", () => {
    const el = container(600, 105);
    instances.push(
      createKm(el, {
        data: { columns: { time: [0, 10], surv: [1, 0.5] } },
      }),
    );
    const shown = svgTexts(el).map((t) => t.textContent);
    // 85 px inside the padding: room for the time labels, not the title.
    expect(shown).not.toContain("time");
    expect(shown).toContain("10");
    expect(shown).toContain("100%");
  });
});
