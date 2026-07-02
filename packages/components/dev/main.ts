/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createClustermap } from "../src/components/clustermap.js";
import { createHic } from "../src/components/hic.js";
import { createIgv } from "../src/components/igv.js";
import { createTreemap } from "../src/components/treemap.js";
import { createVolcano } from "../src/components/volcano.js";
import type { BiovizData } from "@bioviz/core";

type Demo = (el: HTMLElement) => { destroy(): void };

/**
 * Synthetic clusterable matrix: `groups` blocks of correlated rows/cols with a
 * raised block-diagonal signal + noise, so hierarchical clustering has clear
 * structure to recover.
 */
function syntheticMatrix(nrows: number, ncols: number, groups = 4): BiovizData {
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

 * Synthetic Hi-C contact matrix: distance-decay background (contacts fall off
 * away from the diagonal) plus a few TAD-like square domains and off-diagonal
 * loop dots, so LOD/zoom/pan can be eyeballed at scale.
 */
function syntheticHic(n: number): BiovizData {
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
 * Synthetic gene/pathway hierarchy: `pathways` top-level sets, each with a
 * random number of leaf genes (weighted values). Produces the flat
 * id/parent/value columns the treemap consumes, at ~`leaves` genes total.
 */
function syntheticTree(pathways: number, leaves: number): BiovizData {
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

function syntheticVolcano(n: number): BiovizData {
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

const demos: Record<string, Demo> = {
  clustermap: (el) =>
    createClustermap(el, {
      data: syntheticMatrix(120, 60, 4),
      options: { colormap: "rdbu", zScore: true, linkage: "average" },
    }),
  hic: (el) => {
    // 1024x1024 = ~1M cells; LOD keeps pan/zoom smooth.
    const inst = createHic(el, {
      data: syntheticHic(1024),
      options: { transform: "log", label: "chr (synthetic)" },
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
};

const stage = document.getElementById("stage") as HTMLElement;
const picker = document.getElementById("picker") as HTMLSelectElement;
const status = document.getElementById("status") as HTMLElement;
let current: { destroy(): void } | null = null;

function mount(name: string) {
  current?.destroy();
  stage.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  stage.appendChild(host);
  const t0 = performance.now();
  current = demos[name]!(host);
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
