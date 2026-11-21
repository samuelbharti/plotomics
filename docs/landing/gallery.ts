/**
 * The browser side of scripts/landing-thumbnails.mjs. It mounts one
 * component at a time with seeded demo data, waits for it to draw, takes
 * the component's own export, and encodes it as WebP for docs/gallery/.
 * It is not part of the landing page bundle.
 */
import { igvDemoOptions } from "../../pkg-js/dev/demo-data.js";
import { createClustermap } from "../../pkg-js/src/components/clustermap.js";
import { createDotplot } from "../../pkg-js/src/components/dotplot.js";
import { createEmbedding } from "../../pkg-js/src/components/embedding.js";
import { createGosling } from "../../pkg-js/src/components/gosling.js";
import { createHeatmap } from "../../pkg-js/src/components/heatmap.js";
import { createHic } from "../../pkg-js/src/components/hic.js";
import { createIgv } from "../../pkg-js/src/components/igv.js";
import { createKm } from "../../pkg-js/src/components/km.js";
import { createLollipop } from "../../pkg-js/src/components/lollipop.js";
import { createNetwork } from "../../pkg-js/src/components/network.js";
import { createOncoplot } from "../../pkg-js/src/components/oncoplot.js";
import { createProfile } from "../../pkg-js/src/components/profile.js";
import { createSpatial } from "../../pkg-js/src/components/spatial.js";
import { createTreemap } from "../../pkg-js/src/components/treemap.js";
import { createUpset } from "../../pkg-js/src/components/upset.js";
import { createViolin } from "../../pkg-js/src/components/violin.js";
import { createVolcano } from "../../pkg-js/src/components/volcano.js";
import type { PlotomicsInstance } from "../../pkg-js/src/core/index.js";
import {
  clusterMatrix,
  cohort,
  contactMap,
  expressionMatrix,
  geneNetwork,
  geneSets,
  geneSetTree,
  goslingSpec,
  markerPanel,
  monocyteVolcano,
  pbmcCells,
  protein,
  sbs96,
  survival,
  tissueSlide,
  violinPanel,
} from "./data.js";
import { CELL_TYPES } from "./genes.js";

type Plot = PlotomicsInstance<unknown>;

/** One maker per component, named as the files in docs/gallery/. */
const MAKERS: Record<string, (el: HTMLElement) => Plot> = {
  volcano: (el) =>
    createVolcano(el, {
      data: monocyteVolcano(20_000),
      options: { labelTopN: 4 },
    }),
  heatmap: (el) =>
    createHeatmap(el, {
      data: expressionMatrix(150, 150),
      options: { colormap: "viridis" },
    }),
  clustermap: (el) =>
    createClustermap(el, {
      data: clusterMatrix(40, 24, 4),
      options: { colormap: "rdbu", zScore: true, linkage: "average" },
    }),
  dotplot: (el) => createDotplot(el, { data: markerPanel() }),
  violin: (el) => createViolin(el, { data: violinPanel() }),
  embedding: (el) =>
    createEmbedding(el, {
      data: pbmcCells(40_000),
      options: { colorMode: "categorical", categories: CELL_TYPES },
    }),
  spatial: (el) => createSpatial(el, { data: tissueSlide() }),
  oncoplot: (el) => createOncoplot(el, { data: cohort(20, 160) }),
  lollipop: (el) => createLollipop(el, { data: protein(400) }),
  km: (el) => createKm(el, { data: survival(), options: { xLabel: "months" } }),
  profile: (el) => createProfile(el, { data: sbs96() }),
  upset: (el) => createUpset(el, { data: geneSets() }),
  treemap: (el) =>
    createTreemap(el, {
      data: geneSetTree(),
      options: { colorBy: "parent" },
    }),
  network: (el) =>
    createNetwork(el, {
      data: geneNetwork(),
      options: { iterations: 400 },
    }),
  hic: (el) =>
    createHic(el, {
      data: contactMap(1024),
      options: { transform: "log", label: "chr (synthetic)" },
    }),
  igv: (el) => createIgv(el, { options: igvDemoOptions }),
  gosling: (el) => createGosling(el, { options: { spec: goslingSpec() } }),
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask `get` every 250 ms until it gives a value, for at most `ms`. */
async function poll<T>(get: () => Promise<T | null> | T | null, ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const value = await get();
    if (value !== null) return value;
    await wait(250);
  }
  return null;
}

/**
 * An image centred on a white PNG of `width` by `height` CSS px at the
 * device pixel ratio, scaled down to fit when it is larger. `size` is the
 * image's size in CSS px.
 */
async function letterbox(
  image: CanvasImageSource,
  size: { width: number; height: number },
  width: number,
  height: number,
) {
  const k = window.devicePixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fit = Math.min(width / size.width, height / size.height, 1);
  const w = size.width * fit * k;
  const h = size.height * fit * k;
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
}

/** An SVG string drawn to a PNG of `width` by `height` CSS px. */
async function svgToPNG(svg: string, width: number, height: number) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await letterbox(img, img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The component's export once it has drawn, as a PNG blob. */
async function capture(
  name: string,
  plot: Plot,
  width: number,
  height: number,
) {
  if (name === "igv") {
    // igv.js exports SVG only. A track name in it shows the track is in.
    const svg = await poll(() => {
      const s = plot.exportSVG?.() ?? "";
      return s.includes("signal (synthetic)") ? s : null;
    }, 30_000);
    if (!svg) throw new Error("igv.js did not load its tracks");
    await wait(1500);
    return svgToPNG(plot.exportSVG?.() ?? svg, width, height);
  }
  if (name === "gosling") {
    // exportPNG gives null until Gosling has mounted. Its tracks draw a
    // moment after that.
    const first = await poll(() => plot.exportPNG?.(1) ?? null, 30_000);
    if (!first) throw new Error("Gosling did not mount");
    await wait(2000);
    // Gosling exports its view at its own size, square for a circular
    // view, so it is centred on a card-sized image.
    const k = window.devicePixelRatio;
    const png = await plot.exportPNG?.(k);
    if (!png) return null;
    const bitmap = await createImageBitmap(png);
    const size = { width: bitmap.width / k, height: bitmap.height / k };
    return letterbox(bitmap, size, width, height);
  }
  // Every other plot draws within a few frames; the scatter plots fit their
  // view again 120 ms after the last resize.
  await wait(900);
  return plot.exportPNG?.(1) ?? null;
}

/** The PNG as WebP, at the best quality that fits in `maxBytes`. */
async function toWebP(png: Blob, maxBytes: number) {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  let out: Blob | null = null;
  let quality = 0.9;
  for (; quality >= 0.4; quality -= 0.05) {
    out = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/webp", quality),
    );
    if (out && out.size <= maxBytes) break;
  }
  if (out?.type !== "image/webp") {
    throw new Error("this browser does not encode WebP");
  }
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return {
    base64: btoa(binary),
    bytes: out.size,
    quality: Math.round(quality * 100) / 100,
    width: bitmap.width,
    height: bitmap.height,
  };
}

/** Render one thumbnail. Called by scripts/landing-thumbnails.mjs. */
async function renderThumbnail(
  name: string,
  width: number,
  height: number,
  maxBytes: number,
) {
  const make = MAKERS[name];
  if (!make) throw new Error(`no thumbnail maker named ${name}`);
  const el = document.createElement("div");
  el.style.cssText = `position:relative;width:${width}px;height:${height}px;`;
  document.body.replaceChildren(el);
  const plot = make(el);
  try {
    plot.resize(width, height);
    const png = await capture(name, plot, width, height);
    if (!png) throw new Error(`${name} exported nothing`);
    return await toWebP(png, maxBytes);
  } finally {
    plot.destroy();
    document.body.replaceChildren();
  }
}

declare global {
  interface Window {
    renderThumbnail: typeof renderThumbnail;
    thumbnailNames: string[];
  }
}

window.renderThumbnail = renderThumbnail;
window.thumbnailNames = Object.keys(MAKERS);
