# bioviz in classic R Shiny

A gallery Shiny app using the bioviz **htmlwidgets** — the classic Shiny path
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
are git-ignored and regenerated on demand). From the repo root:

```bash
# build @bioviz/components and copy bundles into r/bioviz (and python)
pnpm --filter @bioviz/components build && node scripts/sync-assets.mjs
# (equivalently `pnpm dist` where pnpm is on PATH)

Rscript -e "shiny::runApp('examples/r-shiny', port = 8001)"
```

Then open <http://localhost:8001>.

`app.R` uses `library(bioviz)` if the package is installed, otherwise
`pkgload::load_all("r/bioviz")` from this repo — so no install step is needed for
local development.

## How it works

Each dataset is generated once at startup; the controls only change widget
**options**, so every `render*` rebuilds its widget from fixed data (server →
client reactivity). The same pattern extends to the remaining components
(`clustermap`, `hic`, `igv`, `gosling`): add a tab and call the matching
`*Output` / `render*` pair. Every widget also renders outside Shiny — in the
RStudio Viewer, R Markdown or Quarto — by calling the constructor directly, e.g.
`volcano(df)`.
