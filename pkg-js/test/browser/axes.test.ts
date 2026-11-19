import { afterEach, describe, expect, it } from "vitest";
import { createLollipop } from "../../src/components/lollipop.js";
import { createProfile } from "../../src/components/profile.js";
import { createUpset } from "../../src/components/upset.js";
import {
  type PlotomicsInstance,
  defaultTheme,
  textSizes,
} from "../../src/core/index.js";

function container(width = 700, height = 400) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function texts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

function hoverAt(el: HTMLElement, x: number, y: number): string {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: r.left + x,
      clientY: r.top + y,
      bubbles: true,
    }),
  );
  const tip = Array.from(el.children).find((c) => c.tagName === "DIV") as
    | HTMLElement
    | undefined;
  return tip && tip.style.opacity === "1" ? (tip.textContent ?? "") : "";
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("profile axis, title and bar labels", () => {
  const data = {
    columns: {
      value: [10, 2, 7, 4],
      group: ["C>A", "C>A", "C>G", "C>G"],
      label: ["A[C>A]A", "A[C>A]C", "A[C>G]A", "A[C>G]C"],
    },
    meta: { title: "Sample 1 (SBS96)" },
  };

  it("labels the y ticks with the values they sit on", () => {
    const el = container();
    instances.push(createProfile(el, { data }));
    const ticks = texts(el)
      .filter((t) => t.getAttribute("text-anchor") === "end")
      .map((t) => t.textContent)
      .filter((s) => s && /^\d/.test(s));
    expect(ticks).toEqual(["0", "2", "4", "6", "8", "10"]);
  });

  it("keeps the title inside the widget and above the strip", () => {
    const el = container();
    instances.push(createProfile(el, { data }));
    const title = texts(el).find(
      (t) => t.textContent === "Sample 1 (SBS96)",
    ) as SVGTextElement;
    const b = title.getBBox();
    expect(b.y).toBeGreaterThanOrEqual(0);
    // The strip's group names sit below the title row.
    const strip = texts(el).find(
      (t) => t.textContent === "C>A",
    ) as SVGTextElement;
    expect(b.y + b.height).toBeLessThanOrEqual(strip.getBBox().y);
    // Without the strip the title still stays inside.
    const bare = container();
    instances.push(
      createProfile(bare, { data, options: { showHeader: false } }),
    );
    const t2 = texts(bare).find((t) => t.textContent === "Sample 1 (SBS96)");
    expect((t2 as SVGTextElement).getBBox().y).toBeGreaterThanOrEqual(0);
  });

  it("cuts a bar label longer than the band under the axis", () => {
    const el = container(300, 300);
    instances.push(
      createProfile(el, {
        data: {
          columns: { value: [3, 5], label: ["chr1:1000000-2000000", "x"] },
        },
      }),
    );
    const lab = texts(el).find((t) => (t.textContent ?? "").startsWith("chr1"));
    const b = (lab as SVGTextElement).getBoundingClientRect();
    const box = el.getBoundingClientRect();
    expect(b.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
  });

  it("draws the bar labels at the small text size", () => {
    const el = container();
    instances.push(createProfile(el, { data }));
    const lab = texts(el).find((t) => t.textContent === "A[C>A]A");
    expect(lab?.getAttribute("font-size")).toBe(
      String(textSizes(defaultTheme).small),
    );
  });
});

describe("ticks on short or narrow plots", () => {
  /** Smallest gap between the baselines of right-aligned tick labels. */
  function minGap(el: HTMLElement): number {
    const ys = texts(el)
      .filter(
        (t) =>
          t.getAttribute("text-anchor") === "end" &&
          /^\d/.test(t.textContent ?? ""),
      )
      .map((t) => Number(t.getAttribute("y")))
      .sort((a, b) => a - b);
    let gap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < ys.length; i += 1) {
      gap = Math.min(gap, (ys[i] as number) - (ys[i - 1] as number));
    }
    return gap;
  }

  it("keeps profile tick labels clear of each other at 150 px", () => {
    const el = container(900, 150);
    instances.push(
      createProfile(el, {
        data: {
          columns: {
            value: [12.4, 3, 7],
            label: ["A[C>A]A", "A[C>A]C", "A[C>A]G"],
          },
          meta: { title: "Sample 1" },
        },
      }),
    );
    expect(minGap(el)).toBeGreaterThanOrEqual(12);
  });

  it("keeps UpSet tick labels clear of each other at 130 px", () => {
    const el = container(600, 130);
    instances.push(
      createUpset(el, {
        data: {
          columns: { size: [124, 50] },
          meta: { sets: ["A", "B"], membership: [1, 0, 0, 1] },
        },
      }),
    );
    expect(minGap(el)).toBeGreaterThanOrEqual(12);
  });

  it("keeps lollipop residue labels from touching on a 400 px plot", () => {
    const el = container(400, 300);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [130], count: [3] },
          meta: { length: 1680 },
        },
      }),
    );
    const boxes = texts(el)
      .filter(
        (t) =>
          t.getAttribute("text-anchor") === "middle" &&
          /^\d+$/.test(t.textContent ?? ""),
      )
      .map((t) => t.getBBox())
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < boxes.length; i += 1) {
      const prev = boxes[i - 1] as DOMRect;
      expect((boxes[i] as DOMRect).x).toBeGreaterThan(prev.x + prev.width);
    }
    expect(boxes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("upset axis and set names", () => {
  const long = "HALLMARK_OXIDATIVE_PHOSPHORYLATION";
  const data = {
    columns: { size: [250, 120, 40] },
    meta: {
      sets: [long, "B"],
      setSizes: [300, 160],
      membership: [1, 0, 0, 1, 1, 1],
    },
  };

  it("labels the bar ticks with the values they sit on", () => {
    const el = container();
    instances.push(createUpset(el, { data }));
    const ticks = texts(el)
      .filter((t) => t.getAttribute("text-anchor") === "end")
      .map((t) => t.textContent ?? "")
      .filter((s) => /^\d+$/.test(s));
    expect(ticks).toEqual(["0", "50", "100", "150", "200", "250"]);
  });

  it("shortens a long set name clear of the counts, with the full name on hover", () => {
    const el = container(500, 400);
    instances.push(createUpset(el, { data }));
    const name = texts(el).find((t) =>
      (t.textContent ?? "").startsWith("HALLMARK"),
    );
    expect(name?.textContent?.endsWith("…")).toBe(true);
    const count = texts(el).find(
      (t) => t.textContent === "300",
    ) as SVGTextElement;
    const nb = (name as SVGTextElement).getBBox();
    const cb = count.getBBox();
    expect(nb.x).toBeGreaterThanOrEqual(cb.x + cb.width);
    const y = Number((name as SVGTextElement).getAttribute("y")) - 3;
    expect(hoverAt(el, nb.x + nb.width / 2, y)).toContain(long);
  });

  it("names a set on hover when its size is missing", () => {
    const el = container(500, 400);
    instances.push(
      createUpset(el, {
        data: {
          columns: { size: [250, 120, 40] },
          meta: {
            sets: ["A", "B"],
            setSizes: [300, null] as unknown as number[],
            membership: [1, 0, 0, 1, 1, 1],
          },
        },
      }),
    );
    const b = texts(el).find((t) => t.textContent === "B") as SVGTextElement;
    const bb = b.getBBox();
    const y = Number(b.getAttribute("y")) - 3;
    expect(hoverAt(el, bb.x + bb.width / 2, y)).toBe("B");
  });
});

describe("lollipop residue axis", () => {
  it("never prints the last two residue labels on top of each other", () => {
    const el = container(700, 400);
    instances.push(
      createLollipop(el, {
        data: {
          columns: { position: [130], count: [3] },
          meta: { length: 403 },
        },
      }),
    );
    const ticks = texts(el).filter((t) => /^\d+$/.test(t.textContent ?? ""));
    const axis = ticks
      .filter((t) => t.getAttribute("text-anchor") === "middle")
      .map((t) => t.getBBox())
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < axis.length; i += 1) {
      const prev = axis[i - 1] as DOMRect;
      expect((axis[i] as DOMRect).x).toBeGreaterThan(prev.x + prev.width);
    }
  });
});

describe("upset number units", () => {
  it("prints the set sizes in the unit of the intersection axis", () => {
    // Before the fix the axis read "1.0M, 1.5M" and the set sizes
    // "2400k, 1950k".
    const el = container(600, 400);
    instances.push(
      createUpset(el, {
        data: {
          columns: { size: [1600000, 900000, 400000] },
          meta: {
            sets: ["A", "B"],
            setSizes: [2400000, 1950000],
            membership: [1, 0, 0, 1, 1, 1],
          },
        },
      }),
    );
    const all = texts(el).map((t) => t.textContent ?? "");
    expect(all).toContain("2.40M");
    expect(all).toContain("1.95M");
    expect(all.some((s) => /^[\d.]+k$/.test(s))).toBe(false);
    expect(all.filter((s) => /^[\d.]+M$/.test(s)).length).toBeGreaterThan(3);
  });
});

describe("upset set sizes in the axis unit", () => {
  const plot = (setSizes: number[], size: number[]) => {
    const el = container(600, 400);
    instances.push(
      createUpset(el, {
        data: {
          columns: { size },
          meta: {
            sets: ["A", "B", "C", "D"].slice(0, setSizes.length),
            setSizes,
            membership: size.flatMap((_, i) =>
              setSizes.map((_, k) => ((i + k) % 2 === 0 ? 1 : 0)),
            ),
          },
        },
      }),
    );
    return texts(el).map((t) => t.textContent ?? "");
  };

  it("prints the set sizes as the axis prints its ticks", () => {
    // Before the fix the set sizes read "5k" to "1k" beside an axis of
    // 0, 500, 1000 and on.
    const all = plot([5000, 3000, 2000, 1000], [2500, 1200, 800]);
    expect(all).toContain("1000");
    for (const s of ["5000", "3000", "2000"]) expect(all).toContain(s);
    expect(all.some((s) => /^[\d.]+k$/.test(s))).toBe(false);
  });

  it("keeps a fractional set size exact", () => {
    // Before the fix 2.5 printed "3".
    const all = plot([2.5, 4], [3, 2]);
    expect(all).toContain("2.5");
    expect(all).toContain("4.0");
  });
});
