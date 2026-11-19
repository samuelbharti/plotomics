import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  followUpEnd,
  igvDemoOptions,
  proteinHotspots,
  syntheticCohort,
  syntheticProtein,
  syntheticSurvival,
} from "../dev/demo-data.js";

// The demos draw from Math.random. A seeded generator in its place makes
// each run of these tests see the same draws.
function seedRandom(seed: number) {
  let a = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

const seeds = [1, 2, 3, 4, 5];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dev harness demo data", () => {
  it.each(seeds)(
    "lists oncoplot genes by their frequency (seed %i)",
    (seed) => {
      seedRandom(seed);
      const ngenes = 60;
      const nsamples = 1200;
      const data = syntheticCohort(ngenes, nsamples);
      const codes = data.columns.codes as ArrayLike<number>;
      const freq = Array.from(data.columns.freq as ArrayLike<number>);
      for (let r = 0; r < ngenes; r += 1) {
        let hits = 0;
        for (let c = 0; c < nsamples; c += 1) {
          if ((codes[r * nsamples + c] as number) > 0) hits += 1;
        }
        // The percentage shown is the one the grid row holds.
        expect(freq[r]).toBeCloseTo((100 * hits) / nsamples, 4);
      }
      const sorted = [...freq].sort((a, b) => b - a);
      expect(freq).toEqual(sorted);
    },
  );

  it.each(seeds)("puts lollipop rows on every hotspot (seed %i)", (seed) => {
    seedRandom(seed);
    const n = 600;
    const position = Array.from(
      syntheticProtein(n).columns.position as ArrayLike<number>,
    );
    // Every fifth variant is a hotspot row, so each of the five hotspots
    // holds at least a fifth of those.
    for (const h of proteinHotspots) {
      const rows = position.filter((p) => p === h).length;
      expect(rows, `rows at residue ${h}`).toBeGreaterThanOrEqual(
        n / 5 / proteinHotspots.length,
      );
    }
  });

  it.each(seeds)(
    "censors the KM subjects left at the end (seed %i)",
    (seed) => {
      seedRandom(seed);
      const data = syntheticSurvival();
      const meta = data.meta as Record<string, unknown>;
      const groups = meta.groups as string[];
      const riskTimes = meta.riskTimes as number[];
      const riskCounts = meta.riskCounts as number[];
      const censorTime = meta.censorTime as number[];
      const censorGroup = meta.censorGroup as string[];
      const time = data.columns.time as number[];
      const surv = data.columns.surv as number[];
      const group = data.columns.group as string[];
      expect(riskTimes.at(-1)).toBe(followUpEnd);

      groups.forEach((g, k) => {
        const atEnd = riskCounts[k * riskTimes.length + riskTimes.length - 1];
        const lastSurv = surv.filter((_, i) => group[i] === g).at(-1);
        const censoredAtEnd = censorTime.some(
          (t, i) => censorGroup[i] === g && t === followUpEnd,
        );
        // Subjects followed to the end and still alive are censored there,
        // which is also where the curve has to run to.
        if ((atEnd as number) > 0 && (lastSurv as number) > 0) {
          expect(censoredAtEnd, `${g} censored at ${followUpEnd}`).toBe(true);
        }
        const ends = [
          ...time.filter((_, i) => group[i] === g),
          ...censorTime.filter((_, i) => censorGroup[i] === g),
        ];
        if ((lastSurv as number) > 0) {
          expect(Math.max(...ends), `${g} curve end`).toBe(followUpEnd);
        }
      });
    },
  );

  it("reads the IGV demo files from the harness, not the network", () => {
    const config = igvDemoOptions.config as Record<string, unknown>;
    expect(config.loadDefaultGenomes).toBe(false);
    expect(igvDemoOptions.genome).toBeUndefined();
    const reference = config.reference as { fastaURL: string };
    const tracks = config.tracks as { url: string }[];
    const urls = [reference.fastaURL, ...tracks.map((t) => t.url)];
    expect(tracks.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("file:"), url).toBe(true);
      expect(existsSync(fileURLToPath(url)), url).toBe(true);
    }
  });
});
