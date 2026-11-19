/**
 * Pure, dependency-free helpers for the Gosling component.
 *
 * Kept separate from `gosling.ts` so they can be unit-tested under plain Node
 * (Vitest) without importing `gosling.js` — which transitively pulls in
 * HiGlass/PixiJS/React and browser-only ESM that Node cannot resolve. The
 * factory in `gosling.ts` re-uses everything here.
 */

/** Top-level keys that mark an object as a plausible Gosling specification. */
export const SPEC_KEYS = [
  "tracks",
  "views",
  "arrangement",
  "alignment",
  "template",
] as const;

export interface GoslingOptions {
  /** A Gosling.js specification (declarative JSON). Data flows via the spec's
   * own `data` blocks; the factory's `data` argument is ignored. Typed as
   * `unknown` here to avoid importing `gosling.js`; `gosling.ts` narrows it. */
  spec: unknown;
  /** Passed through to `embed()`'s options (outer padding, px). */
  padding?: number;
  /**
   * Gosling's own theme, passed to Gosling as is: a built-in name such as
   * `"light"`, `"dark"` or `"ggplot"`, or a Gosling theme object. It is not
   * a plotomics theme. The other plotting components take a
   * `Partial<PlotomicsTheme>` here (IGV takes no theme), but Gosling draws
   * its own tracks, so no plotomics theme field applies: `background`,
   * `foreground`, `muted`, `grid`, `axis`, `fontFamily`, `fontSize` and
   * `categorical` are not read. Set colours and fonts in the Gosling theme or in the spec.
   */
  theme?: unknown;
}

export const defaultGoslingOptions: GoslingOptions = {
  spec: null,
  padding: undefined,
  theme: undefined,
};

/** Structural check that `spec` is a plausible Gosling spec: a non-null object
 * carrying at least one recognised top-level composition key. Intentionally
 * permissive — Gosling itself does full schema validation; this only guards
 * against handing `embed()` obvious garbage. */
export function isValidSpec(spec: unknown): spec is Record<string, unknown> {
  if (spec == null || typeof spec !== "object" || Array.isArray(spec)) {
    return false;
  }
  return SPEC_KEYS.some((k) => k in (spec as Record<string, unknown>));
}

/** Build the option object passed to `embed()` from component options,
 * dropping `undefined` values so Gosling applies its own defaults. */
export function embedOptions(
  opts: Pick<GoslingOptions, "padding" | "theme">,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (opts.padding !== undefined) out.padding = opts.padding;
  if (opts.theme !== undefined) out.theme = opts.theme;
  return out;
}

/** Merge partial options over a base, treating `spec` as a whole-value replace. */
export function mergeGoslingOptions(
  base: GoslingOptions,
  next?: Partial<GoslingOptions>,
): GoslingOptions {
  if (!next) return { ...base };
  return { ...base, ...next };
}
