/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createHeatmap } from "../src/components/heatmap.js";
import { createGosling } from "../src/components/gosling.js";
import { createNetwork } from "../src/components/network.js";
import { createClustermap } from "../src/components/clustermap.js";
import { createHic } from "../src/components/hic.js";
import { createIgv } from "../src/components/igv.js";
import { createTreemap } from "../src/components/treemap.js";
import { createVolcano } from "../src/components/volcano.js";
import { createEmbedding } from "../src/components/embedding.js";
import { createOncoplot } from "../src/components/oncoplot.js";
import type { PlotomicsData } from "@plotomics/core";

type Demo = (el: HTMLElement) => { destroy(): void; resize?(w: number, h: number): void };

// A minimal valid Gosling spec: one bar track over a public multivec tileset
// hosted by the Gosling team (data streams/tiles from the server).
const goslingSpec = {
  title: "Cistrome peaks",
  subtitle: "single multivec track streamed from the Gosling tile server",
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
      y: { field: "peak", type: "quantitative", axis: "right" },
      color: { field: "peak", type: "quantitative", legend: true },
      width: 700,
      height: 200,
    },
  ],
};
/** Synthetic clustered interaction network: `communities` blobs of nodes with
 * dense intra-community and sparse inter-community edges. No coordinates, so
 * the component runs ForceAtlas2 to lay it out. */
function syntheticNetwork(nodes: number, communities: number): PlotomicsData {
  const id: string[] = new Array(nodes);
  const nodeGroup: string[] = new Array(nodes);
  const size = new Float32Array(nodes);
  const comm = new Int32Array(nodes);
  for (let i = 0; i < nodes; i += 1) {
    id[i] = `N${i}`;
    comm[i] = i % communities;
    nodeGroup[i] = `module ${comm[i] + 1}`;
    size[i] = 2 + Math.random() * 6;
  }
  const byComm: number[][] = Array.from({ length: communities }, () => []);
  for (let i = 0; i < nodes; i += 1) byComm[comm[i]!]!.push(i);

  const source: string[] = [];
  const target: string[] = [];
  const edgesPerNode = 3;
  for (let i = 0; i < nodes; i += 1) {
    const peers = byComm[comm[i]!]!;
    for (let k = 0; k < edgesPerNode; k += 1) {
      // Mostly wire within community; occasionally bridge to another.
      const j =
        Math.random() < 0.05
          ? Math.floor(Math.random() * nodes)
          : peers[Math.floor(Math.random() * peers.length)]!;
      if (j !== i) {
        source.push(id[i]!);
        target.push(id[j]!);
      }
    }
  }
  return {
    columns: { id, size, source, target },
    meta: { nodeGroup },
  };
}

/**
 * Synthetic clusterable matrix: `groups` blocks of correlated rows/cols with a
 * raised block-diagonal signal + noise, so hierarchical clustering has clear
 * structure to recover.
 */
function syntheticClusterMatrix(nrows: number, ncols: number, groups = 4): PlotomicsData {
  const values = new Float32Array(nrows * ncols);
  const rowGroup = (r: number) => Math.floor((r / nrows) * groups);
  const colGroup = (c: number) => Math.floor((c / ncols) * groups);
  for (let r = 0; r < nrows; r += 1) {
    for (let c = 0; c < ncols; c += 1) {
      const on = rowGroup(r) === colGroup(c) ? 2.5 : 0;
      values[r * ncols + c] = on + (Math.random() - 0.5) * 1.5;
    }
  }
  // Shuffle rows and cols so clustering has to reorder them back into blocks.
  const shuffledValues = new Float32Array(nrows * ncols);
  const rowPerm = shuffle(nrows);
  const colPerm = shuffle(ncols);
  for (let r = 0; r < nrows; r += 1) {
    for (let c = 0; c < ncols; c += 1) {
      shuffledValues[r * ncols + c] =
        values[(rowPerm[r] as number) * ncols + (colPerm[c] as number)] as number;
    }
  }
  const rowLabels = Array.from({ length: nrows }, (_, i) => `gene_${i}`);
  const colLabels = Array.from({ length: ncols }, (_, i) => `sample_${i}`);
  return {
    columns: { values: shuffledValues },
    meta: { nrows, ncols, rowLabels, colLabels },
  };
}

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as number, a[i] as number];
  }
  return a;
}

/**
 * Synthetic Hi-C contact matrix: distance-decay background (contacts fall off
 * away from the diagonal) plus a few TAD-like square domains and off-diagonal
 * loop dots, so LOD/zoom/pan can be eyeballed at scale.
 */
function syntheticHic(n: number): PlotomicsData {
  const values = new Float32Array(n * n);
  const domains: [number, number][] = [];
  let start = 0;
  while (start < n) {
    const len = 20 + Math.floor(Math.random() * 60);
    domains.push([start, Math.min(n, start + len)]);
    start += len;
  }
  const inDomain = (i: number, j: number) =>
    domains.some(([a, b]) => i >= a && i < b && j >= a && j < b);
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const d = j - i;
      // Power-law distance decay + noise.
      let v = 1200 / Math.pow(d + 1, 1.15) + Math.random() * 4;
      if (inDomain(i, j)) v *= 2.2; // enriched within TADs
      values[i * n + j] = v;
      values[j * n + i] = v; // symmetric
    }
  }
  // A handful of bright loop dots off the diagonal.
  for (let k = 0; k < 12; k += 1) {
    const i = Math.floor(Math.random() * (n - 10));
    const j = i + 10 + Math.floor(Math.random() * (n - i - 10));
    if (j >= n) continue;
    const peak = 300 + Math.random() * 400;
    values[i * n + j] += peak;
    values[j * n + i] += peak;
  }
  return {
    columns: { values },
    meta: { n, binSize: 10_000, chrom: "chr (synthetic)" },
  };
}

/**
 * Synthetic gene/pathway hierarchy: `pathways` top-level sets, each with a
 * random number of leaf genes (weighted values). Produces the flat
 * id/parent/value columns the treemap consumes, at ~`leaves` genes total.
 */
function syntheticTree(pathways: number, leaves: number): PlotomicsData {
  const id: string[] = ["root"];
  const parent: string[] = [""];
  const value: number[] = [0];
  const labels: string[] = ["All pathways"];
  const perPathway = Math.max(1, Math.floor(leaves / pathways));
  let g = 0;
  for (let p = 0; p < pathways; p += 1) {
    const pid = `P${p}`;
    id.push(pid);
    parent.push("root");
    value.push(0);
    labels.push(`Pathway ${p}`);
    // Vary set size so tiles differ in scale (some big, some tiny).
    const count = Math.max(1, Math.round(perPathway * (0.3 + Math.random() * 1.4)));
    for (let k = 0; k < count; k += 1) {
      const gid = `g${g}`;
      id.push(gid);
      parent.push(pid);
      // Log-normal-ish weights so a few genes dominate each pathway.
      value.push(Math.round(1 + Math.pow(Math.random(), 3) * 500));
      labels.push(`GENE${g}`);
      g += 1;
    }
  }
  return {
    columns: { id, parent, value: new Float64Array(value) },
    meta: { labels },
  };
}

function syntheticVolcano(n: number): PlotomicsData {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const label: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const fc = (Math.random() - 0.5) * 12;
    x[i] = fc;
    // more significant when |fc| is large, plus noise
    y[i] = Math.max(0, Math.abs(fc) * 0.8 + Math.random() * 4 - 1);
    label.push(`GENE${i}`);
  }
  return { columns: { x, y, label } };
}

/**
 * Synthetic 2-D embedding (UMAP/t-SNE-like): `clusters` gaussian blobs arranged
 * on a ring. Each point carries a categorical `cluster` label and a continuous
 * `value` gradient, so both coloring modes can be eyeballed. Pass
 * `continuous = true` to expose the numeric column as `color`.
 */
function syntheticEmbedding(n: number, clusters = 8, continuous = false): PlotomicsData {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const value = new Float32Array(n);
  const cluster: string[] = new Array(n);
  const label: string[] = new Array(n);
  const centers = Array.from({ length: clusters }, (_, k) => {
    const a = (k / clusters) * Math.PI * 2;
    return [Math.cos(a) * 10, Math.sin(a) * 10] as [number, number];
  });
  for (let i = 0; i < n; i += 1) {
    const k = i % clusters;
    const c = centers[k]!;
    const gx = gaussian() * 1.7;
    const gy = gaussian() * 1.7;
    x[i] = c[0] + gx;
    y[i] = c[1] + gy;
    cluster[i] = `cluster ${k + 1}`;
    // A smooth per-cluster gradient (e.g. pseudotime / marker expression).
    value[i] = k + Math.hypot(gx, gy) * 0.35;
    label[i] = `cell ${i}`;
  }
  return { columns: { x, y, color: continuous ? value : cluster, label } };
}

// Box–Muller standard-normal sample.
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// A large expression matrix with block structure so patterns are visible even
// zoomed out. 1000 x 1000 = 1,000,000 cells uploaded as one luminance texture.
function syntheticMatrix(nrows: number, ncols: number): PlotomicsData {
  const values = new Float32Array(nrows * ncols);
  const rowLabels: string[] = [];
  const colLabels: string[] = [];
  for (let c = 0; c < ncols; c += 1) colLabels.push(`S${c}`);
  const blocks = 6;
  for (let r = 0; r < nrows; r += 1) {
    rowLabels.push(`GENE${r}`);
    const rowBlock = Math.floor((r / nrows) * blocks);
    for (let c = 0; c < ncols; c += 1) {
      const colBlock = Math.floor((c / ncols) * blocks);
      // On-diagonal blocks are up-regulated; add smooth gradient + noise.
      const base = rowBlock === colBlock ? 3 : 0;
      const wave = Math.sin((r / nrows) * 6.283) * Math.cos((c / ncols) * 6.283);
      values[r * ncols + c] = base + wave + (Math.random() - 0.5) * 1.5;
    }
  }
  return {
    columns: { values },
    meta: { nrows, ncols, rowLabels, colLabels },
  };
}

// Cohort-scale oncoplot: 60 genes x 1,200 samples is 72,000 cells, which is
// where per-cell DOM would fall over and canvas does not notice.
function syntheticCohort(ngenes: number, nsamples: number): PlotomicsData {
  const classes = ["Missense", "Truncating", "Frameshift", "Splice",
    "In-frame indel", "Amplification", "Deep deletion", "Multi-hit"];
  const codes = new Int16Array(ngenes * nsamples);
  const tmb = new Float32Array(nsamples);
  const freq = new Float32Array(ngenes);
  for (let r = 0; r < ngenes; r += 1) {
    // Decaying prevalence, so the plot has the usual top-heavy shape.
    const p = 0.42 * Math.exp(-0.06 * r) + 0.02;
    let hits = 0;
    for (let c = 0; c < nsamples; c += 1) {
      if (Math.random() < p) {
        codes[r * nsamples + c] = 1 + Math.floor(Math.random() * classes.length);
        tmb[c] += 1;
        hits += 1;
      }
    }
    freq[r] = (100 * hits) / nsamples;
  }
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
      classColors: ["#0E7175", "#233038", "#C63F3E", "#ED773C", "#E4A25B",
        "#9E3F71", "#808BC5", "#245E55"],
      annotations: [
        { name: "Subtype", levels: subtypes, codes: subCodes },
        { name: "Stage", levels: stages, codes: stageCodes },
      ],
    },
  };
}

const demos: Record<string, Demo> = {
  oncoplot: (el) =>
    createOncoplot(el, {
      data: syntheticCohort(60, 1200),
      options: { xLabel: "samples" },
    }),
  heatmap: (el) => {
    const inst = createHeatmap(el, {
      data: syntheticMatrix(1000, 1000),
      options: { colormap: "viridis", zScore: false },
    });
    return inst;
  },
  gosling: (el) => {
    const inst = createGosling(el, {
      options: { spec: goslingSpec },
    });
    return inst;
  },
  network: (el) => {
    const inst = createNetwork(el, {
      data: syntheticNetwork(5_000, 8),
      options: { iterations: 150, labelThreshold: 6 },
    });
    return inst;
  },
  clustermap: (el) =>
    createClustermap(el, {
      data: syntheticClusterMatrix(120, 60, 4),
      options: { colormap: "rdbu", zScore: true, linkage: "average" },
    }),
  hic: (el) => {
    // 1024x1024 = ~1M cells; LOD keeps pan/zoom smooth.
    const inst = createHic(el, {
      data: syntheticHic(1024),
      options: { transform: "log", label: "chr (synthetic)" },
    });
    return inst;
  },
  // Genome viewer: hg38 with a small public bigWig track streamed by igv.js.
  igv: (el) =>
    createIgv(el, {
      options: {
        genome: "hg38",
        locus: "chr8:127,736,588-127,739,371",
        tracks: [
          {
            name: "CTCF ENCODE",
            url: "https://www.encodeproject.org/files/ENCFF356YES/@@download/ENCFF356YES.bigWig",
            format: "bigWig",
            height: 100,
          },
        ],
      },
    }),
  treemap: (el) => {
    const inst = createTreemap(el, {
      data: syntheticTree(12, 5000),
      options: { tile: "squarify", colorBy: "parent", labelMinSize: 36 },
    });
    return inst;
  },
  volcano: (el) => {
    const inst = createVolcano(el, {
      data: syntheticVolcano(200_000),
      options: { labelTopN: 8 },
    });
    return inst;
  },
  embedding: (el) => {
    // 150k cells in 8 gaussian blobs, colored by a categorical cluster label
    // (discrete legend). Try the lasso: drag from empty space to select points.
    const inst = createEmbedding(el, {
      data: syntheticEmbedding(150_000, 8),
      options: {
        colorMode: "categorical",
        onSelect: (idx) => console.log(`selected ${idx.length} points`),
      },
    });
    return inst;
  },
  embeddingContinuous: (el) => {
    // Same layout, colored by a continuous value via the viridis ramp + colorbar.
    const inst = createEmbedding(el, {
      data: syntheticEmbedding(150_000, 8, true),
      options: { colorMode: "continuous", colormap: "viridis" },
    });
    return inst;
  },
};

const stage = document.getElementById("stage") as HTMLElement;
const picker = document.getElementById("picker") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLElement;
let current: { destroy(): void; resize?(w: number, h: number): void } | null = null;
let ro: ResizeObserver | null = null;

function mount(name: string) {
  ro?.disconnect();
  current?.destroy();
  stage.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  stage.appendChild(host);
  const t0 = performance.now();
  current = demos[name]!(host);
  // Drive resize() the way the real hosts do (the anywidget adapter and the
  // htmlwidgets binding both call it). Components that size on resize() rather
  // than at construction — e.g. embedding — stay blank without this.
  ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (r && r.width > 0) current?.resize?.(r.width, r.height || 480);
  });
  ro.observe(host);
  status.textContent = ` — ${name} rendered in ${(performance.now() - t0).toFixed(0)}ms`;
}

for (const name of Object.keys(demos)) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  picker.appendChild(opt);
}
picker.addEventListener("change", () => mount(picker.value));
mount(picker.value || "volcano");
