/**
 * Synthetic data for the landing page: the live demo and the gallery
 * thumbnails. The oncoplot cohort, the lollipop protein, the Kaplan-Meier
 * arms and the IGV genome come from the dev demos in pkg-js/dev/demo-data.ts,
 * renamed here where the dev demos use placeholder names. The generators
 * here cover the other plots. The gene and cell type names come from
 * genes.ts. Every generator is seeded, so each page load and each thumbnail
 * run draws the same figure.
 */
import {
  proteinHotspots,
  syntheticCohort,
  syntheticProtein,
  syntheticSurvival,
} from "../../pkg-js/dev/demo-data.js";
import type { PlotomicsData } from "../../pkg-js/src/core/index.js";
import {
  CELL_TYPES,
  DRIVERS,
  MODULES,
  MONOCYTE_UP,
  T_CELL_UP,
} from "./genes.js";

/** A source of uniform numbers in [0, 1). */
export type Rand = () => number;

/** mulberry32: a small seeded generator of uniform numbers in [0, 1). */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run a generator from pkg-js/dev/demo-data.ts, which draws from
 * Math.random, with Math.random seeded for the call. Math.random is put
 * back afterwards, also when the generator throws.
 */
export function withSeed<T>(seed: number, make: () => T): T {
  const saved = Math.random;
  Math.random = seededRandom(seed);
  try {
    return make();
  } finally {
    Math.random = saved;
  }
}

/** A standard normal draw (Box-Muller). */
function gaussian(rand: Rand): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** The index of a group, drawn in proportion to the shares. */
function pick(shares: readonly number[], rand: Rand): number {
  let r = rand() * shares.reduce((a, b) => a + b, 0);
  for (let k = 0; k < shares.length; k += 1) {
    r -= shares[k] as number;
    if (r < 0) return k;
  }
  return shares.length - 1;
}

// ---------------------------------------------------------------------------
// Live demo
// ---------------------------------------------------------------------------

/**
 * Where each cell type of the embedding lies, as a UMAP of PBMCs draws
 * them: along a curve from p0 through p1 to p2 (a quadratic Bezier), with
 * its width across the curve and its share of the cells, in the order of
 * CELL_TYPES. Types that are related share a curve end, so they touch: the
 * T and NK cells form one island, the B cells another, and the monocytes a
 * third, with the dendritic cells near them.
 */
const CELL_SHAPES: {
  p: [[number, number], [number, number], [number, number]];
  width: number;
  share: number;
}[] = [
  // CD4 T naive
  {
    p: [
      [-10, 3.5],
      [-9.5, 9.5],
      [-5, 9.2],
    ],
    width: 0.75,
    share: 0.17,
  },
  // CD4 T memory
  {
    p: [
      [-5.2, 9.3],
      [-1, 9.5],
      [-1.2, 5.2],
    ],
    width: 0.7,
    share: 0.15,
  },
  // CD8 T
  {
    p: [
      [-1.3, 5.6],
      [-1.2, 1.5],
      [-4.2, 0.2],
    ],
    width: 0.6,
    share: 0.11,
  },
  // NK
  {
    p: [
      [-4.4, 0],
      [-7.4, -0.5],
      [-7.6, -3.6],
    ],
    width: 0.5,
    share: 0.06,
  },
  // B naive
  {
    p: [
      [6.5, 10],
      [10.5, 10.8],
      [11.2, 7.2],
    ],
    width: 0.55,
    share: 0.07,
  },
  // B memory
  {
    p: [
      [11.1, 7.5],
      [11.8, 5.2],
      [9.8, 4.2],
    ],
    width: 0.45,
    share: 0.045,
  },
  // CD14 monocytes
  {
    p: [
      [0.5, -4.6],
      [4.5, -10.5],
      [9, -6.6],
    ],
    width: 0.95,
    share: 0.2,
  },
  // FCGR3A monocytes
  {
    p: [
      [8.8, -6.4],
      [11.4, -5.6],
      [11.2, -2.2],
    ],
    width: 0.55,
    share: 0.06,
  },
  // dendritic cells
  {
    p: [
      [4.4, -3.4],
      [5.6, -1.9],
      [6.9, -2.7],
    ],
    width: 0.3,
    share: 0.012,
  },
  // platelets
  {
    p: [
      [-9.8, -8.8],
      [-9.2, -8.2],
      [-8.4, -8.9],
    ],
    width: 0.22,
    share: 0.006,
  },
];

/** A 10x Genomics style cell barcode: 16 bases and a "-1" suffix. */
function barcode(rand: Rand): string {
  let s = "";
  for (let k = 0; k < 16; k += 1) s += "ACGT"[Math.floor(rand() * 4)];
  return `${s}-1`;
}

/**
 * A UMAP-like embedding of `n` PBMCs: each cell type along its curve,
 * thicker and denser in the middle than at the ends, with 0.15% of the
 * cells strayed anywhere in the plot. Each cell has a barcode for its tooltip.
 */
export function pbmcCells(n: number, seed = 11): PlotomicsData {
  const rand = seededRandom(seed);
  const shares = CELL_SHAPES.map((s) => s.share);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const color: string[] = new Array(n);
  const label: string[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const k = pick(shares, rand);
    const shape = CELL_SHAPES[k] as (typeof CELL_SHAPES)[number];
    if (rand() < 0.0015) {
      x[i] = -11 + rand() * 23;
      y[i] = -11 + rand() * 22;
    } else {
      const [p0, p1, p2] = shape.p;
      // Cells crowd the middle of a curve, and its ends thin out.
      const t = (rand() + rand()) / 2;
      const u = 1 - t;
      const bx = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      const by = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      const tx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      const ty = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      const len = Math.hypot(tx, ty) || 1;
      const across =
        gaussian(rand) * shape.width * (0.35 + 0.65 * Math.sin(Math.PI * t));
      const along = gaussian(rand) * 0.2 * shape.width;
      x[i] = bx + (-ty / len) * across + (tx / len) * along;
      y[i] = by + (tx / len) * across + (ty / len) * along;
    }
    color[i] = CELL_TYPES[k] as string;
    label[i] = barcode(rand);
  }
  return { columns: { x, y, color, label } };
}

/**
 * A differential expression result for `n` genes: CD14 monocytes against
 * CD4 T cells. The marker genes in genes.ts are the hits, strongest first.
 * Every other gene has an Ensembl-style id and a log2 fold change under 1
 * either way, so it never takes a colour. The hits come last, so they draw
 * over the rest.
 */
export function monocyteVolcano(n: number, seed = 12): PlotomicsData {
  const rand = seededRandom(seed);
  const hits = [
    ...MONOCYTE_UP.map((gene, rank) => ({ gene, rank, sign: 1, top: 150 })),
    ...T_CELL_UP.map((gene, rank) => ({ gene, rank, sign: -1, top: 120 })),
  ];
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const label: string[] = new Array(n);
  const rest = n - hits.length;
  let id = 100_000;
  for (let i = 0; i < rest; i += 1) {
    const fc = Math.max(-0.95, Math.min(0.95, gaussian(rand) * 0.32));
    x[i] = fc;
    y[i] = -Math.log10(1 - rand()) * (1 + 1.5 * Math.abs(fc));
    id += 1 + Math.floor(rand() * 40);
    label[i] = `ENSG${String(id).padStart(11, "0")}`;
  }
  hits.forEach(({ gene, rank, sign, top }, k) => {
    const i = rest + k;
    const size = 1.2 + 3.8 * Math.exp(-rank / 15) + gaussian(rand) * 0.3;
    x[i] = sign * Math.max(1.1, size);
    y[i] = 2 + 8 * rand() + top * Math.exp(-rank / 8) * (0.85 + 0.3 * rand());
    label[i] = gene;
  });
  return { columns: { x, y, label } };
}

/**
 * The oncoplot demo: a seeded cohort from the dev demos, its genes named
 * after breast cancer drivers in the order of their alteration counts, and
 * its samples numbered.
 */
export function cohort(ngenes: number, nsamples: number): PlotomicsData {
  const data = withSeed(13, () => syntheticCohort(ngenes, nsamples));
  return {
    ...data,
    meta: {
      ...data.meta,
      genes: DRIVERS.slice(0, ngenes),
      samples: Array.from(
        { length: nsamples },
        (_, i) => `Sample ${String(i + 1).padStart(3, "0")}`,
      ),
    },
  };
}

/**
 * The Kaplan-Meier demo: the three seeded arms from the dev demos, without
 * their p-value label, which is a fixed string and not a test of this draw.
 */
export function survival(): PlotomicsData {
  const data = withSeed(14, () => syntheticSurvival());
  const { pLabel: _, ...meta } = data.meta ?? {};
  return { ...data, meta };
}

/**
 * The lollipop demo: a seeded TP53 from the dev demos, with its domains and
 * its recurrent changes at the hotspot residues. The dev demo names the
 * other variants after the residues of a made-up sequence, so those are
 * named by their position only.
 */
export function protein(nTail: number): PlotomicsData {
  const data = withSeed(15, () => syntheticProtein(nTail));
  const position = data.columns.position as ArrayLike<number>;
  const label = (data.columns.label as string[]).map((name, i) => {
    const p = position[i] as number;
    return p in proteinHotspots ? name : `residue ${p}`;
  });
  return { ...data, columns: { ...data.columns, label } };
}

/**
 * A gene network of the modules in genes.ts. The genes are real; the edges
 * are synthetic: each gene links to three genes of its own module, more
 * often to the first ones, and 4% of the links go to any gene. A node's size
 * grows with its number of links.
 */
export function geneNetwork(seed = 28): PlotomicsData {
  const rand = seededRandom(seed);
  const id: string[] = [];
  const nodeGroup: string[] = [];
  const members: number[][] = [];
  for (const [group, genes] of Object.entries(MODULES)) {
    const rows: number[] = [];
    for (const gene of genes) {
      if (id.includes(gene)) continue;
      rows.push(id.length);
      id.push(gene);
      nodeGroup.push(group);
    }
    members.push(rows);
  }
  const source: string[] = [];
  const target: string[] = [];
  const degree = new Float32Array(id.length);
  // A pair is linked once: the network drops repeated edges with a warning.
  const linked = new Set<number>();
  members.forEach((rows) => {
    for (const i of rows) {
      for (let k = 0; k < 3; k += 1) {
        const j =
          rand() < 0.04
            ? Math.floor(rand() * id.length)
            : (rows[Math.floor(rand() ** 1.6 * rows.length)] as number);
        const key = Math.min(i, j) * id.length + Math.max(i, j);
        if (j === i || linked.has(key)) continue;
        linked.add(key);
        source.push(id[i] as string);
        target.push(id[j] as string);
        degree[i] = (degree[i] as number) + 1;
        degree[j] = (degree[j] as number) + 1;
      }
    }
  });
  const size = degree.map((d) => 2.5 + 1.4 * Math.sqrt(d));
  return {
    columns: { id, size, source, target },
    meta: { nodeGroup, nodeGroupLevels: Object.keys(MODULES) },
  };
}

/**
 * A Hi-C contact map of `n` bins of 10 kb. Contacts fall off with the
 * distance from the diagonal. Domains of 300 kb to 1 Mb hold one to three
 * sub-domains, so zooming in shows nested squares. Each domain sits in an A
 * or a B compartment, which gives the far-off-diagonal plaid, and the
 * corners of the larger domains carry loop dots.
 */
export function contactMap(n: number, seed = 29): PlotomicsData {
  const rand = seededRandom(seed);
  const domain = new Int32Array(n);
  const sub = new Int32Array(n);
  const compartment = new Int8Array(n);
  const corners: [number, number][] = [];
  let state = 1;
  let subId = 0;
  for (let start = 0, d = 0; start < n; d += 1) {
    const len = Math.min(n - start, 30 + Math.floor(rand() * 70));
    if (rand() < 0.7) state = -state;
    const parts = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < len; b += 1) {
      domain[start + b] = d;
      compartment[start + b] = state;
      sub[start + b] = subId + Math.floor((b / len) * parts);
    }
    subId += parts;
    if (len > 40) corners.push([start, start + len - 1]);
    start += len;
  }
  const values = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let v = 1500 / (j - i + 1) ** 1.08;
      if (domain[i] === domain[j]) {
        v *= sub[i] === sub[j] ? 4.2 : 2.6;
      } else {
        v *= compartment[i] === compartment[j] ? 1.35 : 0.7;
      }
      v *= 0.75 + 0.5 * rand();
      values[i * n + j] = v;
      values[j * n + i] = v;
    }
  }
  for (const [a, b] of corners) {
    for (let di = -2; di <= 2; di += 1) {
      for (let dj = -2; dj <= 2; dj += 1) {
        const i = a + 1 + di;
        const j = b - 1 + dj;
        if (i < 0 || j >= n || i >= j) continue;
        const add = 260 * Math.exp(-(di * di + dj * dj) / 2);
        values[i * n + j] = (values[i * n + j] as number) + add;
        values[j * n + i] = (values[j * n + i] as number) + add;
      }
    }
  }
  return {
    columns: { values },
    meta: { n, binSize: 10_000, chrom: "chr (synthetic)" },
  };
}

// ---------------------------------------------------------------------------
// Gallery thumbnails
// ---------------------------------------------------------------------------

/**
 * An expression matrix with up-regulated blocks on the diagonal, a smooth
 * wave across it and noise.
 */
export function expressionMatrix(
  nrows: number,
  ncols: number,
  seed = 21,
): PlotomicsData {
  const rand = seededRandom(seed);
  const values = new Float32Array(nrows * ncols);
  const blocks = 5;
  for (let r = 0; r < nrows; r += 1) {
    const rb = Math.floor((r / nrows) * blocks);
    for (let c = 0; c < ncols; c += 1) {
      const cb = Math.floor((c / ncols) * blocks);
      const base = rb === cb ? 3 : 0;
      const wave =
        Math.sin((r / nrows) * 6.283) * Math.cos((c / ncols) * 6.283);
      values[r * ncols + c] = base + wave + (rand() - 0.5) * 1.5;
    }
  }
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => `GENE${i + 1}`),
      colLabels: Array.from({ length: ncols }, (_, i) => `S${i + 1}`),
    },
  };
}

/**
 * A matrix with `groups` blocks of correlated rows and columns, shuffled,
 * so the clustering has blocks to recover.
 */
export function clusterMatrix(
  nrows: number,
  ncols: number,
  groups: number,
  seed = 22,
): PlotomicsData {
  const rand = seededRandom(seed);
  const order = (n: number) => {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j] as number, a[i] as number];
    }
    return a;
  };
  const rowOrder = order(nrows);
  const colOrder = order(ncols);
  const values = new Float32Array(nrows * ncols);
  for (let r = 0; r < nrows; r += 1) {
    const rg = Math.floor(((rowOrder[r] as number) / nrows) * groups);
    for (let c = 0; c < ncols; c += 1) {
      const cg = Math.floor(((colOrder[c] as number) / ncols) * groups);
      values[r * ncols + c] = (rg === cg ? 2.5 : 0) + (rand() - 0.5) * 1.5;
    }
  }
  return {
    columns: { values },
    meta: {
      nrows,
      ncols,
      rowLabels: Array.from({ length: nrows }, (_, i) => `gene ${i + 1}`),
      colLabels: Array.from({ length: ncols }, (_, i) => `sample ${i + 1}`),
    },
  };
}

/** The cell types of the dot plot and the violins. */
const PANEL_TYPES = ["T cell", "B cell", "Myeloid", "Fibroblast", "Tumour"];

/**
 * A marker panel: three genes specific to each cell type, plus two
 * housekeeping genes expressed in nearly every cell.
 */
export function markerPanel(seed = 23): PlotomicsData {
  const rand = seededRandom(seed);
  const genes = [
    "CD3D",
    "CD3E",
    "IL7R",
    "MS4A1",
    "CD79A",
    "CD19",
    "LYZ",
    "CD14",
    "CD68",
    "COL1A1",
    "DCN",
    "LUM",
    "EPCAM",
    "KRT8",
    "KRT18",
    "ACTB",
    "GAPDH",
  ];
  const gene: string[] = [];
  const cluster: string[] = [];
  const pct: number[] = [];
  const value: number[] = [];
  genes.forEach((g, i) => {
    const owner = i < 15 ? Math.floor(i / 3) : -1;
    PANEL_TYPES.forEach((c, j) => {
      gene.push(g);
      cluster.push(c);
      if (owner === -1) {
        pct.push(88 + rand() * 10);
        value.push(2.6 + rand() * 0.5);
      } else if (owner === j) {
        pct.push(60 + rand() * 38);
        value.push(2 + rand());
      } else {
        pct.push(rand() * 18);
        value.push(rand() * 0.5);
      }
    });
  });
  return {
    columns: { gene, cluster, pct, value },
    meta: {
      genes,
      clusters: PANEL_TYPES,
      valueLabel: "mean expression",
      sizeLabel: "% expressing",
    },
  };
}

/**
 * Stacked violins: one marker gene per cell type, high in its own type and
 * low in the rest, and one gene with two modes in every type.
 */
export function violinPanel(): PlotomicsData {
  const features = ["CD3D", "MS4A1", "LYZ", "COL1A1", "EPCAM", "MKI67"];
  const N = 64;
  const grid = Array.from({ length: N }, (_, i) => (6 * i) / (N - 1));
  const bump = (centre: number, width: number, amp: number) =>
    grid.map((g) => amp * Math.exp(-((g - centre) ** 2) / (2 * width ** 2)));
  const feature: string[] = [];
  const group: string[] = [];
  const density: number[] = [];
  const median: number[] = [];
  features.forEach((f, i) => {
    PANEL_TYPES.forEach((c, j) => {
      feature.push(f);
      group.push(c);
      let row: number[];
      let med: number;
      if (f === "MKI67") {
        const a = bump(0.4, 0.35, 1);
        const b = bump(4.2 - j * 0.2, 0.5, 0.9);
        row = a.map((v, k) => v + (b[k] as number));
        med = 2.2;
      } else if (i === j) {
        row = bump(4.2, 0.6, 1);
        med = 4.2;
      } else {
        row = bump(0.3, 0.3, 1);
        med = 0.3;
      }
      density.push(...row);
      median.push(med);
    });
  });
  return {
    columns: { feature, group },
    meta: { grid, density, median, features, groups: PANEL_TYPES },
  };
}

/** The tissue outline of the spatial thumbnail, in image pixels. */
function tissueRadius(angle: number): number {
  return 230 + 30 * Math.sin(angle * 3);
}

/**
 * A Visium-shaped slide: a hex grid of spots over a ragged tissue section,
 * with spatial domains in rings, and a drawn stand-in for the H&E image.
 */
export function tissueSlide(seed = 24): PlotomicsData {
  const rand = seededRandom(seed);
  const W = 600;
  const H = 600;
  const x: number[] = [];
  const y: number[] = [];
  const color: string[] = [];
  const domains = ["Tumour", "Stroma", "Immune", "Necrotic", "Normal"];
  for (let row = 0; row < 64; row += 1) {
    for (let col = 0; col < 64; col += 1) {
      const px = 60 + col * 7.5 + (row % 2) * 3.75;
      const py = 60 + row * 6.9;
      const dx = px - W / 2;
      const dy = py - H / 2;
      const r = Math.hypot(dx, dy);
      if (r > tissueRadius(Math.atan2(dy, dx))) continue;
      x.push(px);
      y.push(py);
      const d = r < 80 ? 3 : r < 150 ? 0 : r < 200 ? 1 : 2;
      color.push(domains[rand() < 0.12 ? 4 : d] as string);
    }
  }
  // The image: the tissue outline in two pinks, a little larger than the
  // spots, on a pale slide.
  const outline = (grow: number) =>
    Array.from({ length: 120 }, (_, k) => {
      const a = (k / 120) * 2 * Math.PI;
      const r = tissueRadius(a) + grow;
      return `${(W / 2 + r * Math.cos(a)).toFixed(1)},${(H / 2 + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#f6f1f4"/>` +
    `<polygon points="${outline(14)}" fill="#ead0e0"/>` +
    `<polygon points="${outline(-60)}" fill="#dcb3cc"/>` +
    "</svg>";
  return {
    columns: { x, y, color },
    meta: {
      image: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      imgWidth: W,
      imgHeight: H,
      spotDiameter: 6,
      levels: domains,
    },
  };
}

/**
 * An SBS96 profile with an APOBEC-like pattern: C>T and C>G high at TCA and
 * TCT, the other contexts low.
 */
export function sbs96(seed = 25): PlotomicsData {
  const rand = seededRandom(seed);
  const subs = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
  const bases = ["A", "C", "G", "T"];
  const value: number[] = [];
  const group: string[] = [];
  const label: string[] = [];
  for (const s of subs) {
    for (const five of bases) {
      for (const three of bases) {
        const apobec =
          (s === "C>T" || s === "C>G") &&
          five === "T" &&
          (three === "A" || three === "T");
        value.push(apobec ? 60 + rand() * 40 : rand() * 8);
        group.push(s);
        label.push(`${five}${s[0]}${three}`);
      }
    }
  }
  return {
    columns: { value, group, label },
    meta: {
      groups: subs,
      groupColors: [
        "#03BCEE",
        "#010101",
        "#E32926",
        "#CAC9C9",
        "#A1CE63",
        "#EBC6C4",
      ],
    },
  };
}

/**
 * Exclusive intersections of six gene sets, with one pair, TP53 and PIK3CA,
 * far rarer together than either alone.
 */
export function geneSets(seed = 26): PlotomicsData {
  const rand = seededRandom(seed);
  const sets = ["TP53", "PIK3CA", "GATA3", "CDH1", "MYC", "PTEN"];
  const rows: { m: boolean[]; size: number }[] = [];
  for (let mask = 1; mask < 1 << sets.length; mask += 1) {
    const m = sets.map((_, k) => (mask & (1 << k)) !== 0);
    const degree = m.filter(Boolean).length;
    if (degree > 3) continue;
    let size = Math.round(180 / 2 ** (degree - 1) + rand() * 30);
    if (m[0] && m[1]) size = Math.round(size * 0.18);
    rows.push({ m, size });
  }
  rows.sort((a, b) => b.size - a.size);
  const top = rows.slice(0, 16);
  return {
    columns: { size: top.map((r) => r.size) },
    meta: {
      sets,
      setSizes: sets.map((_, k) =>
        top.reduce((acc, r) => acc + (r.m[k] ? r.size : 0), 0),
      ),
      membership: top.flatMap((r) => r.m.map((v) => (v ? 1 : 0))),
      total: top.reduce((acc, r) => acc + r.size, 0),
    },
  };
}

/**
 * A Gosling spec over inline values, so it draws with no network: a
 * circular view of a synthetic signal along chr1 to chr8, as bars, over
 * segments coloured by state.
 */
export function goslingSpec(seed = 30): Record<string, unknown> {
  const rand = seededRandom(seed);
  // The hg38 lengths of chr1 to chr8 in whole Mb, rounded down, so no bin
  // runs past the end of its chromosome.
  const lengths = [248, 242, 198, 190, 181, 170, 159, 145];
  const signal: Record<string, unknown>[] = [];
  const segments: Record<string, unknown>[] = [];
  const states = ["gain", "neutral", "loss"];
  lengths.forEach((len, c) => {
    const chrom = `chr${c + 1}`;
    const step = 3;
    for (let s = 0; s + step <= len; s += step) {
      const wave = Math.sin((s / len) * Math.PI * (2 + c)) * 0.5 + 0.5;
      signal.push({
        chrom,
        start: s * 1e6,
        end: (s + step) * 1e6,
        value: Math.round((wave * 40 + rand() * 25) * 10) / 10,
      });
    }
    for (let s = 0; s < len; ) {
      const span = Math.min(len - s, 10 + Math.floor(rand() * 40));
      segments.push({
        chrom,
        start: s * 1e6,
        end: (s + span) * 1e6,
        state: states[pick([1, 3, 1], rand)],
      });
      s += span;
    }
  });
  const json = (values: Record<string, unknown>[]) => ({
    type: "json",
    chromosomeField: "chrom",
    genomicFields: ["start", "end"],
    values,
  });
  return {
    layout: "circular",
    arrangement: "vertical",
    centerRadius: 0.35,
    // chr1 to chr8 of hg38 end at this absolute position.
    xDomain: { interval: [0, 1_536_488_912] },
    tracks: [
      {
        data: json(signal),
        mark: "bar",
        x: { field: "start", type: "genomic" },
        xe: { field: "end", type: "genomic" },
        y: { field: "value", type: "quantitative", axis: "none" },
        color: { value: "#2761e3" },
        width: 360,
        height: 70,
      },
      {
        data: json(segments),
        mark: "rect",
        x: { field: "start", type: "genomic" },
        xe: { field: "end", type: "genomic" },
        color: {
          field: "state",
          type: "nominal",
          domain: states,
          range: ["#D55E00", "#d9dde3", "#0072B2"],
          legend: true,
        },
        stroke: { value: "white" },
        strokeWidth: { value: 0.5 },
        width: 360,
        height: 24,
      },
    ],
  };
}

/**
 * Gene sets for the treemap: the four network modules and the first 24
 * markers of each side of the volcano, each gene weighted so a few genes
 * take most of their set.
 */
export function geneSetTree(seed = 27): PlotomicsData {
  const rand = seededRandom(seed);
  const sets: Record<string, string[]> = {
    ...MODULES,
    "monocyte markers": MONOCYTE_UP.slice(0, 24),
    "T cell markers": T_CELL_UP.slice(0, 24),
  };
  const id: string[] = ["root"];
  const parent: string[] = [""];
  const value: number[] = [0];
  const labels: string[] = ["Gene sets"];
  for (const [name, genes] of Object.entries(sets)) {
    id.push(name);
    parent.push("root");
    value.push(0);
    labels.push(name);
    for (const gene of genes) {
      id.push(`${name}/${gene}`);
      parent.push(name);
      value.push(Math.round(1 + rand() ** 3 * 500));
      labels.push(gene);
    }
  }
  return {
    columns: { id, parent, value: new Float64Array(value) },
    meta: { labels },
  };
}
