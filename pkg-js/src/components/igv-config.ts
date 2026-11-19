/**
 * Pure config-assembly logic for the igv genome viewer.
 *
 * Kept in its own module (free of any `igv` import) so it can be unit-tested in
 * a plain Node environment — the igv.js bundle touches `document` at import
 * time and cannot load headless. The factory in `igv.ts` re-exports everything
 * here so consumers still import from one place.
 */

/**
 * Options for the genome viewer. `config` is a full igv.js browser config and,
 * if supplied, is what the browser is built from. The convenience top-level
 * fields (`genome`, `locus`, `tracks`) are assembled into a config when
 * `config` is absent; with a `config`, `locus` and `tracks` still apply on
 * top of it once the browser is live.
 */
export interface IgvOptions {
  /** A full igv.js browser config ({ genome|reference, locus, tracks: [...] }).
   * When present the browser is built from it and `genome` is not used;
   * `locus` and `tracks` apply on top of it. */
  config: Record<string, unknown> | null;
  /** Genome identifier (e.g. "hg38") used when `config` is not given.
   * `null` sends no genome, so igv.js starts with no reference loaded; the
   * Python wrapper sends `genome=None` as this null. */
  genome: string | null;
  /** Initial locus, e.g. "chr8:127,736,588-127,739,371" or a gene symbol. */
  locus: string | null;
  /** Tracks (igv.js track configs) to load. The list is additive: a track
   * already shown is not loaded again, and one left out stays shown. */
  tracks: Record<string, unknown>[];
}

export const defaultIgvOptions: IgvOptions = {
  config: null,
  genome: "hg38",
  locus: null,
  tracks: [],
};

/**
 * Assemble an igv.js browser config from plotomics options.
 *
 * If `options.config` is provided it wins outright (igv.js owns validation).
 * Otherwise a config is built from the convenience fields: `genome`, `locus`,
 * and `tracks` (only when non-empty). Keys with no value are omitted so igv.js
 * applies its own defaults.
 */
export function assembleConfig(
  options: Partial<IgvOptions>,
): Record<string, unknown> {
  if (options.config && typeof options.config === "object") {
    return { ...options.config };
  }
  const config: Record<string, unknown> = {};
  if (options.genome != null && options.genome !== "") {
    config.genome = options.genome;
  }
  if (options.locus != null && options.locus !== "") {
    config.locus = options.locus;
  }
  if (Array.isArray(options.tracks) && options.tracks.length > 0) {
    config.tracks = options.tracks;
  }
  return config;
}

/** Shallow-merge component options over a base. */
export function mergeOptions(
  base: IgvOptions,
  next?: Partial<IgvOptions>,
): IgvOptions {
  if (!next) return { ...base };
  return { ...base, ...next };
}

/**
 * JSON with the keys of every object in sorted order, so two decodings of
 * the same value give the same text whatever their key order.
 */
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== "function")
      .map((k) => `${JSON.stringify(k)}:${stableJSON(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A key for an igv.js track config: its whole content. Two decodings of the
 * same track give the same key, so sending a track again does not load it
 * twice. A track whose config changed (a new colour, say) is a new track to
 * load, as `tracks` is additive.
 */
export function trackKey(track: Record<string, unknown>): string {
  return stableJSON(track);
}

/**
 * A deep copy of a config for igv.js, which writes into the configs it is
 * given (it adds `type` and `order` to a track and lowercases `format`).
 * With a copy, the stored options stay as they came and still compare equal
 * to the next decoding of the same options.
 */
export function copyForIgv<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // A config that holds a function cannot be copied; igv gets it as is.
    return value;
  }
}
