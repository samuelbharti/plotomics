#' Clustered heatmap with dendrograms
#'
#' A hierarchically-clustered expression heatmap (in the spirit of
#' `seaborn.clustermap` / Morpheus): the matrix is drawn on a GPU/canvas data
#' layer so large matrices stay smooth, while dendrograms, tick labels and the
#' colorbar are crisp vector overlays. Rows and columns are agglomeratively
#' clustered and reordered so structure appears as blocks along the diagonal.
#' A matrix with more rows or columns than the plot has pixels is pooled for
#' drawing: each pixel shows the mean of the cells under it, so a lone
#' outlier row still shows, fainter the more rows share its pixel.
#'
#' Clustering is at least `O(n^2)` in the number of rows/columns (it builds a
#' full distance matrix), so `clustermap()` only clusters automatically when a
#' dimension has at most 2000 leaves. For larger matrices, precompute a leaf
#' order (or a dendrogram) elsewhere and pass it via `row_linkage` /
#' `col_linkage` to skip clustering; the heatmap rendering itself scales to
#' much larger matrices.
#'
#' @param mat A numeric matrix. Row and column names, if present, are used as
#'   labels. Values are transported row-major to the browser. A missing cell
#'   (`NA`, `NaN` or an infinite value) is drawn grey, and distances between
#'   rows or columns use the cells both have, scaled up as [stats::dist()]
#'   does. Where several rows or columns share a pixel, the pixel shows the
#'   mean of their finite cells, so it is grey only when all of them are
#'   missing.
#' @param metric Distance metric for clustering: `"euclidean"` or
#'   `"correlation"` (1 - Pearson correlation).
#' @param linkage Agglomeration method: `"average"`, `"complete"` or `"ward"`.
#'   `"ward"` is Ward's method as `hclust(method = "ward.D2")` and scipy
#'   compute it, and it assumes the euclidean metric (a warning says so for
#'   correlation).
#' @param colormap Color ramp: sequential `"viridis"` or `"ltc"` (an earthy
#'   teal to sand to rust ramp), or diverging `"rdbu"` or `"ltcdiv"` (its
#'   counterpart, neutral cream at the midpoint), whose range is symmetric
#'   about zero. `NULL` (the default) uses `"rdbu"` when `z_score` is `TRUE`,
#'   so values above and below the row mean get opposite colours, and
#'   `"viridis"` otherwise.
#' @param z_score Standardize each row to mean 0 / sd 1 before coloring.
#' @param cluster_rows,cluster_cols Cluster and reorder rows / columns. Ignored
#'   for an axis when a precomputed `row_linkage` / `col_linkage` is supplied.
#' @param show_row_dendrogram,show_col_dendrogram Draw the row / column
#'   dendrogram.
#' @param show_labels Draw row/column tick labels (auto-hidden when cells get
#'   too small to be legible).
#' @param legend_title Colorbar legend title.
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#'   Its `padding` entry is the space in px between the edge of the widget
#'   and the plot: one number for every side, or numbers named `top`,
#'   `right`, `bottom` and `left` in a list or vector, a side left out
#'   keeping the default of 10.
#' @param row_linkage,col_linkage Optional precomputed leaf order or dendrogram
#'   to skip clustering that axis. Either an integer vector giving the 0-based
#'   leaf order, or a list with `order` (0-based) and `merges` (each a list with
#'   `left`, `right`, `height`; leaves are `0..n-1`, internal node `k` is
#'   `n + k`).
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' # Two clear blocks of correlated genes across two groups of samples.
#' mat <- rbind(
#'   matrix(rnorm(20 * 10, mean = 2), nrow = 20),
#'   matrix(rnorm(20 * 10, mean = -2), nrow = 20)
#' )
#' rownames(mat) <- paste0("gene", seq_len(nrow(mat)))
#' colnames(mat) <- paste0("s", seq_len(ncol(mat)))
#' clustermap(mat, colormap = "rdbu", z_score = TRUE)
#' @export
clustermap <- function(mat,
                       metric = c("euclidean", "correlation"),
                       linkage = c("average", "complete", "ward"),
                       colormap = NULL,
                       z_score = FALSE,
                       cluster_rows = TRUE,
                       cluster_cols = TRUE,
                       show_row_dendrogram = TRUE,
                       show_col_dendrogram = TRUE,
                       show_labels = TRUE,
                       legend_title = "value",
                       row_linkage = NULL,
                       col_linkage = NULL,
                       theme = NULL,
                       width = NULL,
                       height = NULL,
                       element_id = NULL) {
  if (!is.matrix(mat)) {
    mat <- tryCatch(as.matrix(mat), error = function(e) {
      stop("`mat` must be a matrix (or coercible to one).", call. = FALSE)
    })
  }
  if (!is.numeric(mat)) {
    stop("`mat` must be a numeric matrix.", call. = FALSE)
  }
  metric <- match.arg(metric)
  linkage <- match.arg(linkage)
  if (linkage == "ward" && metric != "euclidean") {
    warning(
      "Ward linkage assumes euclidean distances; with `metric = \"",
      metric, "\"` its merge heights have no clear meaning.",
      call. = FALSE
    )
  }
  if (!is.null(colormap)) {
    colormap <- match.arg(colormap, c("viridis", "rdbu", "ltc", "ltcdiv"))
  }

  nr <- nrow(mat)
  nc <- ncol(mat)
  bv_require_nonempty(nr * nc, "mat")

  # Row-major flatten: t() then as.vector() walks columns of the transpose,
  # i.e. row 1 (all cols), row 2, ... which is the layout the JS core expects.
  values <- bv_require_numeric(as.vector(t(mat)), "mat")
  bv_check_finite(values, "mat")

  if (!is.null(row_linkage)) bv_check_linkage(row_linkage, nr, "row_linkage")
  if (!is.null(col_linkage)) bv_check_linkage(col_linkage, nc, "col_linkage")

  meta <- list(nrows = nr, ncols = nc)
  rn <- rownames(mat)
  cn <- colnames(mat)
  if (!is.null(rn)) meta$rowLabels <- as.character(rn)
  if (!is.null(cn)) meta$colLabels <- as.character(cn)
  if (!is.null(row_linkage)) meta$rowLinkage <- row_linkage
  if (!is.null(col_linkage)) meta$colLinkage <- col_linkage

  options <- list(
    metric = metric,
    linkage = linkage,
    zScore = z_score,
    clusterRows = cluster_rows,
    clusterCols = cluster_cols,
    showRowDendrogram = show_row_dendrogram,
    showColDendrogram = show_col_dendrogram,
    showLabels = show_labels,
    legendTitle = legend_title
  )
  # A NULL colormap drops the key, and the browser then draws "rdbu" for
  # z-scores and "viridis" otherwise.
  options$colormap <- colormap
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "clustermap", list(values = values),
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id,
    array_meta = c("rowLabels", "colLabels")
  )
}

#' Shiny bindings for clustermap
#'
#' Output and render functions for using [clustermap()] within Shiny
#' applications and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [clustermap()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `clustermapOutput()` returns a Shiny output UI element;
#'   `renderClustermap()` returns a Shiny render function.
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(clustermapOutput("cm"))
#'   server <- function(input, output) {
#'     output$cm <- renderClustermap({
#'       clustermap(matrix(rnorm(200), 20, 10))
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
#' @name clustermap-shiny
#' @export
clustermapOutput <- function(output_id, width = "100%", height = "560px") {
  htmlwidgets::shinyWidgetOutput(output_id, "clustermap", width, height,
    package = "plotomics"
  )
}

#' @rdname clustermap-shiny
#' @export
renderClustermap <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, clustermapOutput, env, quoted = TRUE)
}
