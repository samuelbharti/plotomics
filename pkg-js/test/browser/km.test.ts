import { afterEach, describe, expect, it } from "vitest";
import { createKm } from "../../src/components/km.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

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
});
