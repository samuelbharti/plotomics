# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

One name on every registry: `plotomics` on npm, on PyPI and on r-universe. The
three packages share a version and are released together from a single tag.

## [Unreleased]

## [0.1.0] - 2026-08-09

First public release. Seventeen visualization components, each shipping from one
source bundle to JavaScript, R and Python.

### Added

- **Shared core (`plotomics/core`).** A single TypeScript core defining the
  component contract, theming, colour scales, binary column transport and export
  helpers, consumed by every visualization so behaviour stays consistent across
  languages. Includes the `viridis` and `rdbu` ramps plus the `ltc` sequential
  and `ltcdiv` diverging ramps. Ships as a subpath of the one npm package rather
  than a second package, so there is no version skew between core and components.
- **Tri-language wrapper architecture.** Each component ships from one source
  bundle to three targets: an npm package (`plotomics`), a Python
  [anywidget](https://anywidget.dev) widget (`plotomics` on PyPI, for Jupyter,
  JupyterLab, marimo, Colab, VS Code, Shiny for Python and Streamlit) and an R
  [htmlwidget](https://www.htmlwidgets.org) (`plotomics`, for the RStudio Viewer,
  R Markdown, Quarto and Shiny). Glob-discovered build entries let new components
  land without editing any central registry.
- **Binary column transport.** Numeric data reaches the browser as a binary
  buffer rather than JSON, which is what keeps hundreds of thousands of points
  interactive.

#### Expression and abundance

- **Volcano plot.** GPU-accelerated differential-expression scatter with
  significance thresholds.
- **Expression heatmap.** Large-scale WebGL expression matrix viewer.
- **Clustered heatmap (clustermap).** Heatmap with row and column dendrograms and
  hierarchical clustering.
- **Marker gene dot plot.** Features by groups, with dot area proportional to the
  fraction of the group expressing and colour carrying the level.
- **Stacked violin.** One row per feature, one violin per group, so a marker
  panel reads down the page. `violin_density()` computes the densities in R.

#### Single-cell and spatial

- **Embedding (UMAP/t-SNE) viewer.** GPU-accelerated scatter for single-cell and
  dimensionality-reduction embeddings. `aspect = "equal"` gives both axes the
  same units per pixel, for PCA scores and anything else whose axes share units;
  `point_scale_mode` chooses how points shrink as you zoom out; `padding` keeps
  the outermost points off the canvas border. A factor `color` column in R, or a
  pandas `Categorical` in Python, pins the legend order and colour assignment and
  keeps unused levels, the way `drop = FALSE` does in ggplot2.
- **Spatial tissue map.** Measurements at their real slide coordinates over the
  histology image, with the image and the spots sharing a single fit so they
  cannot drift apart on resize or on a high-DPI display.

#### Cohort and variant genomics

- **Oncoplot (OncoPrint).** The cohort alteration landscape: a gene by sample
  grid of categorical alteration classes, with a per-sample mutation-burden
  barplot, a per-gene frequency barplot and optional clinical annotation strips.
  `oncoplot_memo_sort()` produces the conventional column order.
- **Protein domain lollipop.** Variants along a protein over its domain
  architecture, with head area proportional to recurrence and an optional
  post-translational modification track.
- **Kaplan-Meier curve.** A right-continuous step function per stratum with
  censoring ticks, confidence bands and a number-at-risk table aligned to the
  same time grid. Accepts a `survival::survfit` object directly in R.
- **Categorical profile.** A grouped bar profile with coloured header blocks,
  built for the 96-context mutational signature layout and general enough for any
  ordered categorical profile that groups into runs.

#### Sets, hierarchies and networks

- **UpSet plot.** Set intersections as a bar chart over a membership matrix, for
  the many-set case where a Venn diagram is not drawable.
  `upset_intersections()` computes exclusive intersections, so the columns sum to
  the union rather than double-counting.
- **Gene treemap.** Hierarchical gene and category treemap.
- **Network graph.** Large-graph viewer built on
  [Sigma](https://www.sigmajs.org) v3 and
  [graphology](https://graphology.github.io), with directed edges, per-edge
  colour and drop reporting. In Shiny, clicking a node pushes its id to
  `input$<outputId>_selected`.

#### Genome and chromatin

- **Hi-C contact matrix.** WebGL contact-map viewer with level-of-detail tiling,
  for chromatin interaction data.
- **igv.js genome viewer.** Embedded [igv.js](https://igv.org) genome browser.
- **Gosling genome viewer.** Declarative genomics visualization via
  [Gosling.js](https://gosling-lang.org).

### Documentation

- [docs/motivation.md](docs/motivation.md) covers why the project exists, its
  non-goals, how it compares with ComplexHeatmap, maftools, survminer, UpSetR,
  Seurat and scanpy, and when to reach for one of those instead.
- [docs/architecture.md](docs/architecture.md) describes the component contract
  and the transport layer.
- Reference sites are generated per language: pkgdown for R, pdoc for Python.

[Unreleased]: https://github.com/samuelbharti/plotomics/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/samuelbharti/plotomics/releases/tag/v0.1.0
