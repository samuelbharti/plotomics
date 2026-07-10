# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions are shared across the JavaScript packages (`@bioviz/core`,
`@bioviz/components`), the Python package (`bioviz`, PyPI) and the R package
(`bioviz`, r-universe), which are released together from a single tag.

## [Unreleased]

## [0.1.0] - 2026-07-09

First public release.

### Added

- **Shared core (`@bioviz/core`).** A single TypeScript core defining the
  component contract, theming, color scales, binary column transport and export
  helpers, consumed by every visualization so behavior stays consistent across
  languages.
- **Tri-language wrapper architecture.** Each component ships from one source
  bundle to three targets: an npm package (`@bioviz/components`), a Python
  [anywidget](https://anywidget.dev) widget (`bioviz` on PyPI, for Jupyter,
  JupyterLab, marimo, Colab, VS Code, Shiny for Python and Streamlit) and an R
  [htmlwidget](https://www.htmlwidgets.org) (`bioviz`, for the RStudio Viewer,
  R Markdown, Quarto and Shiny). Glob-discovered build entries let new
  components land without editing any central registry.
- **Volcano plot** — GPU-accelerated differential-expression scatter with
  significance thresholds.
- **Expression heatmap** — large-scale WebGL expression matrix viewer.
- **Gene treemap** — hierarchical gene/category treemap.
- **Clustered heatmap (clustermap)** — heatmap with row/column dendrograms and
  hierarchical clustering.
- **Hi-C contact matrix** — WebGL contact-map viewer for chromatin interaction
  data.
- **igv.js genome viewer** — embedded [igv.js](https://igv.org) genome browser.
- **Gosling genome viewer** — declarative genomics visualization via
  [Gosling.js](https://gosling-lang.org).
- **Network graph** — large-graph viewer built on
  [Sigma](https://www.sigmajs.org) v3 and [graphology](https://graphology.github.io).
- **Embedding (UMAP/t-SNE) viewer** — GPU-accelerated scatter for
  single-cell/dimensionality-reduction embeddings.

[Unreleased]: https://github.com/samuelbharti/visualization-components/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/samuelbharti/visualization-components/releases/tag/v0.1.0
