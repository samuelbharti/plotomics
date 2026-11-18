import { afterEach, describe, expect, it } from "vitest";
import { createLollipop } from "../../src/components/lollipop.js";
import { createProfile } from "../../src/components/profile.js";
import { createUpset } from "../../src/components/upset.js";
import type { PlotomicsInstance } from "../../src/core/index.js";

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

  it("draws the bar labels at the tick label size", () => {
    const el = container();
    instances.push(createProfile(el, { data }));
    const lab = texts(el).find((t) => t.textContent === "A[C>A]A");
    expect(lab?.getAttribute("font-size")).toBe("9");
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
