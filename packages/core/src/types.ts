/**
 * Core contract shared by every plotomics component.
 *
 * A component is a *headless, imperative factory*: it knows nothing about R,
 * Python, anywidget or htmlwidgets. It receives a DOM element plus initial
 * data/options and returns an instance with a small, stable lifecycle API.
 *
 * The wrapper adapters (anywidget / htmlwidgets) are thin shims that translate
 * their host's data model into this contract. Keeping the contract narrow is
 * what lets one component power both R and Python with zero duplicated logic.
 */

/** A numeric or string column. Numeric columns may be plain arrays or typed
 * arrays — components must accept both (typed arrays are the fast path used by
 * the binary transport; JSON wrappers deliver plain arrays). */
export type Column = ArrayLike<number> | string[];

/** Columnar dataset. Every component consumes the same shape regardless of
 * which language produced it. `meta` carries small, non-columnar values
 * (labels, level names, thresholds, precomputed layouts, etc.). */
export interface PlotomicsData {
  columns: Record<string, Column>;
  meta?: Record<string, unknown>;
}

/** Lifecycle handle returned by a component factory. */
export interface PlotomicsInstance<TOptions = Record<string, unknown>> {
  /** Replace the rendered dataset. Must be cheap to call repeatedly. */
  setData(data: PlotomicsData): void;
  /** Merge new options and re-render affected parts. */
  setOptions(options: Partial<TOptions>): void;
  /** React to a container size change (CSS pixels). */
  resize(width: number, height: number): void;
  /** Publication export: standalone SVG string, or null if not supported. */
  exportSVG?(): string | null;
  /** Publication export: rasterized PNG blob, or null if not supported. */
  exportPNG?(scale?: number): Promise<Blob | null>;
  /** Release all GPU/DOM/listener resources. Idempotent. */
  destroy(): void;
}

/** Factory signature every component module must export as `create<Name>`. */
export type PlotomicsFactory<TOptions = Record<string, unknown>> = (
  el: HTMLElement,
  initial: { data?: PlotomicsData; options?: Partial<TOptions> },
) => PlotomicsInstance<TOptions>;
