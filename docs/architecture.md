# Architecture

## Goals

1. **One implementation, two languages.** A component's logic lives once, in
   TypeScript. R and Python are thin wrappers, not reimplementations.
2. **Large datasets, smooth interaction.** GPU/canvas rendering; binary data
   transport; typed arrays end to end.
3. **Publication-ready.** Vector overlays for axes/labels/legends and SVG/PNG
   export, not just screenshots.
4. **Parallel-friendly.** Adding a component touches almost only new files.

## Layers

```
                    ┌───────────────────────────┐
   R (htmlwidgets)  │  window.plotomics.htmlwidget  │  JSON columns
                    └─────────────┬─────────────-┘
                                  │  registerComponent()
      ┌───────────────────────────▼───────────────────────────┐
      │        @plotomics/components  (headless factories)         │
      │   create<Name>(el, {data, options}) -> PlotomicsInstance   │
      └───────────────────────────▲───────────────────────────┘
                                  │  makeAnywidget()
                    ┌─────────────┴─────────────┐
 Python (anywidget) │   export default {render} │  binary buffer + schema
                    └───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │        @plotomics/core        │
                    │ contract · theme · color · │
                    │ transport · dom · export   │
                    └───────────────────────────┘
```

## The contract (`@plotomics/core`)

```ts
type PlotomicsData = { columns: Record<string, ArrayLike<number> | string[]>; meta?: object };

interface PlotomicsInstance<O> {
  setData(d: PlotomicsData): void;
  setOptions(o: Partial<O>): void;
  resize(w: number, h: number): void;
  exportSVG?(): string | null;
  exportPNG?(scale?: number): Promise<Blob | null>;
  destroy(): void;
}
```

A factory is `(el, {data, options}) => PlotomicsInstance`. Nothing in a component
references a widget host — that is what makes the same code run in a Jupyter
cell, a Shiny app, an RStudio viewer or a plain web page.

## Data transport

| Path | Numeric columns | String columns / metadata |
|---|---|---|
| Python → JS | binary buffer + `schema` (`decodeColumns` → typed arrays, zero-copy) | `data.columns` / `data.meta` (JSON) |
| R → JS | JSON arrays (`data.columns`) | `data.columns` / `data.meta` (JSON) |

Both converge on the same `PlotomicsData`. The binary path exists because a
million floats as JSON is ~20 MB of text to parse; as a `Float32Array` buffer
it is 4 MB delivered as a `DataView`. See `packages/core/src/transport.ts` and
`python/src/plotomics/_base.py::pack_columns`.

## Build & sync

`packages/components/build.mjs` (esbuild) globs `src/entries/{anywidget,umd}/*.ts`
and emits one self-contained bundle per component per target. `scripts/sync-assets.mjs`
copies them into `r/plotomics/inst/htmlwidgets/lib/plotomics/` and
`python/src/plotomics/static/`. These synced dirs are git-ignored and regenerated
by `pnpm dist` (and in CI).

## Rendering strategy per component

The data layer is always GPU/canvas; SVG is reserved for the low-cardinality
overlay (axes, guides, labels, legends). This split keeps interaction at 60fps
on large data while preserving crisp vector output for figures. Concretely:
regl-scatterplot (scatter), WebGL/regl or canvas tiling (matrices), sigma v3 +
graphology (networks), HiGlass (Hi-C), igv.js and Gosling (genome tracks, which
stream and tile internally).
