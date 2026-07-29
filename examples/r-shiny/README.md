# plotomics in classic R Shiny

A gallery Shiny app using the plotomics **htmlwidgets** on the classic Shiny path
(`<name>Output()` / `render<Name>()` bindings), one tab per component, each
driven by reactive controls on the server.

| Tab | Bindings | Reactive controls |
|---|---|---|
| Volcano | `volcanoOutput` / `renderVolcano` | fold-change & p thresholds, top-N labels |
| Embedding | `embeddingOutput` / `renderEmbedding` | categorical vs continuous color, point size, legend |
| Heatmap | `bioheatmapOutput` / `renderBioheatmap` | colormap, row z-score |
| Network | `networkOutput` / `renderNetwork` | layout iterations, label threshold |
| Treemap | `treemapOutput` / `renderTreemap` | tiling, color-by |

## Run

The widget JS must be built and synced into the R package first (those bundles
are git-tracked and regenerated on demand). From the repo root:

```bash
# build @plotomics/components and copy bundles into pkg-r (and pkg-py)
pnpm --filter @plotomics/components build && node scripts/sync-assets.mjs
# (equivalently `pnpm dist` where pnpm is on PATH)

Rscript -e "shiny::runApp('examples/r-shiny', port = 8001)"
```

Then open <http://localhost:8001>.

`app.R` uses `library(plotomics)` if the package is installed, otherwise
`pkgload::load_all("pkg-r")` from this repo, so no install step is needed for
local development.

## How it works

Each dataset is generated once at startup; the controls only change widget
**options**, so every `render*` rebuilds its widget from fixed data (server to
client reactivity). The same pattern extends to the twelve components this app
does not show (`clustermap`, `dotplot`, `violin`, `spatial`, `oncoplot`,
`lollipop`, `km`, `profile`, `upset`, `hic`, `igv`, `gosling`): add a tab and
call the matching `*Output` / `render*` pair. Every widget also renders outside
Shiny, in the RStudio Viewer, R Markdown or Quarto, by calling the constructor
directly, e.g. `volcano(df)`.
