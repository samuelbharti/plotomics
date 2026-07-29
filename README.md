# plotomics

**Lightweight, GPU-accelerated bioinformatics visualization components with R and Python wrappers.**

One high-performance TypeScript core, wrapped for R (via
[htmlwidgets](https://www.htmlwidgets.org/)) and Python (via
[anywidget](https://anywidget.dev/)). Built for **large datasets**: the
rendering layer is WebGL/canvas throughout (regl, canvas, sigma, igv.js,
Gosling.js), and numeric data reaches the browser as a binary buffer rather than
JSON, so hundreds of thousands to millions of features stay interactive.
Components are designed to be **publication-ready**, not toy demos.

## Why plotomics

Omics data outgrew the plotting stack. A 500k-cell embedding or a 20k-gene
volcano is routine now, but the tools most of these figures are drawn with were
designed for a few thousand marks. Past that they get slow, and the figure stops
being readable before the data stops being interesting.

There is a second problem that has nothing to do with size. Labs run on both R
and Python, so the same figure gets implemented twice and the two drift. The
heatmap in the paper and the heatmap in the notebook disagree, and nobody can
say which one is right.

plotomics writes each component once, in TypeScript, and wraps it thinly for
both languages. You get GPU or canvas rendering with binary data transport, real
SVG and PNG export rather than a screenshot, and the same object in a Jupyter
notebook, a Shiny app, the RStudio Viewer, Quarto, or a plain web page.

It is deliberately not a general plotting library, and for a small static figure
there are better tools. [docs/motivation.md](docs/motivation.md) sets out the
goals, the non-goals, how plotomics compares with ComplexHeatmap, maftools,
survminer, Seurat, scanpy and others, and when you should use one of those
instead.

## Components

Seventeen components, each available in all three languages. The R constructor
is snake_case (`oncoplot()`), the Python class is PascalCase (`Oncoplot`), and
the JS factory is `createOncoplot`.

| Component | Status | Engine | Purpose |
|---|---|---|---|
| Volcano plot | ✅ reference | regl-scatterplot | Differential expression (effect vs. significance) |
| Expression heatmap | ✅ | WebGL | Large sample × gene matrices |
| Clustered heatmap | ✅ | WebGL + dendrograms | Hierarchically-clustered expression |
| Marker gene dot plot | ✅ | canvas + SVG | Features × groups; dot size is fraction expressing, colour is level |
| Stacked violin | ✅ | canvas + SVG | One row per feature, one violin per group, for marker panels |
| Embedding (UMAP/t-SNE) | ✅ | regl-scatterplot | 2-D single-cell / dimensionality-reduction maps |
| Spatial tissue map | ✅ | canvas + SVG | Measurements on tissue, over the histology image |
| Oncoplot (OncoPrint) | ✅ | canvas + SVG | Cohort alteration landscape: gene × sample alteration classes |
| Protein domain lollipop | ✅ | canvas + SVG | Variants along a protein, over its domain architecture |
| Kaplan-Meier curve | ✅ | canvas + SVG | Survival curves with a number-at-risk table |
| Categorical profile | ✅ | canvas + SVG | Grouped bar profile, built for 96-context mutational signatures |
| UpSet plot | ✅ | canvas + SVG | Set intersections as a bar chart over a membership matrix |
| Gene treemap | ✅ | D3 + canvas | Hierarchical gene-set / pathway composition |
| Network graph | ✅ | sigma v3 | Large biological networks |
| Hi-C contact matrix | ✅ | regl / WebGL LOD | Chromatin contact maps |
| Genome viewer (igv.js) | ✅ | igv.js | Track-based genome browser |
| Genome viewer (Gosling) | ✅ | Gosling.js | Declarative genomics figures |

Three components ship data helpers that run the statistics in R, where you can
see them, rather than inside the renderer: `oncoplot_memo_sort()`,
`upset_intersections()` and `violin_density()`.

## Repository layout

```
packages/
  core/         @plotomics/core        contract, theme, color, binary transport, export
  components/   @plotomics/components  the headless viz factories + adapters + dev harness
pkg-r/          R package (htmlwidgets)
pkg-py/         Python package (anywidget)
docs/           landing page, architecture notes, motivation
examples/       runnable Shiny and shiny-react apps
scripts/        sync built bundles into the wrappers
.github/        CI, docs and release workflows
```

## Quick start (dev)

```bash
pnpm install
pnpm dist        # build all JS + copy bundles into pkg-r/ and pkg-py/

# Visual dev harness (WebGL, synthetic data at scale)
pnpm --filter @plotomics/components dev   # http://localhost:5180
```

### R

Make sure the bundles are synced first, from the shell:

```bash
pnpm dist
```

Then, in R:

```r
devtools::load_all("pkg-r")
df <- data.frame(x = rnorm(1e5), y = abs(rnorm(1e5)) * 3, label = paste0("GENE", 1:1e5))
volcano(df, fc_threshold = 1, p_threshold = 0.05)
```

### Python

```python
import numpy as np, pandas as pd
from plotomics import Volcano

n = 200_000
df = pd.DataFrame({"x": np.random.randn(n), "y": np.abs(np.random.randn(n))*3,
                   "label": [f"GENE{i}" for i in range(n)]})
Volcano(df)
```

Large single-cell embedding (UMAP/t-SNE) colored by cluster, with lasso selection:

```python
import numpy as np, pandas as pd
from plotomics import Embedding

n = 500_000
k = np.random.randint(0, 8, n)                        # cluster per cell
df = pd.DataFrame({"x": np.random.randn(n) + k*4, "y": np.random.randn(n) + k*4,
                   "color": [f"cluster {i}" for i in k]})
Embedding(df, color_mode="categorical")
```

## Examples

Two runnable apps, each with its own README:

- [examples/r-shiny](examples/r-shiny) is a gallery app on the classic Shiny
  path, using the `<name>Output()` / `render<Name>()` bindings.
- [examples/shiny-react-embedding](examples/shiny-react-embedding) drives the
  headless factory directly from a React frontend, with no htmlwidgets and no
  anywidget in between.

## Contributing

New components follow one recipe, described in
[CONTRIBUTING.md](CONTRIBUTING.md). The Volcano plot is the reference
implementation. Architecture details are in
[docs/architecture.md](docs/architecture.md).

## License

MIT
