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
      │        plotomics  (headless factories)         │
      │   create<Name>(el, {data, options}) -> PlotomicsInstance   │
      └───────────────────────────▲───────────────────────────┘
                                  │  makeAnywidget()
                    ┌─────────────┴─────────────┐
 Python (anywidget) │   export default {render} │  binary buffer + schema
                    └───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │        plotomics/core        │
                    │ contract · theme · color · │
                    │ transport · dom · export   │
                    └───────────────────────────┘
```

## The contract (`plotomics/core`)

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
  (`pkg-js/src/lib/umd.ts`). Under `HTMLWidgets.shinyMode` it
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
it is 4 MB delivered as a `DataView`. See `pkg-js/src/core/transport.ts` and
`pkg-py/src/plotomics/_base.py::pack_columns`.

## Build & sync

`pkg-js/build.mjs` (esbuild) globs `src/entries/{anywidget,umd}/*.ts`
and emits one self-contained bundle per component per target. `scripts/sync-assets.mjs`
copies them into `pkg-r/inst/htmlwidgets/lib/plotomics/` and
`pkg-py/src/plotomics/static/`. These synced dirs are git-tracked and regenerated
by `pnpm dist` (and in CI).

## Rendering strategy per component

The data layer is always GPU/canvas; SVG is reserved for the low-cardinality
overlay (axes, guides, labels, legends). This split keeps interaction at 60fps
on large data while preserving crisp vector output for figures. Concretely:

| Component | Data layer | External engine |
|---|---|---|
| volcano, embedding | WebGL point sprites | `regl-scatterplot`, `d3-scale`, `d3-array` |
| heatmap | WebGL: the matrix is a float texture sampled in a shader | `regl` |
| hic | WebGL plus a level-of-detail pyramid, no tile server | `regl` |
| network | WebGL graph rendering | `sigma` v3, `graphology`, `graphology-layout-forceatlas2` |
| gosling | WebGL via PIXI | `gosling.js` |
| igv | streams and tiles internally | `igv.js` |
| clustermap | canvas 2-D `ImageData`, one pixel per cell, then scaled | `ml-hclust` for the linkage only |
| treemap | canvas 2-D | `d3-hierarchy` for the squarified layout |
| oncoplot, lollipop, km, profile, upset, violin, dotplot, spatial | canvas 2-D | none |

Two things in that table surprise people.

**Not every large figure needs WebGL.** The last row is the omics gallery. These
figures are bounded in one dimension (a gene panel, a set count, 96 contexts, a
protein length) and only grow in the other, so a plain 2-D canvas is the right
tool: it draws a 60 by 1,200 oncoplot, 72,000 cells, without ever creating a GPU
context. What matters is that nothing is per-datum DOM, not that it is
specifically a shader.

**`clustermap` is canvas, not WebGL.** It writes one pixel per cell into an
`ImageData` at the matrix's native size and lets the browser scale that up, which
is a cheap way to get a correct large heatmap without a shader. `heatmap` does use
`regl` and a float texture. The two look alike and are built differently, so do
not assume one from the other.

The per-spot cost in the last row is real, though, and it bounds `spatial`: one
canvas arc per spot suits Visium-scale slides of a few thousand spots. It is not
the path for Xenium-scale single cells. Those go through `embedding`, which is
`regl-scatterplot`, at the cost of losing the image underlay.
