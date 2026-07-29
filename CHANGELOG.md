# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions are shared across the JavaScript packages (`@plotomics/core`,
`@plotomics/components`), the Python package (`plotomics`, PyPI) and the R package
(`plotomics`, r-universe), which are released together from a single tag.

## [Unreleased]

### Added

Eight new components, bringing the library to seventeen. All eight draw their
data layer on a canvas with a vector overlay for labels, axes and legends, and
all eight ship in R, Python and JavaScript.

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
  built for the 96-context mutational signature layout and general enough for
  any ordered categorical profile that groups into runs.
- **UpSet plot.** Set intersections as a bar chart over a membership matrix, for
  the many-set case where a Venn diagram is not drawable.
  `upset_intersections()` computes exclusive intersections, so the columns sum
  to the union rather than double-counting.
- **Marker gene dot plot.** Features by groups, with dot area proportional to
  the fraction of the group expressing and colour carrying the level.
- **Stacked violin.** One row per feature, one violin per group, so a marker
  panel reads down the page. `violin_density()` computes the densities in R.
- **Spatial tissue map.** Measurements at their real slide coordinates over the
  histology image, with the image and the spots sharing a single fit so they
  cannot drift apart on resize or on a high-DPI display.

Component and core options:

- **Embedding `aspect`.** `"equal"` gives both axes the same units per pixel,
  for PCA scores and anything else whose axes share units. `"fill"` remains the
  default and suits a UMAP.
- **Embedding `point_scale_mode`.** `"asinh"` (default) and `"linear"` shrink
  points as you zoom out; `"constant"` sizes them in literal pixels.
- **Embedding `padding`.** Fraction of the data range to pad around the fitted
  view, so the outermost points are not clipped by the canvas border.
- **Pinned categorical order in the embedding.** A factor `color` column in R,
  or a pandas `Categorical` in Python, fixes the legend order and the colour
  assignment and keeps unused levels, the way `drop = FALSE` does in ggplot2.
- **LTC colour ramps in `@plotomics/core`.** An `ltc` sequential ramp and an
  `ltcdiv` diverging ramp, selectable on the dot plot and the spatial map.
- **Node-click selection on the network.** In Shiny, clicking a node pushes its
  id to `input$<outputId>_selected`.
- **Wrapper option parity.** Twelve options that existed only in the TypeScript
  layer are now reachable from R and Python: `padding` on the embedding;
  `min_head_radius`, `max_head_radius`, `y_label`, `backbone_color` and
  `stem_color` on the lollipop; and `burden_color`, `frequency_color`,
  `x_label`, `burden_label`, `cell_gap_x` and `cell_gap_y` on the oncoplot.

### Fixed

- **Oncoplot column packing.** Columns of differing lengths are now packed
  correctly rather than producing a misaligned grid.
- **Embedding initial framing.** The view is framed on first render instead of
  waiting for a resize event.
- **Stale R documentation.** `man/embedding.Rd` was missing `point_scale_mode`
  and `aspect`, which made `R CMD check --as-cran` report a codoc mismatch.
- **Broken R documentation site.** `pkg-r/_pkgdown.yml` indexed 10 of 25
  exported topics, and pkgdown treats a documented-but-unindexed topic as an
  error, so the R reference site could not build at all.
- **`survival` undeclared.** It is used by the Kaplan-Meier tests and is now in
  `Suggests`, which clears an `R CMD check` warning.

### Changed

- **Documentation.** Added [docs/motivation.md](docs/motivation.md), covering
  why the project exists, its non-goals, how it compares with ComplexHeatmap,
  maftools, survminer, UpSetR, Seurat, scanpy and others, and when to use one of
  those instead. The component tables, architecture notes and package
  descriptions now cover all seventeen components, and `CONTRIBUTING.md` gained
  an explicit docs step so they stay that way.
- **Package directories renamed** from `r/` and `python/` to `pkg-r/` and
  `pkg-py/`. No release has been tagged yet, so no published artifact ever used
  the old paths; this only affects tooling that reads the repository directly.

## [0.1.0] - 2026-07-09

First public release.

### Added

- **Shared core (`@plotomics/core`).** A single TypeScript core defining the
  component contract, theming, color scales, binary column transport and export
  helpers, consumed by every visualization so behavior stays consistent across
  languages.
- **Tri-language wrapper architecture.** Each component ships from one source
  bundle to three targets: an npm package (`@plotomics/components`), a Python
  [anywidget](https://anywidget.dev) widget (`plotomics` on PyPI, for Jupyter,
  JupyterLab, marimo, Colab, VS Code, Shiny for Python and Streamlit) and an R
  [htmlwidget](https://www.htmlwidgets.org) (`plotomics`, for the RStudio Viewer,
  R Markdown, Quarto and Shiny). Glob-discovered build entries let new
  components land without editing any central registry.
- **Volcano plot.** GPU-accelerated differential-expression scatter with
  significance thresholds.
- **Expression heatmap.** Large-scale WebGL expression matrix viewer.
- **Gene treemap.** Hierarchical gene/category treemap.
- **Clustered heatmap (clustermap).** Heatmap with row/column dendrograms and
  hierarchical clustering.
- **Hi-C contact matrix.** WebGL contact-map viewer for chromatin interaction
  data.
- **igv.js genome viewer.** Embedded [igv.js](https://igv.org) genome browser.
- **Gosling genome viewer.** Declarative genomics visualization via
  [Gosling.js](https://gosling-lang.org).
- **Network graph.** Large-graph viewer built on
  [Sigma](https://www.sigmajs.org) v3 and [graphology](https://graphology.github.io).
- **Embedding (UMAP/t-SNE) viewer.** GPU-accelerated scatter for
  single-cell/dimensionality-reduction embeddings.

[Unreleased]: https://github.com/samuelbharti/plotomics/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/samuelbharti/plotomics/releases/tag/v0.1.0
