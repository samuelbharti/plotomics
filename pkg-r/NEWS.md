# plotomics 0.2.0

## Breaking changes

* `profile()` is renamed `bioprofile()`, with `profile_plotomics()` as an alias.
  Attaching the package used to mask the `stats::profile()` generic; it now
  masks nothing in base or the recommended packages. `bioheatmap()` already
  worked this way for `stats::heatmap()`.
* The Shiny bindings follow: `profileOutput()` and `renderProfile()` are now
  `bioprofileOutput()` and `renderBioprofile()`.

# plotomics 0.1.0

First release.

Seventeen GPU- and canvas-accelerated visualization widgets, built on a shared
JavaScript core and exposed to R through `htmlwidgets`. Every widget renders in
the RStudio Viewer, R Markdown, Quarto and Shiny, and every one ships a matching
`*Output()` / `render*()` pair for classic Shiny apps.

## Expression and abundance

* `volcano()` — differential expression, effect size against significance.
* `bioheatmap()` (alias `heatmap_plotomics()`) — large sample-by-gene matrices.
  Named to avoid masking `stats::heatmap()`.
* `clustermap()` — expression matrix with row and column dendrograms.
* `dotplot()` — marker genes by group, dot area for the fraction expressing and
  colour for the level.
* `violin()` — one row per feature, one violin per group. `violin_density()`
  computes the densities in R.

## Single-cell and spatial

* `embedding()` — UMAP, t-SNE and PCA scatter at several hundred thousand points.
  A factor `color` column pins the legend order and keeps unused levels, the way
  `drop = FALSE` does in ggplot2.
* `spatial()` — measurements at their slide coordinates over the histology image,
  with image and spots sharing one fit so they cannot drift apart on resize.

## Cohort and variant genomics

* `oncoplot()` — the cohort alteration landscape, with mutation-burden and
  per-gene frequency barplots and clinical annotation strips.
  `oncoplot_memo_sort()` produces the conventional column order.
* `lollipop()` — variants along a protein over its domain architecture.
* `km()` — Kaplan-Meier curves with censoring ticks, confidence bands and a
  number-at-risk table. Accepts a `survival::survfit` object directly.
* `bioprofile()` — grouped categorical profile, built for the 96-context mutational
  signature layout.

## Sets, hierarchies and networks

* `upset()` — set intersections for the many-set case.
  `upset_intersections()` computes exclusive intersections, so columns sum to the
  union rather than double-counting.
* `treemap()` — hierarchical gene-set and pathway composition.
* `network()` — large biological networks, with directed edges, per-edge colour
  and node-click selection that pushes the clicked id to
  `input$<outputId>_selected` in Shiny.

## Genome and chromatin

* `hic()` — Hi-C contact matrices with level-of-detail tiling.
* `igv()` — track-based genome browser via igv.js.
* `gosling()` — declarative genomics figures via Gosling.js.
