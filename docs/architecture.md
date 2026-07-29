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
type PlotomicsData = {
  columns: Record<string, ArrayLike<number> | string[]>;
  meta?: Record<string, unknown>;
};

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
references a widget host, which is what makes the same code run in a Jupyter
cell, a Shiny app, an RStudio viewer or a plain web page.

## Option parity, and the one exception

Option keys are camelCase and identical across the JS options object, the R
`options` list and the Python `options` dict, while the user-facing arguments
are snake_case in both wrappers (`fc_threshold` becomes `fcThreshold`). Every JS
option is reachable from R and Python.

The exception is `onSelect`, which is a JS callback and cannot cross the wire.
Each host supplies it instead:

- **R.** `registerComponent()` wraps every widget in `withShinySelection()`
  (`packages/components/src/lib/umd.ts`). Under `HTMLWidgets.shinyMode` it
  injects an `onSelect` that pushes the selected row indices to
  `input$<outputId>_selected` with `priority: "event"`. Outside Shiny it is a
  no-op, and components without a selection ignore the extra key. So a lasso in
  `embeddingOutput("umap")` arrives as `input$umap_selected`, a 0-based integer
  vector. The payload is whatever the component reports: the scatter components
  send row indices, while `network` sends the clicked node's id as a character
  scalar.
- **Python.** Selection is a synced anywidget trait: read `w.selected` (a list
  of 0-based indices) or watch it with `w.observe(fn, names="selected")`.

## Data transport

| Path | Numeric columns | String columns / metadata |
|---|---|---|
| Python → JS | binary buffer + `schema` (`decodeColumns` → typed arrays, zero-copy) | `data.columns` / `data.meta` (JSON) |
| R → JS | JSON arrays (`data.columns`) | `data.columns` / `data.meta` (JSON) |

Both converge on the same `PlotomicsData`. The binary path exists because a
million floats as JSON is ~20 MB of text to parse; as a `Float32Array` buffer
it is 4 MB delivered as a `DataView`. See `packages/core/src/transport.ts` and
`pkg-py/src/plotomics/_base.py::pack_columns`.

## Build & sync

`packages/components/build.mjs` (esbuild) globs `src/entries/{anywidget,umd}/*.ts`
and emits one self-contained bundle per component per target. `scripts/sync-assets.mjs`
copies them into `pkg-r/inst/htmlwidgets/lib/plotomics/` and
`pkg-py/src/plotomics/static/`. These synced dirs are git-tracked and regenerated
by `pnpm dist` (and in CI).

## Rendering strategy per component

The data layer is always GPU/canvas; SVG is reserved for the low-cardinality
overlay (axes, guides, labels, legends). This split keeps interaction at 60fps
on large data while preserving crisp vector output for figures. Concretely:

| Family | Engine | Components |
|---|---|---|
| Large scatter | regl-scatterplot | volcano, embedding |
| Matrices | WebGL/regl, with a LOD pyramid for Hi-C | heatmap, clustermap, hic |
| Networks | sigma v3 + graphology | network |
| Genome tracks | igv.js, Gosling (they stream and tile internally) | igv, gosling |
| Hierarchies | D3 layout + canvas | treemap |
| Structured 2-D figures | canvas 2-D with an SVG overlay | oncoplot, lollipop, km, profile, upset, violin, dotplot, spatial |

The last row is the newer omics gallery. These are bounded in one dimension (a
gene panel, a set count, a protein length) but unbounded in the other, so a
plain canvas is the right tool: it draws a cohort-wide oncoplot or a
thousand-variant lollipop without a GPU context, and the vector overlay still
carries the labels. Hi-C uses regl with its own level-of-detail pyramid and
needs no tile server, so there is no HiGlass dependency anywhere in the tree.
