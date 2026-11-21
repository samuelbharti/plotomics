/**
 * Synthetic data and specs for the dev harness demos that tests check: the
 * oncoplot cohort, the lollipop protein, the Kaplan-Meier arms, the Gosling
 * spec and the IGV genome. They sit in their own module, not in main.ts,
 * which mounts the page, so a test can import them without a page to mount
 * into.
 */
import type { IgvOptions } from "../src/components/igv-config.js";
import type { PlotomicsData } from "../src/core/index.js";

// Cohort-scale oncoplot: 60 genes x 1,200 samples is 72,000 cells, which is
// where per-cell DOM would fall over and canvas does not notice.
export function syntheticCohort(
  ngenes: number,
  nsamples: number,
): PlotomicsData {
  const classes = [
    "Missense",
    "Truncating",
    "Frameshift",
    "Splice",
    "In-frame indel",
    "Amplification",
    "Deep deletion",
    "Multi-hit",
  ];
  const tmb = new Float32Array(nsamples);
  const rows: { codes: Int16Array; hits: number }[] = [];
  for (let r = 0; r < ngenes; r += 1) {
    // Decaying prevalence, so the plot has the usual top-heavy shape.
    const p = 0.42 * Math.exp(-0.06 * r) + 0.02;
    const codes = new Int16Array(nsamples);
    let hits = 0;
    for (let c = 0; c < nsamples; c += 1) {
      if (Math.random() < p) {
        codes[c] = 1 + Math.floor(Math.random() * classes.length);
        tmb[c] = (tmb[c] as number) + 1;
        hits += 1;
      }
    }
    rows.push({ codes, hits });
  }
  // An oncoplot lists genes by how often they are altered. Sort by the
  // frequency the draws produced, not by the prevalence they were drawn
  // with, or neighbouring genes sit out of order next to their percentages.
  rows.sort((a, b) => b.hits - a.hits);
  const codes = new Int16Array(ngenes * nsamples);
  const freq = new Float32Array(ngenes);
  rows.forEach((row, r) => {
    codes.set(row.codes, r * nsamples);
    freq[r] = (100 * row.hits) / nsamples;
  });
  const subtypes = ["LumA", "LumB", "Basal", "Her2", "Normal"];
  const stages = ["I", "II", "III", "IV"];
  const subCodes = new Int16Array(nsamples);
  const stageCodes = new Int16Array(nsamples);
  for (let c = 0; c < nsamples; c += 1) {
    subCodes[c] = Math.floor(Math.random() * subtypes.length);
    stageCodes[c] = Math.floor(Math.random() * stages.length);
  }
  return {
    columns: { codes, tmb, freq },
    meta: {
      nrows: ngenes,
      ncols: nsamples,
      genes: Array.from({ length: ngenes }, (_, i) => `GENE${i + 1}`),
      samples: Array.from({ length: nsamples }, (_, i) => `TCGA-${i}`),
      classes,
      classColors: [
        "#0E7175",
        "#233038",
        "#C63F3E",
        "#ED773C",
        "#E4A25B",
        "#9E3F71",
        "#808BC5",
        "#245E55",
      ],
      annotations: [
        { name: "Subtype", levels: subtypes, codes: subCodes },
        { name: "Stage", levels: stages, codes: stageCodes },
      ],
    },
  };
}

/**
 * The hotspot residues of the synthetic TP53 below: the reference letter of
 * each and the missense changes drawn there. The first change of each is
 * drawn far more often than the others.
 */
export const proteinHotspots: Record<number, { ref: string; alts: string[] }> =
  {
    175: { ref: "R", alts: ["H", "C", "G"] },
    245: { ref: "G", alts: ["S", "D", "C"] },
    248: { ref: "R", alts: ["Q", "W", "L"] },
    273: { ref: "R", alts: ["H", "C", "L"] },
    282: { ref: "R", alts: ["W", "G"] },
  };

const AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";

/**
 * A made-up protein sequence, the same on every call: letters from a fixed
 * generator, with the hotspot residues set to their reference letters.
 * Index 0 is unused, so `seq[p]` is residue `p`.
 */
function syntheticSequence(length: number): string[] {
  const seq = [""];
  let x = 53;
  for (let p = 1; p <= length; p += 1) {
    x = (x * 16807) % 2147483647;
    seq.push(AMINO_ACIDS[x % AMINO_ACIDS.length] as string);
  }
  for (const [p, h] of Object.entries(proteinHotspots)) seq[Number(p)] = h.ref;
  return seq;
}

// A TP53-shaped protein: 393 residues, real domain bounds, a few recurrent
// changes at each hotspot in the DNA-binding domain and a long tail of
// one-off variants elsewhere. Each change is one row, its count summed over
// the draws that produced it, as in a cohort's mutation table.
export function syntheticProtein(nTail: number): PlotomicsData {
  const LEN = 393;
  const classes = ["Missense", "Truncating", "Frameshift", "Splice"];
  const seq = syntheticSequence(LEN);
  const rows = new Map<string, { p: number; cls: string; count: number }>();
  const add = (label: string, p: number, cls: string, count: number) => {
    const row = rows.get(label);
    if (row) row.count += count;
    else rows.set(label, { p, cls, count });
  };

  for (const [key, { alts }] of Object.entries(proteinHotspots)) {
    const p = Number(key);
    alts.forEach((alt, k) => {
      const count =
        k === 0
          ? 30 + Math.floor(Math.random() * 30)
          : 2 + Math.floor(Math.random() * 8);
      add(`${seq[p]}${p}${alt}`, p, "Missense", count);
    });
  }

  // Two thirds of the tail falls in the DNA-binding domain and the rest
  // anywhere, but not on a hotspot, which keeps its few changes. Most
  // variants are missense.
  for (let i = 0; i < nTail; i += 1) {
    let p: number;
    do {
      p =
        Math.random() < 2 / 3
          ? 100 + Math.floor(Math.random() * 189)
          : 1 + Math.floor(Math.random() * LEN);
    } while (p in proteinHotspots);
    const r = Math.random();
    const cls =
      r < 0.6
        ? "Missense"
        : r < 0.8
          ? "Truncating"
          : r < 0.93
            ? "Frameshift"
            : "Splice";
    const ref = seq[p] as string;
    let label: string;
    if (cls === "Missense") {
      let alt = ref;
      while (alt === ref) {
        alt = AMINO_ACIDS[
          Math.floor(Math.random() * AMINO_ACIDS.length)
        ] as string;
      }
      label = `${ref}${p}${alt}`;
    } else if (cls === "Truncating") label = `${ref}${p}*`;
    else if (cls === "Frameshift") label = `${ref}${p}fs`;
    else label = `X${p}_splice`;
    add(label, p, cls, 1);
  }

  const list = [...rows.entries()].sort((a, b) => a[1].p - b[1].p);
  const position = new Float32Array(list.map(([, row]) => row.p));
  const count = new Float32Array(list.map(([, row]) => row.count));
  const order = Array.from({ length: list.length }, (_, i) => i)
    .sort((a, b) => (count[b] as number) - (count[a] as number))
    .slice(0, 12)
    .sort((a, b) => a - b);
  return {
    columns: {
      position,
      count,
      class: list.map(([, row]) => row.cls),
      label: list.map(([label]) => label),
    },
    meta: {
      length: LEN,
      gene: "TP53",
      uniprot: "P04637",
      classes,
      classColors: ["#0E7175", "#233038", "#C63F3E", "#ED773C"],
      domains: [
        { name: "P53 transactivation motif", start: 6, end: 30 },
        { name: "Transactivation domain 2", start: 35, end: 59 },
        { name: "P53 DNA-binding domain", start: 100, end: 288 },
        { name: "P53 tetramerisation motif", start: 319, end: 357 },
      ],
      ptms: [15, 20, 37, 46, 315, 370, 373, 382, 392].map((p) => ({
        position: p,
        type: "phospho",
      })),
      labelIndex: order,
    },
  };
}

/** The end of follow-up in the Kaplan-Meier demo, in months. */
export const followUpEnd = 100;

/**
 * Three arms with different hazards, each estimated the way a real KM is: walk
 * the risk set down, drop the survival probability at events, tick at censors.
 * Doing it properly here, not drawing smooth curves, is what exercises the
 * step path and the risk table together.
 */
export function syntheticSurvival(): PlotomicsData {
  const arms = [
    { name: "high risk", n: 90, hazard: 0.055 },
    { name: "intermediate", n: 140, hazard: 0.03 },
    { name: "low risk", n: 170, hazard: 0.012 },
  ];
  const time: number[] = [];
  const surv: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const group: string[] = [];
  const censorTime: number[] = [];
  const censorSurv: number[] = [];
  const censorGroup: string[] = [];
  const riskTimes = [0, 20, 40, 60, 80, 100];
  const riskCounts: number[] = [];

  for (const arm of arms) {
    let atRisk = arm.n;
    let s = 1;
    let varSum = 0;
    time.push(0);
    surv.push(1);
    lower.push(1);
    upper.push(1);
    group.push(arm.name);
    const counts = riskTimes.map(() => 0);
    let next = 0;
    for (let t = 2; t <= followUpEnd && atRisk > 0; t += 2) {
      // The number at risk at a table time counts everyone still followed
      // then, including those with an event at that time.
      while (next < riskTimes.length && (riskTimes[next] as number) <= t) {
        counts[next] = atRisk;
        next += 1;
      }
      const events = Math.min(
        atRisk,
        Math.round(atRisk * arm.hazard * Math.random() * 2),
      );
      // Follow-up stops at the end, so everyone still at risk then is
      // censored there.
      const censored =
        t === followUpEnd
          ? atRisk - events
          : Math.min(
              atRisk - events,
              Math.round(atRisk * 0.012 * Math.random() * 2),
            );
      if (events > 0) {
        s *= 1 - events / atRisk;
        // Greenwood's variance, the standard pointwise band.
        varSum += events / (atRisk * (atRisk - events));
        const se = s * Math.sqrt(varSum);
        time.push(t);
        surv.push(s);
        group.push(arm.name);
        lower.push(Math.max(0, s - 1.96 * se));
        upper.push(Math.min(1, s + 1.96 * se));
      }
      if (censored > 0) {
        censorTime.push(t);
        censorSurv.push(s);
        censorGroup.push(arm.name);
      }
      atRisk -= events + censored;
    }
    riskCounts.push(...counts);
  }

  return {
    columns: { time, surv, lower, upper, group },
    meta: {
      groups: arms.map((a) => a.name),
      groupColors: ["#C63F3E", "#E4A25B", "#0E7175"],
      censorTime,
      censorSurv,
      censorGroup,
      riskTimes,
      riskCounts,
      pLabel: "log-rank p < 0.001",
    },
  };
}

// A minimal valid Gosling spec: one bar track over a public multivec tileset
// hosted by the Gosling team (data streams/tiles from the server).
export const goslingDemoSpec = {
  title: "Cistrome peaks",
  subtitle: "single multivec track streamed from the Gosling tile server",
  // Bind the width to the widget, so the track fills it.
  responsiveSize: { width: true },
  tracks: [
    {
      data: {
        url: "https://server.gosling-lang.org/api/v1/tileset_info/?d=cistrome-multivec",
        type: "multivec",
        row: "sample",
        column: "position",
        value: "peak",
        categories: ["sample 1"],
      },
      mark: "bar",
      x: { field: "start", type: "genomic", axis: "bottom" },
      xe: { field: "end", type: "genomic" },
      // Gosling draws the colour legend in the top-right corner, so the y
      // axis goes on the left, where its numbers do not print over the
      // legend's.
      y: { field: "peak", type: "quantitative", axis: "left" },
      color: { field: "peak", type: "quantitative", legend: true },
      width: 700,
      height: 200,
    },
  ],
};

// Files in dev/fixtures, served by the dev server (and by the browser test
// server) next to this module.
const fastaURL = new URL("./fixtures/demo.fa", import.meta.url).href;
const genesURL = new URL("./fixtures/demo-genes.bed", import.meta.url).href;
const signalURL = new URL("./fixtures/demo-signal.bedgraph", import.meta.url)
  .href;

/**
 * The genome viewer demo: a synthetic 6 kb reference with a gene track and a
 * signal track, all read from dev/fixtures, so the demo needs no network.
 * With `loadDefaultGenomes` off, igv.js does not ask igv.org for its genome
 * list either.
 */
export const igvDemoOptions: Partial<IgvOptions> = {
  config: {
    reference: {
      id: "demo",
      name: "synthetic 6 kb reference",
      fastaURL,
      indexed: false,
    },
    loadDefaultGenomes: false,
    locus: "chrDemo:1-6000",
    tracks: [
      {
        name: "genes (synthetic)",
        url: genesURL,
        format: "bed",
        type: "annotation",
      },
      {
        name: "signal (synthetic)",
        url: signalURL,
        format: "bedgraph",
        type: "wig",
        height: 100,
        color: "#0E7175",
      },
    ],
  },
};
