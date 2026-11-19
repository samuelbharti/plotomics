import { createClustermap } from "../../src/components/clustermap.js";
import { createDotplot } from "../../src/components/dotplot.js";
import { createEmbedding } from "../../src/components/embedding.js";
import { createHeatmap } from "../../src/components/heatmap.js";
import { createHic } from "../../src/components/hic.js";
import { createKm } from "../../src/components/km.js";
import { createLollipop } from "../../src/components/lollipop.js";
import { createNetwork } from "../../src/components/network.js";
import { createOncoplot } from "../../src/components/oncoplot.js";
import { createProfile } from "../../src/components/profile.js";
import { createSpatial } from "../../src/components/spatial.js";
import { createTreemap } from "../../src/components/treemap.js";
import { createUpset } from "../../src/components/upset.js";
import { createViolin } from "../../src/components/violin.js";
import { createVolcano } from "../../src/components/volcano.js";
import type {
  PlotomicsData,
  PlotomicsInstance,
  PlotomicsTheme,
} from "../../src/core/index.js";

// Each of the 15 components with data that draws all of its parts: axes,
// titles, legends, colour bars, a risk table, banners and dendrograms, and
// the spatial colour bar and network legend besides. The heights are the
// default widget heights of the R and Python packages.

type Theme = Partial<PlotomicsTheme>;

export interface Plot {
  name: string;
  /** The default widget height in R and Python. */
  height: number;
  make(el: HTMLElement, theme?: Theme): PlotomicsInstance<unknown>;
  /**
   * The plot for hover tests, when the one above has marks too small or too
   * few for a grid of points to land on: larger points, more nodes.
   */
  hoverMake?(el: HTMLElement, theme?: Theme): PlotomicsInstance<unknown>;
}

/** Deterministic values spread over [lo, hi]. */
function spread(n: number, lo: number, hi: number, seed: number) {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  });
}

const two = (i: number) => String(i + 1).padStart(2, "0");

function matrix(nrows: number, ncols: number): PlotomicsData {
  const values = Float64Array.from(
    { length: nrows * ncols },
    (_, k) => Math.sin(k * 0.37) * 3 + (k % 7),
  );
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => `GENE_${two(i)}`),
      colLabels: Array.from({ length: ncols }, (_, i) => `sample_${two(i)}`),
    },
  };
}

const GENES = ["CD3E", "MS4A1", "LYZ", "NKG7", "HLA-DRA", "PPBP", "GNLY"];
const GROUPS = [
  "T cells",
  "B cells",
  "CD14 Monocytes",
  "NK cells",
  "Dendritic cells",
  "Platelets",
];

function dotplotData(): PlotomicsData {
  const gene: string[] = [];
  const cluster: string[] = [];
  const pct: number[] = [];
  const value: number[] = [];
  GENES.forEach((g, i) => {
    GROUPS.forEach((c, j) => {
      gene.push(g);
      cluster.push(c);
      pct.push(10 + ((i * 37 + j * 23) % 90));
      value.push(((i * 7 + j * 3) % 10) / 3);
    });
  });
  return {
    columns: { gene, cluster, pct, value },
    meta: { valueLabel: "mean expression" },
  };
}

function violinData(): PlotomicsData {
  const feats = GENES.slice(0, 5);
  const feature: string[] = [];
  const group: string[] = [];
  const density: number[] = [];
  const median: number[] = [];
  const n = 21;
  feats.forEach((f, i) => {
    GROUPS.forEach((g, j) => {
      feature.push(f);
      group.push(g);
      const peak = ((i + j) % 5) / 5;
      for (let k = 0; k < n; k += 1) {
        density.push(Math.exp(-(((k / (n - 1) - peak) / 0.2) ** 2)));
      }
      median.push(peak * (i + 1) * 2.5);
    });
  });
  const grids: number[] = [];
  feats.forEach((_, i) => {
    for (let k = 0; k < n; k += 1) grids.push((k / (n - 1)) * (i + 1) * 2.5);
  });
  return {
    columns: { feature, group },
    meta: {
      grid: Array.from({ length: n }, (_, k) => k / (n - 1)),
      grids,
      density,
      median,
    },
  };
}

function hicData(n = 64, binSize = 10_000): PlotomicsData {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1)
      values[r * n + c] = 1000 / (Math.abs(r - c) + 1);
  }
  return { columns: { values }, meta: { n, binSize } };
}

const KM_GROUPS = ["low risk", "intermediate risk", "high risk"];
function kmData(): PlotomicsData {
  return {
    columns: {
      time: [0, 5, 10, 20, 30, 0, 8, 16, 24, 30, 0, 6, 12, 18],
      surv: [1, 0.9, 0.8, 0.6, 0.5, 1, 0.85, 0.7, 0.55, 0.45, 1, 0.8, 0.6, 0.4],
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
  };
}

function lollipopData(): PlotomicsData {
  return {
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
  };
}

const ONCO_GENES = ["TP53", "PIK3CA", "KRAS", "CDKN2A", "PTEN", "ARID1A"];
const ONCO_SAMPLES = Array.from({ length: 20 }, (_, i) => `S${i + 1}`);
function oncoplotData(): PlotomicsData {
  return {
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
  };
}

function upsetData(): PlotomicsData {
  return {
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
        1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0,
        1, 1, 1, 0, 0, 1, 0, 1,
      ],
      total: 1200,
    },
  };
}

const SUBS = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
const BASES = ["A", "C", "G", "T"];
const SBS = SUBS.flatMap((s) =>
  BASES.flatMap((a) => BASES.map((b) => `${a}[${s}]${b}`)),
);
function profileData(): PlotomicsData {
  return {
    columns: {
      value: SBS.map((_, i) => 1 + ((i * 37) % 50)),
      group: SBS.map((l) => l.slice(2, 5)),
      label: SBS,
    },
    meta: { title: "Sample 1 (SBS96)" },
  };
}

function volcanoData(): PlotomicsData {
  const x = spread(2000, -4, 4, 1);
  const y = spread(2000, 0, 20, 2);
  return { columns: { x, y, label: x.map((_, i) => `G${i}`) } };
}

const CLUSTERS = [
  "B cells",
  "CD4 T cells",
  "CD8 T cells",
  "NK cells",
  "Monocytes",
  "Dendritic cells",
  "Platelets",
  "Plasmablasts",
];
function embeddingData(): PlotomicsData {
  const x = spread(800, -8, 12, 3);
  const y = spread(800, -6, 9, 4);
  const color = x.map((_, i) => CLUSTERS[i % CLUSTERS.length] as string);
  return { columns: { x, y, color } };
}

const REGIONS = ["Tumour", "Stroma", "Immune infiltrate", "Normal epithelium"];
/** Spots coloured by region, or by a value with a missing one. */
function spatialData(continuous = false): PlotomicsData {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      x.push(5 + i * 10);
      y.push(5 + j * 10);
    }
  }
  const color = continuous
    ? x.map((v, i) => (i % 17 === 0 ? null : v * 12.5))
    : x.map((_, i) => REGIONS[i % REGIONS.length] as string);
  return {
    columns: { x, y, color: color as string[] },
    meta: { imgWidth: 160, imgHeight: 100, spotDiameter: 8 },
  };
}

const NET = [
  "TP53",
  "MDM2",
  "CDKN1A",
  "BRCA1",
  "ATM",
  "CHEK2",
  "RB1",
  "E2F1",
  "MYC",
  "PTEN",
  "AKT1",
  "EGFR",
];
/** Twelve genes on a ring, with a legend of three pathways when grouped. */
function networkData(grouped = false): PlotomicsData {
  const n = NET.length;
  const pathways = ["p53 pathway", "Cell cycle", "PI3K signalling"];
  return {
    columns: {
      id: NET,
      x: NET.map((_, i) => Math.cos((2 * Math.PI * i) / n) * 10),
      y: NET.map((_, i) => Math.sin((2 * Math.PI * i) / n) * 10),
      size: NET.map(() => 10),
    },
    meta: {
      edges: NET.map((g, i) => [g, NET[(i + 1) % n]]),
      ...(grouped
        ? { nodeGroup: NET.map((_, i) => pathways[i % 3] as string) }
        : {}),
    },
  };
}

/** 96 large nodes on a 12 x 8 lattice, for hover tests. */
function latticeData(): PlotomicsData {
  const id = Array.from({ length: 96 }, (_, i) => `N${i}`);
  return {
    columns: {
      id,
      x: id.map((_, i) => i % 12),
      y: id.map((_, i) => Math.floor(i / 12)),
      size: id.map(() => 16),
    },
    meta: { edges: id.slice(1).map((s, i) => [s, id[i]]) },
  };
}

function treemapData(): PlotomicsData {
  const id = ["root", "P1", "P2", "P3"];
  const parent = ["", "root", "root", "root"];
  const value = [0, 0, 0, 0];
  const labels = [
    "All pathways",
    "Oxidative phosphorylation",
    "Cell cycle checkpoints",
    "Interferon gamma response",
  ];
  for (let i = 0; i < 24; i += 1) {
    id.push(`g${i}`);
    parent.push(`P${(i % 3) + 1}`);
    value.push(((i * 7) % 11) + 2);
    labels.push(`GENE${i}A`);
  }
  return { columns: { id, parent, value }, meta: { labels } };
}

const o = (theme?: Theme) => ({ theme: theme ?? {} });

export const PLOTS: Plot[] = [
  {
    name: "volcano",
    height: 480,
    make: (el, t) => createVolcano(el, { data: volcanoData(), options: o(t) }),
    hoverMake: (el, t) =>
      createVolcano(el, {
        data: volcanoData(),
        options: { ...o(t), pointSize: 12, labelTopN: 0 },
      }),
  },
  {
    name: "heatmap",
    height: 480,
    make: (el, t) => createHeatmap(el, { data: matrix(24, 12), options: o(t) }),
  },
  {
    name: "clustermap",
    height: 560,
    make: (el, t) =>
      createClustermap(el, { data: matrix(20, 10), options: o(t) }),
  },
  {
    name: "km",
    height: 520,
    make: (el, t) => createKm(el, { data: kmData(), options: o(t) }),
  },
  {
    name: "oncoplot",
    height: 560,
    make: (el, t) =>
      createOncoplot(el, { data: oncoplotData(), options: o(t) }),
  },
  {
    name: "lollipop",
    height: 440,
    make: (el, t) =>
      createLollipop(el, { data: lollipopData(), options: o(t) }),
  },
  {
    name: "upset",
    height: 520,
    make: (el, t) => createUpset(el, { data: upsetData(), options: o(t) }),
  },
  {
    name: "profile",
    height: 380,
    make: (el, t) => createProfile(el, { data: profileData(), options: o(t) }),
  },
  {
    name: "dotplot",
    height: 560,
    make: (el, t) => createDotplot(el, { data: dotplotData(), options: o(t) }),
  },
  {
    name: "violin",
    height: 560,
    make: (el, t) => createViolin(el, { data: violinData(), options: o(t) }),
  },
  {
    name: "embedding",
    height: 480,
    make: (el, t) =>
      createEmbedding(el, { data: embeddingData(), options: o(t) }),
    hoverMake: (el, t) =>
      createEmbedding(el, {
        data: embeddingData(),
        options: { ...o(t), pointSize: 12 },
      }),
  },
  {
    name: "spatial",
    height: 560,
    make: (el, t) => createSpatial(el, { data: spatialData(), options: o(t) }),
  },
  {
    name: "spatial colour bar",
    height: 560,
    make: (el, t) =>
      createSpatial(el, { data: spatialData(true), options: o(t) }),
  },
  {
    name: "network",
    height: 480,
    make: (el, t) => createNetwork(el, { data: networkData(), options: o(t) }),
    hoverMake: (el, t) =>
      createNetwork(el, { data: latticeData(), options: o(t) }),
  },
  {
    name: "network legend",
    height: 480,
    make: (el, t) =>
      createNetwork(el, { data: networkData(true), options: o(t) }),
    hoverMake: (el, t) =>
      createNetwork(el, { data: latticeData(), options: o(t) }),
  },
  {
    name: "hic",
    height: 480,
    make: (el, t) =>
      createHic(el, { data: hicData(), options: { ...o(t), label: "chr1" } }),
  },
  {
    name: "treemap",
    height: 480,
    make: (el, t) => createTreemap(el, { data: treemapData(), options: o(t) }),
  },
];

/** Wait for the component in `el` to finish drawing. */
export async function settled(name: string): Promise<void> {
  // regl-scatterplot and sigma draw on later frames.
  const slow = ["volcano", "embedding", "network"].some((n) =>
    name.startsWith(n),
  );
  const ms = slow ? 400 : 60;
  await new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}
