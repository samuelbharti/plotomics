import { afterEach, describe, expect, it } from "vitest";
import { createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createProfile } from "../../src/components/profile.js";
import { createUpset } from "../../src/components/upset.js";
import {
  type PlotomicsInstance,
  type PlotomicsTheme,
  textSizes,
} from "../../src/core/index.js";

// Text sizes of km, lollipop, oncoplot, upset and profile follow
// theme.fontSize, and their layouts make room for the text at any size.

type Make = (
  el: HTMLElement,
  theme?: Partial<PlotomicsTheme>,
) => PlotomicsInstance<unknown>;

/**
 * A test case: a component with data, at its usual size. The heights are
 * the default widget heights of the R and Python packages.
 */
interface Case {
  name: string;
  width: number;
  height: number;
  make: Make;
  /** Text that must be at the label size. */
  labels: string[];
  /** Text that must be at the axis title size. */
  titles: string[];
  /** Text that must be at the plot title size. */
  plotTitles?: string[];
}

const KM_GROUPS = ["low risk", "intermediate risk", "high risk"];
const KM: Case = {
  name: "km",
  width: 600,
  height: 520,
  make: (el, theme) =>
    createKm(el, {
      data: {
        columns: {
          time: [0, 5, 10, 20, 30, 0, 8, 16, 24, 30, 0, 6, 12, 18],
          surv: [
            1, 0.9, 0.8, 0.6, 0.5, 1, 0.85, 0.7, 0.55, 0.45, 1, 0.8, 0.6, 0.4,
          ],
          group: [
            ...new Array<string>(5).fill("low risk"),
            ...new Array<string>(5).fill("intermediate risk"),
            ...new Array<string>(4).fill("high risk"),
          ],
        },
        meta: {
          groups: KM_GROUPS,
          riskTimes: [0, 10, 20, 30],
          riskCounts: [120, 100, 80, 60, 140, 110, 85, 50, 90, 60, 30, 0],
          censorTime: [12, 26],
          censorSurv: [0.8, 0.55],
          censorGroup: ["low risk", "intermediate risk"],
          pLabel: "log-rank p = 0.02",
        },
      },
      options: { theme },
    }),
  labels: ["100%", "50%", "10", ...KM_GROUPS],
  titles: ["time", "overall survival", "number at risk"],
};

const LOLLIPOP: Case = {
  name: "lollipop",
  width: 900,
  height: 440,
  make: (el, theme) =>
    createLollipop(el, {
      data: {
        columns: {
          position: [175, 248, 273, 248, 245, 249, 337, 120],
          count: [25, 20, 18, 19, 9, 8, 4, 2],
          class: [
            "Missense",
            "Missense",
            "Missense",
            "Nonsense",
            "Missense",
            "Truncating",
            "Missense",
            "Truncating",
          ],
          label: [
            "R175H",
            "R248Q",
            "R273H",
            "R248*",
            "G245S",
            "R249fs",
            "R337H",
            "S120fs",
          ],
        },
        meta: {
          length: 393,
          gene: "TP53",
          uniprot: "P04637",
          classes: ["Missense", "Nonsense", "Truncating"],
          domains: [
            { name: "P53 transactivation motif", start: 6, end: 29 },
            { name: "P53 DNA-binding domain", start: 95, end: 288 },
            { name: "P53 tetramerisation motif", start: 318, end: 358 },
          ],
          ptms: [
            { position: 15, type: "Phospho" },
            { position: 20, type: "Phospho" },
            { position: 382, type: "Acetyl" },
          ],
          labelIndex: [0, 1, 2, 3, 4, 5, 6, 7],
        },
      },
      options: { theme },
    }),
  labels: ["1", "393", "0", "Missense", "Truncating"],
  titles: ["TP53 (P04637) - amino-acid position", "samples"],
};

const ONCO_GENES = ["TP53", "PIK3CA", "KRAS", "CDKN2A", "PTEN", "ARID1A"];
const ONCO_SAMPLES = Array.from({ length: 20 }, (_, i) => `S${i + 1}`);
const ONCOPLOT: Case = {
  name: "oncoplot",
  width: 600,
  height: 560,
  make: (el, theme) =>
    createOncoplot(el, {
      data: {
        columns: {
          codes: ONCO_GENES.flatMap((_, g) =>
            ONCO_SAMPLES.map((_, s) => {
              const v = (g * 7 + s * 3) % 7;
              return v > 4 ? 0 : v;
            }),
          ),
          tmb: ONCO_SAMPLES.map((_, s) => 1 + ((s * 5) % 17)),
          freq: [80, 65, 50, 35, 20, 10],
        },
        meta: {
          nrows: ONCO_GENES.length,
          ncols: ONCO_SAMPLES.length,
          genes: ONCO_GENES,
          samples: ONCO_SAMPLES,
          classes: [
            "Missense_Mutation",
            "Nonsense_Mutation",
            "Frame_Shift_Del",
            "Amplification",
          ],
          annotations: [
            {
              name: "Subtype",
              levels: ["Basal", "Her2", "LumA", "LumB"],
              codes: ONCO_SAMPLES.map((_, s) => s % 4),
            },
            {
              name: "Stage",
              levels: ["I", "II", "III"],
              codes: ONCO_SAMPLES.map((_, s) => s % 3),
            },
          ],
        },
      },
      options: { theme },
    }),
  labels: ["TP53", "ARID1A", "Subtype", "Missense_Mutation", "80%", "17"],
  titles: ["20 samples", "alterations"],
};

const UPSET: Case = {
  name: "upset",
  width: 700,
  height: 520,
  make: (el, theme) =>
    createUpset(el, {
      data: {
        columns: { size: [250, 180, 120, 95, 60, 41, 22, 9] },
        meta: {
          sets: [
            "HALLMARK_APOPTOSIS",
            "HALLMARK_HYPOXIA",
            "KEGG_P53_SIGNALING",
            "REACTOME_DNA_REPAIR",
          ],
          setSizes: [480, 390, 260, 205],
          membership: [
            1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1,
            0, 1, 1, 1, 0, 0, 1, 0, 1,
          ],
          total: 1200,
        },
      },
      options: { theme },
    }),
  labels: ["0", "HALLMARK_HYPOXIA", "480", "1,200 total"],
  titles: ["intersection size", "set size"],
};

const SUBS = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
const BASES = ["A", "C", "G", "T"];
const SBS_LABELS = SUBS.flatMap((s) =>
  BASES.flatMap((a) => BASES.map((b) => `${a}[${s}]${b}`)),
);
const PROFILE: Case = {
  name: "profile",
  width: 800,
  height: 380,
  make: (el, theme) =>
    createProfile(el, {
      data: {
        columns: {
          value: SBS_LABELS.map((_, i) => 1 + ((i * 37) % 50)),
          group: SBS_LABELS.map((l) => l.slice(2, 5)),
          label: SBS_LABELS,
        },
        meta: { title: "Sample 1 (SBS96)" },
      },
      options: { theme },
    }),
  labels: ["0", "C>A", "T>G"],
  titles: ["mutations"],
  plotTitles: ["Sample 1 (SBS96)"],
};

const CASES = [KM, LOLLIPOP, ONCOPLOT, UPSET, PROFILE];

function container(width: number, height: number) {
  const el = document.createElement("div");
  el.style.cssText = `width:${width}px;height:${height}px;`;
  document.body.appendChild(el);
  return el;
}

function texts(el: HTMLElement): SVGTextElement[] {
  return Array.from(el.querySelectorAll("svg text")) as SVGTextElement[];
}

/** The font size of the first text that reads `content`. */
function sizeOf(el: HTMLElement, content: string): number {
  const t = texts(el).find((n) => n.textContent === content);
  expect(t, `no text "${content}"`).toBeDefined();
  return Number(t?.getAttribute("font-size"));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The box of a text's letters: its advance width across, and one em from
 * 0.8 em above the baseline to 0.2 em below it. The font box that getBBox
 * reports also holds the space above and below the letters, which may
 * overlap between two rows of text without the letters touching.
 */
function letterBox(t: SVGTextElement): Box {
  const size = Number(t.getAttribute("font-size"));
  const x = Number(t.getAttribute("x"));
  const y = Number(t.getAttribute("y"));
  const w = t.getComputedTextLength();
  const anchor = t.getAttribute("text-anchor") ?? "start";
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const box = { x0, y0: y - 0.8 * size, x1: x0 + w, y1: y + 0.2 * size };
  if ((t.getAttribute("transform") ?? "").startsWith("rotate(-90")) {
    // A quarter turn anticlockwise about (x, y) moves (px, py) to
    // (x + py - y, y - px + x).
    return {
      x0: x + box.y0 - y,
      y0: y - (box.x1 - x),
      x1: x + box.y1 - y,
      y1: y - (box.x0 - x),
    };
  }
  return box;
}

/** Pairs of texts whose letters overlap by more than half a pixel. */
function overlaps(el: HTMLElement): string[] {
  const all = texts(el).map((t) => ({ t, b: letterBox(t) }));
  const out: string[] = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i]?.b as Box;
      const b = all[j]?.b as Box;
      if (
        a.x0 < b.x1 - 0.5 &&
        b.x0 < a.x1 - 0.5 &&
        a.y0 < b.y1 - 0.5 &&
        b.y0 < a.y1 - 0.5
      ) {
        out.push(`"${all[i]?.t.textContent}" / "${all[j]?.t.textContent}"`);
      }
    }
  }
  return out;
}

/** Texts whose font box reaches past the edge of the element. */
function outside(el: HTMLElement): string[] {
  const r = el.getBoundingClientRect();
  return texts(el)
    .filter((t) => {
      const b = t.getBoundingClientRect();
      return (
        b.left < r.left - 0.5 ||
        b.top < r.top - 0.5 ||
        b.right > r.right + 0.5 ||
        b.bottom > r.bottom + 0.5
      );
    })
    .map((t) => `"${t.textContent}"`);
}

let instances: PlotomicsInstance<unknown>[] = [];
afterEach(() => {
  for (const i of instances) i.destroy();
  instances = [];
  document.body.replaceChildren();
});

describe("text sizes follow theme.fontSize", () => {
  for (const c of CASES) {
    for (const fontSize of [12, 16]) {
      it(`${c.name} at fontSize ${fontSize}`, () => {
        const sizes = textSizes({ fontSize });
        const check = (el: HTMLElement) => {
          for (const s of c.labels) expect(sizeOf(el, s)).toBe(sizes.label);
          for (const s of c.titles) {
            expect(sizeOf(el, s)).toBe(sizes.axisTitle);
          }
          for (const s of c.plotTitles ?? []) {
            expect(sizeOf(el, s)).toBe(sizes.title);
          }
        };
        const el = container(c.width, c.height);
        instances.push(c.make(el, { fontSize }));
        check(el);
        // The same sizes after a theme change through setOptions.
        const later = container(c.width, c.height);
        const plot = c.make(later);
        instances.push(plot);
        plot.setOptions({ theme: { fontSize } });
        check(later);
      });
    }
  }

  it("draws the risk-table counts and the bar labels at the small size", () => {
    const small = textSizes({ fontSize: 16 }).small;
    const km = container(KM.width, KM.height);
    instances.push(KM.make(km, { fontSize: 16 }));
    expect(sizeOf(km, "140")).toBe(small);
    const profile = container(PROFILE.width, PROFILE.height);
    instances.push(PROFILE.make(profile, { fontSize: 16 }));
    expect(sizeOf(profile, "A[C>A]A")).toBe(small);
  });
});

describe("text stays inside the element and clear of other text", () => {
  for (const c of CASES) {
    for (const fontSize of [12, 16]) {
      for (const width of [c.width, 400]) {
        it(`${c.name} at fontSize ${fontSize}, ${width} px wide`, () => {
          const el = container(width, c.height);
          instances.push(c.make(el, { fontSize }));
          expect(texts(el).length).toBeGreaterThan(5);
          expect(outside(el)).toEqual([]);
          expect(overlaps(el)).toEqual([]);
        });
      }
    }
  }
});
