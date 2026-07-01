/**
 * Dev harness. Registers demos by name; each demo gets a fresh #stage element.
 * New components: add a `demos.<name> = (el) => { ... }` entry that mounts your
 * factory against synthetic data, then pick it from the dropdown.
 */
import { createNetwork } from "../src/components/network.js";
import { createVolcano } from "../src/components/volcano.js";
import type { BiovizData } from "@bioviz/core";

type Demo = (el: HTMLElement) => { destroy(): void };

/** Synthetic clustered interaction network: `communities` blobs of nodes with
 * dense intra-community and sparse inter-community edges. No coordinates, so
 * the component runs ForceAtlas2 to lay it out. */
function syntheticNetwork(nodes: number, communities: number): BiovizData {
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
  network: (el) => {
    const inst = createNetwork(el, {
      data: syntheticNetwork(5_000, 8),
      options: { iterations: 150, labelThreshold: 6 },
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
