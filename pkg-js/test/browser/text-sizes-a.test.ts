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
  textWidth,
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

/**
 * A hard case for a layout: long text, many rows or an odd size. `whole`
 * lists text that has room and must be drawn whole, not shortened.
 */
interface Stress {
  name: string;
  width: number;
  height: number;
  fontSize: number;
  make: Make;
  whole?: string[];
}

/** A km plot of `groups`, with a risk table on `times` unless `table` is false. */
function kmOf(
  groups: string[],
  o: {
    times?: number[];
    table?: boolean;
    pLabel?: string;
    xLabel?: string;
    yLabel?: string;
  } = {},
): Make {
  const times = o.times ?? [0, 10, 20, 30];
  const time: number[] = [];
  const surv: number[] = [];
  const group: string[] = [];
  const riskCounts: number[] = [];
  for (let g = 0; g < groups.length; g += 1) {
    for (let k = 0; k < times.length; k += 1) {
      time.push(times[k] as number);
      surv.push(1 - (k * (0.5 + 0.04 * g)) / times.length);
      group.push(groups[g] as string);
      riskCounts.push(Math.max(0, 150 - 10 * g - 30 * k));
    }
  }
  const table = o.table ?? true;
  return (el, theme) =>
    createKm(el, {
      data: {
        columns: { time, surv, group },
        meta: {
          groups,
          ...(table ? { riskTimes: times, riskCounts } : {}),
          ...(o.pLabel ? { pLabel: o.pLabel } : {}),
        },
      },
      options: {
        theme,
        ...(o.xLabel ? { xLabel: o.xLabel } : {}),
        ...(o.yLabel ? { yLabel: o.yLabel } : {}),
      },
    });
}

/** An UpSet plot of `n` sets: a column for each set, then for pairs of them. */
function upsetOf(n: number, yLabel?: string): Make {
  const sets = Array.from(
    { length: n },
    (_, i) => `GENE_SET_${String(i + 1).padStart(2, "0")}`,
  );
  const size: number[] = [];
  const membership: number[] = [];
  for (let i = 0; i < n; i += 1) {
    size.push(200 - 5 * i);
    for (let k = 0; k < n; k += 1) membership.push(k === i ? 1 : 0);
  }
  for (let i = 0; i + 1 < n; i += 2) {
    size.push(40 - i);
    for (let k = 0; k < n; k += 1) {
      membership.push(k === i || k === i + 1 ? 1 : 0);
    }
  }
  return (el, theme) =>
    createUpset(el, {
      data: {
        columns: { size },
        meta: {
          sets,
          setSizes: sets.map((_, i) => 300 - 7 * i),
          membership,
          total: 5000,
        },
      },
      options: { theme, ...(yLabel ? { yLabel } : {}) },
    });
}

/** A profile of the 96 contexts, with values multiplied by `scale`. */
function profileOf(o: {
  title?: string;
  scale?: number;
  yLabel?: string;
}): Make {
  const scale = o.scale ?? 1;
  return (el, theme) =>
    createProfile(el, {
      data: {
        columns: {
          value: SBS_LABELS.map((_, i) => (1 + ((i * 37) % 50)) * scale),
          group: SBS_LABELS.map((l) => l.slice(2, 5)),
          label: SBS_LABELS,
        },
        meta: o.title ? { title: o.title } : {},
      },
      options: { theme, ...(o.yLabel ? { yLabel: o.yLabel } : {}) },
    });
}

/** An oncoplot of `genes` by 20 samples, with two annotation strips. */
function oncoplotOf(
  o: {
    genes?: string[];
    strip?: string;
    classes?: string[];
    xLabel?: string;
    burdenLabel?: string;
  } = {},
): Make {
  const genes = o.genes ?? ONCO_GENES;
  return (el, theme) =>
    createOncoplot(el, {
      data: {
        columns: {
          codes: genes.flatMap((_, g) =>
            ONCO_SAMPLES.map((_, s) => {
              const v = (g * 7 + s * 3) % 7;
              return v > 4 ? 0 : v;
            }),
          ),
          tmb: ONCO_SAMPLES.map((_, s) => 1 + ((s * 5) % 17)),
          freq: genes.map((_, g) => Math.max(5, 80 - 12 * g)),
        },
        meta: {
          nrows: genes.length,
          ncols: ONCO_SAMPLES.length,
          genes,
          samples: ONCO_SAMPLES,
          classes: o.classes ?? [
            "Missense_Mutation",
            "Nonsense_Mutation",
            "Frame_Shift_Del",
            "Amplification",
          ],
          annotations: [
            {
              name: o.strip ?? "Subtype",
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
      options: {
        theme,
        ...(o.xLabel ? { xLabel: o.xLabel } : {}),
        ...(o.burdenLabel ? { burdenLabel: o.burdenLabel } : {}),
      },
    });
}

const LONG_CLASS =
  "Missense_Mutation_in_a_conserved_residue_of_the_kinase_domain";
const LOLLIPOP_LONG: Make = (el, theme) =>
  createLollipop(el, {
    data: {
      columns: {
        position: [40, 80],
        count: [5, 2],
        class: [LONG_CLASS, "Nonsense"],
      },
      meta: {
        length: 120,
        gene: "SOMEGENE",
        uniprot: "Q00000",
        classes: [LONG_CLASS, "Nonsense"],
      },
    },
    options: { theme, yLabel: "samples with a variant at this residue" },
  });
const TITIN: Make = (el, theme) =>
  createLollipop(el, {
    data: {
      columns: {
        position: [500, 12000, 30000],
        count: [3, 8, 2],
        class: ["Missense", "Nonsense", "Missense"],
      },
      meta: { length: 34350, gene: "TTN", classes: ["Missense", "Nonsense"] },
    },
    options: { theme },
  });

const EIGHT = Array.from({ length: 8 }, (_, i) => `group ${i + 1}`);
const LONG_STRATA = ["A", "B", "C"].map(
  (a) => `${a} arm, age over 65, stage III, ER positive`,
);
const LONG = "a title much longer than the plot is wide, to be shortened";

const STRESS: Stress[] = [
  // A long profile title.
  {
    name: "profile with a long title",
    width: 400,
    height: 380,
    fontSize: 12,
    make: profileOf({
      title: "Mutational profile of sample TCGA-AB-2803-03A (SBS96)",
    }),
  },
  // Many sets: every name is kept and fits its row.
  {
    name: "upset with 16 sets",
    width: 700,
    height: 520,
    fontSize: 16,
    make: upsetOf(16),
    whole: ["GENE_SET_01", "GENE_SET_16"],
  },
  {
    name: "upset with 22 sets",
    width: 700,
    height: 520,
    fontSize: 12,
    make: upsetOf(22),
    whole: ["GENE_SET_01", "GENE_SET_22"],
  },
  // Short UpSet plots: the y title stays clear of the "set size" title.
  { name: "upset", width: 700, height: 320, fontSize: 16, make: UPSET.make },
  { name: "upset", width: 700, height: 240, fontSize: 12, make: UPSET.make },
  // Eight strata in short plots: rows as tall as the names.
  {
    name: "km with 8 strata",
    width: 600,
    height: 260,
    fontSize: 12,
    make: kmOf(EIGHT, { pLabel: "log-rank p = 0.001" }),
  },
  {
    name: "km with 8 strata",
    width: 600,
    height: 300,
    fontSize: 12,
    make: kmOf(EIGHT),
  },
  {
    name: "km with 8 strata",
    width: 600,
    height: 360,
    fontSize: 16,
    make: kmOf(EIGHT, { pLabel: "log-rank p = 0.001" }),
  },
  {
    name: "km with 8 strata",
    width: 600,
    height: 400,
    fontSize: 16,
    make: kmOf(EIGHT),
  },
  // Long stratum names in the legend and the risk table.
  {
    name: "km with long stratum names",
    width: 400,
    height: 520,
    fontSize: 16,
    make: kmOf(LONG_STRATA),
  },
  {
    name: "km with long stratum names",
    width: 300,
    height: 520,
    fontSize: 12,
    make: kmOf(LONG_STRATA),
  },
  // A narrow lollipop: the axis title is shortened.
  {
    name: "lollipop",
    width: 300,
    height: 440,
    fontSize: 16,
    make: LOLLIPOP.make,
  },
  // Gene and strip names longer than the gene column may grow.
  {
    name: "oncoplot with a long gene id",
    width: 400,
    height: 560,
    fontSize: 12,
    make: oncoplotOf({
      genes: [
        ...ONCO_GENES.slice(0, 5),
        "ENSG00000141510_LONG_GENE_IDENTIFIER",
      ],
    }),
  },
  {
    name: "oncoplot with a long strip name",
    width: 600,
    height: 560,
    fontSize: 16,
    make: oncoplotOf({ strip: "Tumour subtype by PAM50 call on the RNA data" }),
  },
  // A large font size.
  { name: "km", width: 600, height: 520, fontSize: 24, make: KM.make },
  // Gutters and margins that grow with their labels.
  {
    name: "km with wide time labels",
    width: 600,
    height: 520,
    fontSize: 16,
    make: kmOf(["a", "b"], { times: [0, 2500, 5000, 7500, 10000] }),
  },
  {
    name: "km without a risk table",
    width: 600,
    height: 520,
    fontSize: 16,
    make: kmOf(["a", "b"], { table: false }),
  },
  {
    name: "lollipop of a long protein",
    width: 900,
    height: 440,
    fontSize: 16,
    make: TITIN,
  },
  {
    // Counts of 0.0001 to 0.005 give tick labels such as "0.005".
    name: "profile with long tick labels",
    width: 800,
    height: 380,
    fontSize: 16,
    make: profileOf({ scale: 0.0001 }),
  },
  {
    name: "oncoplot with a long gene name",
    width: 600,
    height: 560,
    fontSize: 12,
    make: oncoplotOf({
      genes: [...ONCO_GENES.slice(0, 5), "CDKN2A-DT_ANTISENSE"],
    }),
    whole: ["CDKN2A-DT_ANTISENSE"],
  },
  // Titles and legend entries longer than the plot.
  {
    name: "km with long titles",
    width: 400,
    height: 300,
    fontSize: 16,
    make: kmOf(["a", "b"], {
      table: false,
      pLabel: LONG,
      xLabel: LONG,
      yLabel: LONG,
    }),
  },
  {
    name: "lollipop with long text",
    width: 400,
    height: 300,
    fontSize: 16,
    make: LOLLIPOP_LONG,
  },
  {
    name: "profile with a long y title",
    width: 400,
    height: 200,
    fontSize: 16,
    make: profileOf({ yLabel: "single base substitutions per sample" }),
  },
  {
    name: "oncoplot with long text",
    width: 400,
    height: 560,
    fontSize: 16,
    make: oncoplotOf({
      classes: [LONG_CLASS, "Nonsense_Mutation", "Frame_Shift_Del", "Amp"],
      xLabel: "tumour samples in the discovery cohort",
      burdenLabel: "nonsynonymous mutations per sample",
    }),
  },
  {
    name: "upset with a long y title",
    width: 700,
    height: 240,
    fontSize: 16,
    make: upsetOf(4, "number of genes in the intersection"),
  },
];

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

/**
 * Check that no text leaves the element or overlaps other text, on a plot
 * drawn with the theme and on one that gets the theme through setOptions.
 * Each text in `whole` must be drawn whole.
 */
function checkLayout(
  width: number,
  height: number,
  make: Make,
  fontSize: number,
  whole: string[] = [],
) {
  const first = container(width, height);
  instances.push(make(first, { fontSize }));
  const later = container(width, height);
  const plot = make(later);
  instances.push(plot);
  plot.setOptions({ theme: { fontSize } });
  for (const el of [first, later]) {
    expect(texts(el).length).toBeGreaterThan(5);
    expect(outside(el)).toEqual([]);
    expect(overlaps(el)).toEqual([]);
    const shown = texts(el).map((t) => t.textContent);
    for (const s of whole) expect(shown).toContain(s);
  }
}

describe("text stays inside the element and clear of other text", () => {
  for (const c of CASES) {
    for (const fontSize of [12, 16]) {
      for (const width of [c.width, 400]) {
        it(`${c.name} at fontSize ${fontSize}, ${width} px wide`, () => {
          checkLayout(width, c.height, c.make, fontSize);
        });
      }
    }
  }

  for (const s of STRESS) {
    it(`${s.name}, ${s.width} x ${s.height}, fontSize ${s.fontSize}`, () => {
      checkLayout(s.width, s.height, s.make, s.fontSize, s.whole);
    });
  }
});

describe("textWidth", () => {
  it("measures at the size asked for when the canvas rejects the family", () => {
    // A family name with an unquoted number in it is not a valid CSS font,
    // so the canvas keeps the font it had.
    const family = "Source Sans 3, sans-serif";
    const small = textWidth("Missense_Mutation", 9, family);
    const large = textWidth("Missense_Mutation", 30, family);
    expect(large / small).toBeGreaterThan(3);
  });
});
