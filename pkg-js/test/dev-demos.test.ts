import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  followUpEnd,
  goslingDemoSpec,
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

  it.each(seeds)("gives each lollipop residue one letter (seed %i)", (seed) => {
    seedRandom(seed);
    const data = syntheticProtein(600);
    const position = Array.from(data.columns.position as ArrayLike<number>);
    const label = data.columns.label as string[];
    // One row per change.
    expect(new Set(label).size).toBe(label.length);
    const refAt = new Map<number, string>();
    label.forEach((name, i) => {
      // Splice labels name no residue letter (X125_splice).
      if (name.endsWith("_splice")) return;
      const m = /^([A-Z])(\d+)/.exec(name);
      expect(m, name).not.toBeNull();
      const [, ref, p] = m as RegExpExecArray;
      expect(Number(p), name).toBe(position[i]);
      const seen = refAt.get(Number(p)) ?? (ref as string);
      expect(ref, `reference letter of residue ${p}`).toBe(seen);
      refAt.set(Number(p), seen);
    });
  });

  it.each(seeds)(
    "draws a few lollipop changes per hotspot, one far ahead (seed %i)",
    (seed) => {
      seedRandom(seed);
      const data = syntheticProtein(600);
      const position = Array.from(data.columns.position as ArrayLike<number>);
      const count = Array.from(data.columns.count as ArrayLike<number>);
      const hotspots = Object.keys(proteinHotspots).map(Number);
      const tail = count.filter(
        (_, i) => !hotspots.includes(position[i] as number),
      );
      for (const h of hotspots) {
        const counts = count
          .filter((_, i) => position[i] === h)
          .sort((a, b) => b - a);
        expect(counts.length, `changes at ${h}`).toBeGreaterThanOrEqual(2);
        expect(counts.length, `changes at ${h}`).toBeLessThanOrEqual(5);
        const [top, next] = counts as [number, number];
        expect(top, `top change at ${h}`).toBeGreaterThanOrEqual(2 * next);
        expect(top, `top change at ${h}`).toBeGreaterThan(Math.max(...tail));
      }
    },
  );

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

  it.each(seeds)(
    "counts the KM risk table before the events at each time (seed %i)",
    (seed) => {
      seedRandom(seed);
      const data = syntheticSurvival();
      const meta = data.meta as Record<string, unknown>;
      const groups = meta.groups as string[];
      const riskTimes = meta.riskTimes as number[];
      const riskCounts = meta.riskCounts as number[];
      const time = data.columns.time as number[];
      const surv = data.columns.surv as number[];
      const group = data.columns.group as string[];
      let checked = 0;
      groups.forEach((g, k) => {
        const rows = time.map((_, i) => i).filter((i) => group[i] === g);
        riskTimes.forEach((t, j) => {
          const at = rows.findIndex((i) => time[i] === t);
          if (t === 0 || at <= 0) return;
          // The curve drops by d / n(t) at an event time t, where n(t)
          // counts everyone still followed at t. So with the right n(t),
          // n(t) * (1 - S(t) / S(t-)) is the whole number of events d.
          const n = riskCounts[k * riskTimes.length + j] as number;
          const sNow = surv[rows[at] as number] as number;
          const sPrev = surv[rows[at - 1] as number] as number;
          const d = n * (1 - sNow / sPrev);
          expect(d, `${g} events at ${t}`).toBeCloseTo(Math.round(d), 6);
          expect(Math.round(d), `${g} events at ${t}`).toBeGreaterThan(0);
          checked += 1;
        });
      });
      expect(checked).toBeGreaterThan(0);
    },
  );

  it("keeps the Gosling demo's y axis off its legend", () => {
    // Gosling draws a colour legend in the top-right corner of a track, so
    // a y axis on the right prints its numbers over the legend's.
    for (const track of goslingDemoSpec.tracks) {
      const t = track as {
        y?: { axis?: string };
        color?: { legend?: boolean };
      };
      if (t.color?.legend) expect(t.y?.axis).not.toBe("right");
    }
    // The view takes the width of the widget.
    expect(goslingDemoSpec.responsiveSize).toEqual({ width: true });
  });

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
