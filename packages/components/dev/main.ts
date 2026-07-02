/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createHeatmap } from "../src/components/heatmap.js";
import { createVolcano } from "../src/components/volcano.js";
import type { BiovizData } from "@bioviz/core";

type Demo = (el: HTMLElement) => { destroy(): void };

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

// A large expression matrix with block structure so patterns are visible even
// zoomed out. 1000 x 1000 = 1,000,000 cells uploaded as one luminance texture.
function syntheticMatrix(nrows: number, ncols: number): BiovizData {
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

const demos: Record<string, Demo> = {
  heatmap: (el) => {
    const inst = createHeatmap(el, {
      data: syntheticMatrix(1000, 1000),
      options: { colormap: "viridis", zScore: false },
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
