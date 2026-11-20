import { describe, it, expect } from "vitest";
import {
  matrixSize,
  densifySymmetric,
  autoVmax,
  normalizeIntensity,
  buildLODPyramid,
  pickLODLevel,
  niceTickStep,
  axisTicks,
  tickStep,
  formatCoord,
  formatCoords,
  hicColorbarLabels,
  hicColorbarTicks,
  colormapLUT,
  encodeIntensity,
} from "../src/components/hic.js";

describe("hic colour bar ticks", () => {
  const gaps = { minGapPx: 18, endGapPx: 13 };
  const labels = (t: { label: string }[]) => t.map((x) => x.label);

  it("labels round values of a linear scale in one unit", () => {
    // Before, the raw ends: "1.2e+4" over "5".
    const t = hicColorbarTicks(5, 12_345.6, "linear", 400, gaps);
    expect(labels(t)).toEqual(["2k", "4k", "6k", "8k", "10k", "12k"]);
    expect(t.map((x) => x.value)).toEqual([
      2000, 4000, 6000, 8000, 10_000, 12_000,
    ]);
    for (const x of t) {
      expect(x.at).toBeCloseTo((x.value - 5) / (12_345.6 - 5), 9);
    }
    expect(labels(hicColorbarTicks(-2, 2, "linear", 400, gaps))).toEqual([
      "-2",
      "-1",
      "0",
      "1",
      "2",
    ]);
  });

  it("labels powers of ten of a log scale, where the bar has room", () => {
    const tall = hicColorbarTicks(0, 12_345.6, "log", 400, gaps);
    expect(labels(tall)).toEqual(["0", "1", "10", "100", "1k", "10k"]);
    for (const x of tall) {
      expect(x.at).toBeCloseTo(Math.log1p(x.value) / Math.log1p(12_345.6), 9);
    }
    // 1, 2 and 5 times each power when they fit.
    expect(labels(hicColorbarTicks(0, 60, "log", 600, gaps))).toEqual([
      "0",
      "1",
      "2",
      "5",
      "10",
      "20",
      "50",
    ]);
    // Every second power on a short bar, then fewer, never touching.
    for (const length of [120, 60, 30, 12]) {
      const t = hicColorbarTicks(0, 1_234_567, "log", length, gaps);
      expect(t.length).toBeGreaterThan(0);
      for (let i = 1; i < t.length; i += 1) {
        const gap = ((t[i]?.at as number) - (t[i - 1]?.at as number)) * length;
        expect(gap).toBeGreaterThanOrEqual(gaps.minGapPx);
      }
    }
    // A scale from vmin above 0 starts at the first power inside it.
    expect(labels(hicColorbarTicks(5, 12_345.6, "log", 400, gaps))).toEqual([
      "10",
      "20",
      "50",
      "100",
      "200",
      "500",
      "1k",
      "2k",
      "5k",
      "10k",
    ]);
    expect(labels(hicColorbarTicks(5, 12_345.6, "log", 150, gaps))).toEqual([
      "10",
      "100",
      "1k",
      "10k",
    ]);
  });

  it("labels the powers of a large log scale short, in one notation", () => {
    // Before, every power printed in full, "1000000000", which a narrow
    // margin cut or left out.
    expect(labels(hicColorbarTicks(0, 1e6, "log", 80, gaps))).toEqual([
      "1",
      "100",
      "10k",
      "1M",
    ]);
    expect(labels(hicColorbarTicks(0, 5e8, "log", 400, gaps))).toContain(
      "100M",
    );
    // From a billion up, every power takes the exponent form.
    const billion = labels(hicColorbarTicks(0, 1e9, "log", 160, gaps));
    expect(billion[billion.length - 1]).toBe("1e+9");
    for (const s of billion) expect(s).toMatch(/^(0|[125]e\+\d+)$/);
    const huge = labels(hicColorbarTicks(0, 1e15, "log", 120, gaps));
    expect(huge[huge.length - 1]).toBe("1e+15");
    for (const s of huge) expect(s.length).toBeLessThanOrEqual(5);
  });

  it("takes the exponent form when the unit form is wider than the room", () => {
    // Before, "10000M" did not fit a narrow bar, and only "0" was left.
    const width = (s: string) => 7 * s.length;
    const t = hicColorbarTicks(0, 1e10, "linear", 400, {
      ...gaps,
      roomPx: width("1e+10"),
      labelPx: width,
    });
    expect(labels(t)).toEqual(["0", "1e+10"]);
    // With room, the unit form stays.
    const wide = hicColorbarTicks(0, 1e10, "linear", 400, {
      ...gaps,
      roomPx: 100,
      labelPx: width,
    });
    expect(labels(wide)).toContain("10000M");
  });

  it("takes a coarser linear step when the labels are wider than the room", () => {
    const width = (s: string) => 7 * s.length;
    const t = hicColorbarTicks(0, 1e15, "linear", 400, {
      ...gaps,
      roomPx: 40,
      labelPx: width,
    });
    expect(labels(t)).toEqual(["0", "1e+15"]);
  });

  it("takes round linear ticks where log1p is near linear", () => {
    expect(labels(hicColorbarTicks(0, 0.05, "log", 400, gaps))).toEqual([
      "0.00",
      "0.01",
      "0.02",
      "0.03",
      "0.04",
      "0.05",
    ]);
    expect(labels(hicColorbarTicks(0, 5, "log", 400, gaps))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("labels a flat scale once, at the middle", () => {
    expect(hicColorbarTicks(3, 3, "linear", 400, gaps)).toEqual([
      { value: 3, label: "3", at: 0.5 },
    ]);
  });

  it("lists every label a bar of any length can take", () => {
    for (const [lo, hi, tr] of [
      [5, 12_345.6, "linear"],
      [0, 1_234_567, "log"],
      [0, 0.05, "log"],
    ] as const) {
      const all = new Set(hicColorbarLabels(lo, hi, tr));
      for (const length of [12, 30, 60, 120, 400, 900]) {
        for (const x of hicColorbarTicks(lo, hi, tr, length, gaps)) {
          expect(all.has(x.label), `${x.label} at ${length} px`).toBe(true);
        }
      }
    }
  });
});

describe("hic helpers", () => {
  it("reads n from meta and infers from a square dense length", () => {
    expect(matrixSize({ n: 4 })).toBe(4);
    expect(matrixSize(undefined, 9)).toBe(3); // 3x3
    expect(matrixSize(undefined, 10)).toBe(0); // not a perfect square
    expect(matrixSize({})).toBe(0);
  });

  it("densifies a sparse triplet and mirrors when symmetric", () => {
    // upper triangle only: (0,1)=5, (0,2)=2
    const m = densifySymmetric([0, 0], [1, 2], [5, 2], 3, true);
    expect(m[0 * 3 + 1]).toBe(5);
    expect(m[1 * 3 + 0]).toBe(5); // mirrored
    expect(m[0 * 3 + 2]).toBe(2);
    expect(m[2 * 3 + 0]).toBe(2); // mirrored
    expect(m[1 * 3 + 2]).toBe(0); // untouched
  });

  it("does not mirror when symmetric=false and skips out-of-range indices", () => {
    const m = densifySymmetric([0, 5], [1, 5], [7, 9], 3, false);
    expect(m[0 * 3 + 1]).toBe(7);
    expect(m[1 * 3 + 0]).toBe(0); // not mirrored
    // (5,5) is out of range for n=3 -> skipped, no throw
    expect(m.length).toBe(9);
  });

  it("auto vmax approximates an upper percentile of positive values", () => {
    const vals = new Float32Array(1000);
    for (let i = 0; i < 1000; i += 1) vals[i] = i; // 0..999
    const v = autoVmax(vals, 0.99);
    // ~99th percentile of 0..999 is near 990; the log histogram is approximate.
    expect(v).toBeGreaterThan(800);
    expect(v).toBeLessThanOrEqual(1000);
  });

  it("auto vmax returns 1 when there are no positive values", () => {
    expect(autoVmax(new Float32Array([0, 0, 0]))).toBe(1);
  });

  it("normalizes intensity on log and linear scales into [0,1]", () => {
    expect(normalizeIntensity(0, 0, 100, "linear")).toBe(0);
    expect(normalizeIntensity(100, 0, 100, "linear")).toBe(1);
    expect(normalizeIntensity(50, 0, 100, "linear")).toBeCloseTo(0.5, 5);
    // log compresses the high end
    expect(normalizeIntensity(0, 0, 100, "log")).toBe(0);
    expect(normalizeIntensity(100, 0, 100, "log")).toBeCloseTo(1, 5);
    expect(normalizeIntensity(1000, 0, 100, "log")).toBe(1); // clamped
  });

  it("builds a shrinking LOD pyramid finest-first", () => {
    const n = 8;
    const dense = new Float32Array(n * n).fill(2);
    const levels = buildLODPyramid(dense, n, 2);
    expect(levels[0]!.size).toBe(8);
    // sizes strictly decrease
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!.size).toBeLessThan(levels[i - 1]!.size);
    }
    // mean pooling of a constant matrix keeps the constant
    expect(levels[levels.length - 1]!.data[0]).toBeCloseTo(2, 5);
  });

  it("mean-pools 2x2 blocks correctly", () => {
    // 2x2 = [[1,2],[3,4]] -> single value 2.5
    const dense = new Float32Array([1, 2, 3, 4]);
    const levels = buildLODPyramid(dense, 2, 1);
    const coarsest = levels[levels.length - 1]!;
    expect(coarsest.size).toBe(1);
    expect(coarsest.data[0]).toBeCloseTo(2.5, 5);
  });

  it("picks a coarse level when zoomed out and finest when zoomed in", () => {
    const levels = [
      { size: 1024 },
      { size: 512 },
      { size: 256 },
      { size: 128 },
    ];
    // whole 1024-bin map into ~256 device px -> coarse level
    expect(pickLODLevel(levels, 1024, 256)).toBeGreaterThan(0);
    // 200 visible bins into 800 px -> finest level fits
    expect(pickLODLevel(levels, 200, 800)).toBe(0);
    // single level always 0
    expect(pickLODLevel([{ size: 10 }], 10, 100)).toBe(0);
  });

  it("computes nice tick steps and in-range tick positions", () => {
    expect(niceTickStep(100, 5)).toBe(20);
    expect(niceTickStep(50, 5)).toBe(10);
    const ticks = axisTicks(0, 100, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]!).toBeLessThanOrEqual(100);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it("formats genomic coordinates in bp / kb / Mb", () => {
    expect(formatCoord(500)).toBe("500");
    expect(formatCoord(2000)).toBe("2kb");
    expect(formatCoord(3_000_000)).toBe("3Mb");
  });

  it("labels the ticks of one axis in the unit of the largest", () => {
    // Before, each label took its own unit: "800kb, 1.0Mb".
    expect(formatCoords([0, 400_000, 800_000, 1_200_000], 400_000)).toEqual([
      "0",
      "0.4Mb",
      "0.8Mb",
      "1.2Mb",
    ]);
    expect(formatCoords([500, 1000, 1500], 500)).toEqual([
      "0.5kb",
      "1.0kb",
      "1.5kb",
    ]);
    expect(formatCoords([0, 200, 400], 200)).toEqual(["0", "200", "400"]);
    expect(formatCoords([999_000, 1_000_000], 1_000)).toEqual([
      "0.999Mb",
      "1.000Mb",
    ]);
  });

  it("keeps the zeros of whole coordinates", () => {
    expect(formatCoord(100_000)).toBe("100kb");
    expect(formatCoord(120_000)).toBe("120kb");
    expect(formatCoord(150_000_000)).toBe("150Mb");
    expect(formatCoord(200_000_000)).toBe("200Mb");
    expect(formatCoord(2_500_000)).toBe("2.5Mb");
  });

  it("prints enough decimals to tell neighbouring ticks and bins apart", () => {
    // Full chr1 view at 250 kb bins: ticks every 25 Mb.
    const full = axisTicks(0, 1000, 10).map((t) =>
      formatCoord(t * 250_000, 25_000_000),
    );
    expect(full).toEqual([
      "0",
      "25Mb",
      "50Mb",
      "75Mb",
      "100Mb",
      "125Mb",
      "150Mb",
      "175Mb",
      "200Mb",
      "225Mb",
      "250Mb",
    ]);
    // Zoomed to bins 2500-2540 at 10 kb: every label differs.
    const step = tickStep(2500, 2540) * 10_000;
    const zoomed = axisTicks(2500, 2540).map((t) =>
      formatCoord(t * 10_000, step),
    );
    expect(new Set(zoomed).size).toBe(zoomed.length);
    expect(zoomed[0]).toBe("25.00Mb");
    // Tooltip: adjacent 10 kb bins.
    expect(
      [2501, 2502, 2503].map((b) => formatCoord(b * 10_000, 10_000)),
    ).toEqual(["25.01Mb", "25.02Mb", "25.03Mb"]);
  });

  it("states steps such as 2.5 and 0.25 exactly", () => {
    // 80 bins of 250 kb: ticks every 10 bins = 2.5 Mb.
    const step = tickStep(0, 80) * 250_000;
    expect(step).toBe(2_500_000);
    expect(axisTicks(0, 80).map((t) => formatCoord(t * 250_000, step))).toEqual(
      [
        "0",
        "2.5Mb",
        "5.0Mb",
        "7.5Mb",
        "10.0Mb",
        "12.5Mb",
        "15.0Mb",
        "17.5Mb",
        "20.0Mb",
      ],
    );
    // A 250 kb step from 1 Mb, and 250 kb bins in the tooltip.
    expect(
      [1e6, 1.25e6, 1.5e6, 1.75e6].map((bp) => formatCoord(bp, 250_000)),
    ).toEqual(["1.00Mb", "1.25Mb", "1.50Mb", "1.75Mb"]);
    expect(formatCoord(5 * 250_000, 250_000)).toBe("1.25Mb");
    // 2.5 Mb bins.
    expect([1, 2, 3].map((b) => formatCoord(b * 2_500_000, 2_500_000))).toEqual(
      ["2.5Mb", "5.0Mb", "7.5Mb"],
    );
  });

  it("keeps a missing sparse value missing", () => {
    const m = densifySymmetric(
      [0, 1],
      [1, 2],
      [null as unknown as number, 5],
      4,
      true,
    );
    expect(Number.isNaN(m[0 * 4 + 1])).toBe(true);
    expect(Number.isNaN(m[1 * 4 + 0])).toBe(true);
    expect(m[1 * 4 + 2]).toBe(5);
    expect(m[3 * 4 + 3]).toBe(0); // no contact stays 0
  });

  it("ticks whole bins on an index axis", () => {
    expect(axisTicks(10, 12.5, 6, 1)).toEqual([10, 11, 12]);
    expect(axisTicks(0, 3, 6, 1)).toEqual([0, 1, 2, 3]);
  });

  it("leaves NaN out of the pooled mean and Inf out of the auto vmax", () => {
    // 2x2 = [[NaN, 2], [4, NaN]] -> mean of 2 and 4
    const levels = buildLODPyramid(
      new Float32Array([Number.NaN, 2, 4, Number.NaN]),
      2,
      1,
    );
    expect(levels[1]!.data[0]).toBeCloseTo(3, 5);
    // a block with no numbers stays NaN
    const empty = buildLODPyramid(new Float32Array(4).fill(Number.NaN), 2, 1);
    expect(Number.isNaN(empty[1]!.data[0])).toBe(true);
    const vals = new Float32Array(1000).map((_, i) => i);
    vals[0] = Number.POSITIVE_INFINITY;
    expect(Number.isFinite(autoVmax(vals, 0.99))).toBe(true);
  });

  it("encodes intensities as bytes with 0 for background", () => {
    const bytes = encodeIntensity(
      [Number.NaN, 0, 50, 100, 1000],
      0,
      100,
      "linear",
    );
    // A missing cell is 0, no signal 1, and the scale runs from 2 to 255.
    expect(Array.from(bytes)).toEqual([0, 1, 129, 255, 255]);
    // A negative vmin on the linear scale clamps low values to the first color.
    const diverging = encodeIntensity([-5, -2, 0, 2], -2, 2, "linear");
    expect(Array.from(diverging)).toEqual([2, 2, 129, 255]);
    // The log scale keeps zero contacts as no signal, a code of their own
    // that is not the code of a missing cell.
    expect(Array.from(encodeIntensity([0, Number.NaN], 0, 10, "log"))).toEqual([
      1, 0,
    ]);
  });

  it("builds an rdbu lookup that differs from viridis", () => {
    const rdbu = colormapLUT("rdbu");
    const vir = colormapLUT("viridis");
    expect(Array.from(rdbu.slice(0, 3))).not.toEqual(
      Array.from(vir.slice(0, 3)),
    );
  });

  it("produces a 256-entry RGBA colormap LUT", () => {
    const lut = colormapLUT("viridis");
    expect(lut.length).toBe(256 * 4);
    // alpha fully opaque
    expect(lut[3]).toBe(255);
    expect(lut[255 * 4 + 3]).toBe(255);
    // viridis goes dark purple -> yellow; first entry darker than last
    const first = lut[0]! + lut[1]! + lut[2]!;
    const last = lut[255 * 4]! + lut[255 * 4 + 1]! + lut[255 * 4 + 2]!;
    expect(last).toBeGreaterThan(first);
  });
});
