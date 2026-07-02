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
 * if supplied, takes precedence. The convenience top-level fields (`genome`,
 * `locus`, `tracks`) are assembled into a config when `config` is absent.
 */
export interface IgvOptions {
  /** A full igv.js browser config ({ genome|reference, locus, tracks: [...] }).
   * When present it is used as-is and the convenience fields are ignored. */
  config: Record<string, unknown> | null;
  /** Genome identifier (e.g. "hg38") used when `config` is not given. */
  genome: string | null;
  /** Initial locus, e.g. "chr8:127,736,588-127,739,371" or a gene symbol. */
  locus: string | null;
  /** Initial tracks (igv.js track configs) used when `config` is not given. */
  tracks: Record<string, unknown>[];
}

export const defaultIgvOptions: IgvOptions = {
  config: null,
  genome: "hg38",
  locus: null,
  tracks: [],
};

/**
 * Assemble an igv.js browser config from bioviz options.
 *
 * If `options.config` is provided it wins outright (igv.js owns validation).
 * Otherwise a config is built from the convenience fields: `genome`, `locus`,
 * and `tracks` (only when non-empty). Keys with no value are omitted so igv.js
 * applies its own defaults.
 */
export function assembleConfig(options: Partial<IgvOptions>): Record<string, unknown> {
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
export function mergeOptions(base: IgvOptions, next?: Partial<IgvOptions>): IgvOptions {
  if (!next) return { ...base };
  return { ...base, ...next };
}
