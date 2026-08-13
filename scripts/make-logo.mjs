/**
 * Builds the plotomics hex logo and favicon.
 *
 * The mark is a tissue section split down the middle: binned into solid
 * hexagonal cells on the left, drawn point by point on the right. Both halves
 * are sampled from one density field, so the two sides always describe the same
 * data. That contrast is the argument for the library, which is why the logo
 * makes it rather than showing a chart.
 *
 * Point placement is seeded, so this script is deterministic. Re-running it
 * reproduces the committed files byte for byte; changing SEED reshuffles the
 * scatter and nothing else.
 *
 * Usage:  pnpm logo
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Geometry. Pointy-top hexagon, the shape the R hexSticker standard uses
// (2 by 2.31 inches). The canvas carries about a unit of clearance past the
// stroke so nothing clips when this is rasterised.
// ---------------------------------------------------------------------------

const W = 174;
const H = 200;
const CX = 87;
const CY = 100;
const R = 96;
const APOTHEM = R * Math.cos(Math.PI / 6);
const STROKE = 6;

const PALETTE = {
  ground: "#EDE6D8", // bone paper
  layer1: "#8E2A3C", // oxblood
  layer2: "#C4643F", // clay
  layer3: "#3A3634", // graphite
};

const BIN_RADIUS = 17;
const POINT_COUNT = 96;
const SEED = 7202;

function hexCorners(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const t = (Math.PI / 180) * (90 + 60 * i);
    pts.push(
      `${(cx + r * Math.cos(t)).toFixed(4)},${(cy - r * Math.sin(t)).toFixed(4)}`,
    );
  }
  return pts.join(" ");
}

const OUTLINE = hexCorners(CX, CY, R);

/** Distance from the centre to the hex edge along a given angle. */
function hexRadius(angle) {
  const deg = (angle * 180) / Math.PI;
  const phi = ((((deg - 30) % 60) + 60) % 60) - 30;
  return APOTHEM / Math.cos((phi * Math.PI) / 180);
}

/** xorshift32, so the scatter is identical on every machine. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 0) / 4294967295;
  };
}

/**
 * The tissue: an irregular section holding three layers, with a boundary that
 * wanders instead of running straight. The wander is the point. It is what the
 * binned side cannot keep and the drawn side can.
 */
function tissue(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  const angle = Math.atan2(-dy, dx);
  const edge =
    76 *
    (1 + 0.15 * Math.sin(3 * angle + 0.7) + 0.08 * Math.sin(5 * angle + 2.2));
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > edge) return null;
  const band = y + 17 * Math.sin(x / 21) + 6 * Math.sin(x / 9);
  const color =
    band < 76 ? PALETTE.layer1 : band < 126 ? PALETTE.layer2 : PALETTE.layer3;
  return { t: 0.55 + 0.45 * (1 - dist / edge), color };
}

/** Left half: the field read once per lattice cell and flattened to a fill. */
function binnedCells() {
  const out = [];
  const stepX = (BIN_RADIUS * Math.sqrt(3)) / 2;
  const stepY = BIN_RADIUS * 1.5;
  const reach = Math.ceil(140 / BIN_RADIUS) + 1;
  for (let q = -reach; q <= reach; q += 1) {
    for (let s = -reach; s <= reach; s += 1) {
      const x = CX + stepX * (2 * q + s);
      const y = CY + stepY * s;
      if (x < -30 || x > 204 || y < -30 || y > 230) continue;
      const v = tissue(x, y);
      if (!v) continue;
      out.push(
        `<polygon points="${hexCorners(x, y, BIN_RADIUS - 0.7)}" fill="${v.color}" opacity="${(
          0.34 + v.t * 0.62
        ).toFixed(2)}"/>`,
      );
    }
  }
  return out;
}

/** Right half: the same field, rejection sampled one mark at a time. */
function scatteredPoints() {
  const rand = rng(SEED);
  const out = [];
  let placed = 0;
  let guard = 0;
  while (placed < POINT_COUNT && guard < 40000) {
    guard += 1;
    const x = rand() * W;
    const y = rand() * H;
    if (x < CX) continue;
    const dx = x - CX;
    const dy = y - CY;
    if (Math.sqrt(dx * dx + dy * dy) > hexRadius(Math.atan2(-dy, dx)) - 5)
      continue;
    const v = tissue(x, y);
    if (!v || rand() > v.t) continue;
    const r = 1.7 + rand() * 1.9;
    const opacity = 0.62 + rand() * 0.38;
    out.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${
        v.color
      }" opacity="${opacity.toFixed(2)}"/>`,
    );
    placed += 1;
  }
  return out;
}

function buildLogo() {
  const indent = (lines, pad) => lines.map((l) => `${pad}${l}`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="plotomics">
  <title>plotomics</title>
  <defs>
    <clipPath id="hex" clipPathUnits="userSpaceOnUse">
      <polygon points="${OUTLINE}"/>
    </clipPath>
    <clipPath id="left" clipPathUnits="userSpaceOnUse">
      <rect x="0" y="0" width="${CX}" height="${H}"/>
    </clipPath>
    <clipPath id="right" clipPathUnits="userSpaceOnUse">
      <rect x="${CX}" y="0" width="${W - CX}" height="${H}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#hex)">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${PALETTE.ground}"/>
    <g clip-path="url(#left)">
${indent(binnedCells(), "      ")}
    </g>
    <g clip-path="url(#right)">
${indent(scatteredPoints(), "      ")}
    </g>
    <line x1="${CX}" y1="0" x2="${CX}" y2="${H}" stroke="${PALETTE.layer3}" stroke-width="1" opacity="0.3"/>
  </g>
  <polygon points="${OUTLINE}" fill="none" stroke="${PALETTE.layer1}" stroke-width="${STROKE}" stroke-linejoin="round"/>
</svg>
`;
}

/**
 * The favicon is the same idea reduced until it survives 16 pixels: solid on
 * the left, points on the right. The lattice and the layers are both too fine
 * to register at that size, so neither is drawn.
 */
function buildFavicon() {
  const fCX = 16;
  const fCY = 16;
  const fR = 14.4;
  const outline = hexCorners(fCX, fCY, fR);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="plotomics">
  <defs>
    <clipPath id="fhex" clipPathUnits="userSpaceOnUse">
      <polygon points="${outline}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#fhex)">
    <rect x="0" y="0" width="32" height="32" fill="${PALETTE.ground}"/>
    <rect x="0" y="0" width="${fCX}" height="32" fill="${PALETTE.layer2}"/>
    <circle cx="21" cy="10.5" r="2" fill="${PALETTE.layer1}"/>
    <circle cx="25.2" cy="16.6" r="2" fill="${PALETTE.layer1}"/>
    <circle cx="20.4" cy="21.6" r="2" fill="${PALETTE.layer3}"/>
  </g>
  <polygon points="${outline}" fill="none" stroke="${PALETTE.layer1}" stroke-width="2.4" stroke-linejoin="round"/>
</svg>
`;
}

async function emit(target, contents) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  const size = Buffer.byteLength(contents);
  console.log(`  ${relative(ROOT, target)}  ${(size / 1024).toFixed(1)} KB`);
}

async function emitPng(target, svg, width) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();
  await emit(target, png);
}

const logo = buildLogo();
const favicon = buildFavicon();

console.log("logo");
await emit(join(ROOT, "assets", "logo.svg"), logo);
await emitPng(join(ROOT, "assets", "logo.png"), logo, 1200);
await emit(join(ROOT, "pkg-r", "man", "figures", "logo.svg"), logo);
await emitPng(join(ROOT, "pkg-r", "man", "figures", "logo.png"), logo, 240);

console.log("favicon");
await emit(join(ROOT, "assets", "favicon.svg"), favicon);
await emitPng(join(ROOT, "assets", "favicon.png"), favicon, 512);
await emit(join(ROOT, "docs", "favicon.svg"), favicon);
