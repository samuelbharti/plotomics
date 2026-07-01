/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createClustermap } from "../src/components/clustermap.js";
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
