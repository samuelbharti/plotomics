/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createHic } from "../src/components/hic.js";
import { createVolcano } from "../src/components/volcano.js";
import type { BiovizData } from "@bioviz/core";

type Demo = (el: HTMLElement) => { destroy(): void };

/**
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
  hic: (el) => {
    // 1024x1024 = ~1M cells; LOD keeps pan/zoom smooth.
    const inst = createHic(el, {
      data: syntheticHic(1024),
      options: { transform: "log", label: "chr (synthetic)" },
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
