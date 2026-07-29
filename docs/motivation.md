# Why plotomics exists

## The problem

Omics data outgrew the plotting stack it is usually drawn with.

A single-cell atlas with 500,000 cells is ordinary now. So is a differential
expression table with 20,000 genes, a cohort of 1,000 tumours, or a contact
matrix with millions of bins. The plotting tools most of these figures are made
with were designed for a few thousand marks, and they were excellent at that.
Past it, two things break at once. Rendering gets slow, because the cost is per
datum and the substrate is a display list or a DOM node. And the figure itself
stops being readable well before the data stops being interesting: 500,000
opaque points at a fixed radius is a silhouette, not a plot.

The web stack does not automatically fix this. A charting library that emits one
SVG element per datum hits browser limits in the low tens of thousands. Sending
a million floats as JSON is roughly 20 MB of text to parse before anything is
drawn. Getting past those two facts is an architectural choice, not a tuning
exercise, which is why it has to be built in rather than added later.

## The second problem, which has nothing to do with size

Bioinformatics labs run on both R and Python. The analysis is in `scanpy`, the
statistics are in a Bioconductor package, the dashboard is Shiny, and the
figures for the paper come from whichever one the person making them knows best.

So the same figure gets implemented twice. Then the two drift. The heatmap in
the notebook clusters with a different linkage than the heatmap in the paper, or
scales rows where the other does not, and nobody can say which is right without
reading both implementations. The divergence is invisible, because both look
plausible.

Writing a component once and wrapping it for both languages makes that class of
disagreement impossible rather than merely unlikely.

## Goals

1. **One implementation, two languages.** Every component is written once, in
   TypeScript, against a small contract. R and Python are thin wrappers that
   pack a data frame plus options into a payload. They are not
   reimplementations, so they cannot drift.
2. **Large data by construction.** GPU or canvas rendering for the data layer,
   never per-datum DOM. Numeric columns reach the browser as a binary buffer and
   are read as typed arrays. A million floats is 4 MB as a `Float32Array` buffer
   against roughly 20 MB as JSON text, and it arrives ready to use.
3. **Publication-ready, not a screenshot.** Axes, guides, labels and legends are
   a vector overlay, and components implement `exportSVG` and `exportPNG`. The
   figure you explore is the figure you submit.
4. **Runs where you already are.** The same object renders in Jupyter,
   JupyterLab, marimo, Colab, VS Code, Shiny for Python, Streamlit, the RStudio
   Viewer, R Markdown, Quarto, classic Shiny, and a plain web page.
5. **Parallel-friendly to build.** Adding a component touches almost only new
   files, so component work does not serialise behind a shared registry.

## Non-goals

These are choices, not gaps, and they are the fastest way to tell whether
plotomics fits.

**It does not do statistics.** The components draw; they do not estimate. The
violin takes density values on a grid, not raw expression. The Kaplan-Meier
component takes survival probabilities, confidence bands, censoring times,
at-risk counts and the log-rank p, all precomputed. The oncoplot renders rows
and columns in exactly the order given.

This is deliberate. Kernel bandwidth changes what a violin claims, and a
survival fit has options that change the curve. Those decisions belong with the
analysis, in the language where the data lives, where they are visible and
reviewable. Burying them in a renderer means two renderings of the same data can
legitimately disagree. Where the precomputation is fiddly, R helpers do it in
the open: `violin_density()`, `upset_intersections()` and
`oncoplot_memo_sort()`.

**It is not a grammar of graphics.** There are seventeen opinionated components,
not composable primitives. You cannot build an arbitrary chart out of them. If
your figure is not on the list, plotomics has nothing to offer and `ggplot2` or
`plotly` does.

**It is not a data browser.** There is no session state, no annotation
workflow, no multi-modal linked-view application. It is a set of widgets you
embed in something you built.

**It does not replace genome browsers.** The igv.js and Gosling components are
thin wrappers around those projects, which already stream and tile properly.

## How it compares

Honest version: for most single figures at ordinary size, the established
domain package is the better tool. It is more mature, more customisable, better
documented, and its defaults encode more accumulated taste.

| Figure | Established tools | Where plotomics differs |
|---|---|---|
| Heatmap, clustered heatmap | `ComplexHeatmap`, `pheatmap`, `seaborn.clustermap` | Those are far more configurable. plotomics matters when the matrix is too large to be a static figure and you want to zoom it. |
| Volcano | `EnhancedVolcano`, plain `ggplot2` | Comparable output at gene-panel size; plotomics stays interactive at 20k+ points and exports vector overlays. |
| Oncoprint | `maftools`, `comut` | `maftools` also does the upstream MAF handling and analysis. plotomics only draws, but draws cohort-scale grids on one canvas. |
| Survival curves | `survival` + `survminer`, `lifelines` | Those fit the model. plotomics draws the curve you fitted, and gives the same curve in R and Python. |
| Set intersections | `UpSetR`, `UpSetPlot` | Similar figure. plotomics computes exclusive intersections in R via `upset_intersections()` so the columns sum to the union. |
| Violin, dot plot | `Seurat`, `scanpy` plotting | Those are integrated with their own object models, which is a real advantage. plotomics takes plain data frames and works from either language. |
| Embeddings | `Seurat`/`scanpy`, `cellxgene`, `Vitessce` | `cellxgene` and `Vitessce` are full browsers with far more functionality. plotomics is an embeddable widget. |
| Generic interactive charts | `plotly`, `bokeh`, `altair`/Vega | Vastly more general. All have a practical point budget that plotomics is built to exceed. |
| Genome tracks | `igv.js`, `Gosling` | Not a comparison; plotomics wraps them. |
| Hi-C | `HiGlass`, `cooltools` | `HiGlass` is the serious tiled-server solution. plotomics builds a level-of-detail pyramid in the browser and needs no tile server, which is simpler but bounded by memory. |

The claims above are architectural, not benchmarked. No formal performance
comparison against these packages has been run, and this document does not
assert specific frame rates.

## When to use something else

- **A static figure at ordinary size for a manuscript.** A 200-gene heatmap or a
  3-group survival plot. Use `ComplexHeatmap` or `survminer`. They are better at
  it and print better.
- **You need the statistics, not just the picture.** Use `survival`,
  `lifelines`, `scanpy`, `maftools`. You can still hand the result to plotomics
  afterwards.
- **You need a figure that is not one of the seventeen.** Use a general plotting
  library.
- **You want maximal control over every visual detail.** The components expose a
  fixed option set, not arbitrary layering.
- **You work only in one language and only in static output.** The main
  architectural benefit does not apply to you.

## Where it does earn its place

- **A single-cell atlas at 100k to 1M cells** that you actually want to pan,
  zoom and lasso, colouring by cluster one moment and by a gene the next, with
  the selection coming back to the server.
- **A cohort genomics dashboard** where an oncoplot, a lollipop and a
  Kaplan-Meier curve sit in one Shiny app over the same cohort, and clicking
  through has to stay responsive.
- **Bulk differential expression** over 20,000+ genes where you want to hover a
  gene rather than regenerate the plot with more labels.
- **Spatial transcriptomics** where the spots must sit on the H&E image in real
  coordinates, at the same fit, on every screen size.
- **One dashboard, two languages.** An R team and a Python team shipping the
  same figures, from one implementation, with the wrappers guaranteeing a match.

## Further reading

- [architecture.md](architecture.md) for the contract, the transport, the build
  and sync pipeline, and the per-component rendering strategy.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) for the recipe for adding a
  component, including the performance rules that follow from goal 2.
