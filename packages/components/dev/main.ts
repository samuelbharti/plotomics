/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createTreemap } from "../src/components/treemap.js";
import { createVolcano } from "../src/components/volcano.js";
import type { BiovizData } from "@bioviz/core";

type Demo = (el: HTMLElement) => { destroy(): void };

/**
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
