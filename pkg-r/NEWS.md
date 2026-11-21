# plotomics 0.3.0

## Changes

* `igv()` and `gosling()`, with their Shiny bindings, are not in the R package;
  the r-universe build of 0.2.0 had them. Their bundles put the installed
  package past the 5 MB limit that CRAN sets. The Python and JavaScript packages
  keep both.
* Chart text takes its size from `theme$fontSize`. At the default of 12,
  labels are 11 px, axis and legend titles 13 px and plot titles 14 px; text
  was fixed at 7 to 13 px, mostly 9 px. Layouts measure their labels, end long
  ones with an ellipsis, and thin or shrink dense ones, so text stays inside
  the widget.
* Past 8 categories the default palette changes from Okabe-Ito to scanpy's
  20-colour cluster palette, so the 9th group no longer takes the colour of the
  1st. `km()`, `lollipop()` classes, `oncoplot()`, `bioprofile()` and `violin()`
  now take their colours from `theme$categorical`.
* Each plot has its own default height, the one its `*Output()` function uses:
  `clustermap()`, `dotplot()`, `oncoplot()`, `spatial()` and `violin()` 560 px,
  `km()` and `upset()` 520, `lollipop()` 440, `bioprofile()` 380 and the
  others 480. `clustermap()` and `clustermapOutput()` rise to 560 px, and the
  clustermap colour bar moves to the right of the heatmap.
* `clustermap(linkage = "ward")` is `ward.D2` (Ward's method on squared
  distances); it was `ward.D`, so Ward dendrograms change. It warns when Ward
  is used with the correlation metric.
* `oncoplot()` matches annotation values to samples by name. Unnamed values
  are read in the order of `samples`, and stop with an error when `samples` is
  not given. Genes rank by the number of samples altered, and a gene and
  sample altered in two or more ways show one "Multi-hit" cell, as maftools
  does.
* `theme = list(padding = )` puts room around every plot: one number for all
  four sides, or `top`, `right`, `bottom` and `left`, 10 px by default. Axes,
  labels and legends stay inside it.
* Gridlines sit under the data in every plot. A `theme$grid` of "none" or a
  transparent colour draws no grid.
* Axes and colour bars label round values in one unit per axis (a `hic()` log
  colour bar writes each power of ten in its own unit), and keep fewer labels on
  a short plot so that no two overlap.
* `violin()` caps the widest violin at `violin_aspect` (0.8) times its row
  height, never narrower than four times the label size; `violin_aspect = NULL`
  turns the cap off.
* `bioheatmap()` and `clustermap()` draw z-scores with `rdbu` when `colormap` is
  `NULL`, the new default, and `bioheatmap()` mirrors a lone positive `vmax` or
  negative `vmin` about 0 with a diverging colormap. With more rows or columns
  than pixels both draw the mean of the cells under each pixel, so an outlier
  row no longer vanishes. `bioheatmap()` gains `legend_title`.
* `network()` labels nodes from the starting zoom (`label_threshold = 4`) and
  draws a legend of its node groups, which `show_legend = FALSE` turns off.
* `spatial()` takes its default spot diameter from the spacing of the spots and
  stops on a `spot_diameter` that is not one positive number. Its legend and
  colour bar sit right of the image.
* `embedding()` keeps its legend in a gutter right of the points, and it,
  `treemap()`, `bioheatmap()`, `clustermap()` and `hic()` accept `ltc` and
  `ltcdiv`.
* `lollipop()`: round count ticks with gridlines, a domain palette of its own
  (`theme$categorical` colours the classes only), domain names dark or light by
  their fill and cut with an ellipsis when long, and a tooltip worded by
  `y_label`.
* `bioprofile(as_fraction = TRUE)` stops on negative values, and `as_fraction`
  must be one `TRUE` or `FALSE`. Values that are not finite are left out of the
  total, the tooltip reads "no value" for an `NA`, where hovering it threw, and
  negative bars go down from a zero line.
* `km()` takes `censor`, a data frame of censoring ticks, as its last argument.
* `oncoplot()` and `lollipop()` break ties by name in code point order, whatever
  the locale, so the colours match Python's.
* `km()` draws its legend above the panel, thins time labels and risk counts to
  fit, keeps the risk table ahead of the legend, and labels strata without the
  variable names where it can cut them safely. With `y_from_zero = FALSE` the y
  labels sit on round percentages. A Cox fit with several `newdata` rows draws
  one curve per row, a multi-state fit stops with a clear message, and rows with
  a missing `time` or `surv` are left out with a warning.
* `oncoplot()` annotation levels follow factor order, and named colours are
  matched by level. Rows with a missing gene or sample are left out.
* `volcano(label_top_n = Inf)` asks for a label on every up- and down-regulated
  gene; a label with no room is left out.
* `hic()` checks `vmin`, `vmax`, `vmax_percentile`, `bin_size` and `symmetric`.
* `lollipop()` stops with a clear error when `domains` or `ptms` is not a data
  frame.
* Colour bars and axes label round, exact values, the `hic()` colour bar and
  axes and the `violin()` value axis included; very large or very small ranges
  use one exponent form. The `treemap()` key labels its two ends in one format.
  Tooltips stay inside the widget.
* Any theme colour or colour argument may be a CSS variable. R colour names that
  CSS lacks, such as "grey50" or "steelblue4", are sent as hex, so every R
  colour name works; a name CSS knows, such as "green", keeps its CSS colour. A
  colour the browser cannot read leaves out the marks that take it, text in it
  takes the default colour, and the browser console names it.
* `network()` edges take a default colour from the theme when
  `default_edge_color` is `NULL`, the new default, labels never overlap, and
  group colours and the legend follow factor levels.
* The warning about missing or infinite values reads the same in R and Python
  and names the argument. `oncoplot()` warns about a missing `burden`, and
  `spatial()` about missing values in a numeric `color` column.
* `volcano()`, `embedding()` and `network()` stop zooming out at the view that
  fits all the data, keep a pan inside it, and stop zooming in at 1/10,000 of
  its range; `bounded_view = FALSE` turns the limits off. A "Reset view" button
  on these and on `bioheatmap()` and `hic()` brings back the whole plot, as a
  double-click does.

## Bug fixes

* `NA`, `NaN` and `Inf` reach the browser as `null`, and every plot now shows
  them as missing (a grey cell, an open ring, an "NA" legend key, or no mark)
  where they were drawn as 0, took the low end of a colour scale, or blanked
  the widget.
* One-element vectors reach the browser as arrays, so a one-row data frame or a
  single class no longer breaks `oncoplot()`, `volcano()`, `lollipop()`,
  `bioheatmap()`, `hic()`, `upset()` and `network()`. An argument left out on a
  re-render goes back to its default.
* `hic()` draws its map in every browser; it was blank.
* `volcano()`: a p-value of 0 is drawn at the top of the plot, rows with a
  missing coordinate are left out, and labels no longer overlap.
* `network()`: negative weights no longer stop the layout, and edge widths
  scale to 1.7 to 6 px.
* `treemap()` draws without a value column, sums leaves only, and names its
  groups.
* `km()`: strata whose rows are interleaved, the risk-table order with
  `groups`, the confidence band below the axis, and curves that stop before
  their last censored subject.
* The `oncoplot()` and `lollipop()` legends wrap, and `lollipop()` variants at
  one residue stack on one stem, with labels kept clear of the heads.
* `dotplot()` and `violin()` handle missing values, and each violin row has a
  value axis (`show_value_axis`).
* `bioheatmap()` draws matrices larger than the GPU texture limit and thins
  crowded labels.
* `clustermap()` clusters around missing cells and clusters again only when
  the data or a clustering argument changes.
* `embedding()` and `spatial()`: the colour type, the category order
  ("cluster 2" before "cluster 10") and lasso selections across re-renders.
* The `bioprofile()`, `upset()` and `lollipop()` axes put ticks on round values
  with exact labels, and long `upset()` set names fit their column.
* Every Shiny example in the help runs as written.
* Hover lines up with the plot inside an element with a CSS border, and a widget
  keeps a height set in CSS.
* In Shiny, clicking the empty canvas of a `network()` clears
  `input$<id>_selected`.
* Missing names read "NA" in the `violin()`, `dotplot()`, `upset()`,
  `lollipop()` and `oncoplot()` tooltips.
* A theme background given as a CSS variable paints the plot and its exports;
  `hic()` draws missing bins as background.
* A named palette in `theme$categorical` reaches the plot, and `treemap()`
  checks large trees quickly.
* A `dotplot()` with hundreds of genes draws its dots, and `network()` hover
  stays readable with a `theme$grid` of "none" and on a dark background.
* `hic()` axis labels keep their units at narrow widths.
* The `bioprofile()` tooltip prints small fractions to six significant digits,
  and the `upset()` total moves to its own line when it would run into the top
  tick label.
* `km()` leaves out censor marks with a missing or infinite `time` or `surv`,
  with a warning.
* `hic()` with sparse input stops with a clear message when `i` or `j` is
  missing.
* `volcano()` draws p = 0 genes above the threshold line and keeps the line and
  large points in view, and the `volcano()` and `embedding()` tooltips hide when
  the view moves.
* `violin()` draws with a missing `grid` value, where it stopped with an error.
* `lollipop()` labels stay clear of domains at small sizes, a one-sample
  `oncoplot()` reads "1 sample", `treemap()` tooltips print values in full, and
  a missing `network()` edge colour takes the default colour.

# plotomics 0.1.0

First release.

Fifteen GPU- and canvas-accelerated visualization widgets, built on a shared
JavaScript core and exposed to R through `htmlwidgets`. Every widget renders in
the RStudio Viewer, R Markdown, Quarto and Shiny, and every one ships a matching
`*Output()` / `render*()` pair for classic Shiny apps.

## Expression and abundance

* `volcano()` -- differential expression, effect size against significance.
* `bioheatmap()` (alias `heatmap_plotomics()`) -- large sample-by-gene matrices.
  Named to avoid masking `stats::heatmap()`.
* `clustermap()` -- expression matrix with row and column dendrograms.
* `dotplot()` -- marker genes by group, dot area for the fraction expressing and
  colour for the level.
* `violin()` -- one row per feature, one violin per group. `violin_density()`
  computes the densities in R.

## Single-cell and spatial

* `embedding()` -- UMAP, t-SNE and PCA scatter at several hundred thousand
  points. A factor `color` column pins the legend order and keeps unused levels,
  the way `drop = FALSE` does in ggplot2.
* `spatial()` -- measurements at their slide coordinates over the histology
  image, with image and spots sharing one fit so they cannot drift apart on
  resize.

## Cohort and variant genomics

* `oncoplot()` -- the cohort alteration landscape, with mutation-burden and
  per-gene frequency barplots and clinical annotation strips.
  `oncoplot_memo_sort()` produces the conventional column order.
* `lollipop()` -- variants along a protein over its domain architecture.
* `km()` -- Kaplan-Meier curves with censoring ticks, confidence bands and a
  number-at-risk table. Accepts a `survival::survfit` object directly.
* `bioprofile()` -- grouped categorical profile, built for the 96-context
  mutational signature layout.

## Sets, hierarchies and networks

* `upset()` -- set intersections for the many-set case.
  `upset_intersections()` computes exclusive intersections, so columns sum to the
  union rather than double-counting.
* `treemap()` -- hierarchical gene-set and pathway composition.
* `network()` -- large biological networks, with directed edges, per-edge colour
  and node-click selection that pushes the clicked id to
  `input$<outputId>_selected` in Shiny.

## Genome and chromatin

* `hic()` -- Hi-C contact matrices with level-of-detail tiling.
