#' Expression heatmap
#'
#' A GPU-accelerated heatmap for large expression matrices (samples x genes).
#' The matrix is uploaded to the GPU as a single texture and colormapped in a
#' fragment shader (via `regl`), so matrices with a million or more cells pan
#' and zoom smoothly. The colorbar legend and row/column tick labels are drawn
#' as crisp vector overlays; when rows or columns are too tight for every
#' label, every second, third or fourth one is drawn, and zooming in shows
#' the rest. A matrix with more rows or columns than the plot has pixels
#' is pooled for drawing: each pixel shows the mean of the cells under it,
#' so a lone outlier row still shows, fainter the more rows share its pixel.
#' A matrix with more rows or columns than the GPU's texture limit is
#' averaged in blocks of two or more rows (or columns) to fit it, so zoomed
#' in, the rows of a block share their mean.
#'
#' The function is exported as `bioheatmap()` (and aliased as `heatmap_plotomics()`)
#' to avoid masking [stats::heatmap()].
#'
#' @param mat A numeric matrix (rows x columns). `rownames(mat)` and
#'   `colnames(mat)`, when present, are used as row/column tick labels. A
#'   missing cell (`NA`, `NaN` or an infinite value) is drawn grey and left
#'   out of the colour range and the z-score, with a warning. Where several
#'   rows or columns share a pixel, the pixel shows the mean of their
#'   finite cells, so it is grey only when all of them are missing.
#' @param colormap Color ramp: sequential `"viridis"` or `"ltc"` (an earthy
#'   teal to sand to rust ramp), or diverging `"rdbu"` or `"ltcdiv"` (its
#'   counterpart, neutral cream at the midpoint). `NULL` (the default) uses
#'   `"rdbu"` when `z_score` is `TRUE`, so values above and below the row
#'   mean get opposite colours, and `"viridis"` otherwise.
#' @param z_score Logical; if `TRUE`, each row is z-score normalized before
#'   coloring (a row-centered heatmap).
#' @param vmin,vmax Lower/upper clamp of the color domain. `NULL` (the default)
#'   auto-scales from the data. For a diverging colormap the auto domain is
#'   symmetric about zero, and a positive `vmax` or a negative `vmin` given
#'   alone is mirrored about zero, so zero keeps the neutral colour.
#' @param show_colorbar Logical; draw the colorbar legend.
#' @param legend_title Colorbar title. `NULL` (the default) uses `"value"`, or
#'   `"z-score"` when `z_score = TRUE`.
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' m <- matrix(rnorm(50 * 30), nrow = 50, ncol = 30)
#' rownames(m) <- paste0("gene", seq_len(50))
#' colnames(m) <- paste0("sample", seq_len(30))
#' bioheatmap(m, z_score = TRUE)
#' @export
bioheatmap <- function(mat,
                       colormap = NULL,
                       z_score = FALSE,
                       vmin = NULL,
                       vmax = NULL,
                       show_colorbar = TRUE,
                       legend_title = NULL,
                       theme = NULL,
                       width = NULL,
                       height = NULL,
                       element_id = NULL) {
  if (!is.matrix(mat) || !is.numeric(mat)) {
    stop("`mat` must be a numeric matrix.", call. = FALSE)
  }
  if (!is.null(colormap)) {
    colormap <- match.arg(colormap, c("viridis", "rdbu", "ltc", "ltcdiv"))
  }

  nrows <- nrow(mat)
  ncols <- ncol(mat)
  bv_require_nonempty(nrows * ncols, "mat")

  # Row-major numeric vector: element (r, c) at index (r - 1) * ncols + c.
  # R stores matrices column-major, so transpose before flattening.
  values <- bv_require_numeric(as.vector(t(mat)), "mat")
  bv_check_finite(values, "mat")

  columns <- list(values = values)

  meta <- list(nrows = nrows, ncols = ncols)
  if (!is.null(rownames(mat))) {
    meta$rowLabels <- as.character(rownames(mat))
  }
  if (!is.null(colnames(mat))) {
    meta$colLabels <- as.character(colnames(mat))
  }

  options <- list(
    zScore = z_score,
    showColorbar = show_colorbar
  )
  # A NULL colormap, clamp or title drops the key (assigning NULL removes a
  # list element), and the browser then uses its default: "rdbu" for
  # z-scores and "viridis" otherwise, "auto" for a clamp, and "value" or
  # "z-score" for the title.
  options$colormap <- colormap
  options$vmin <- vmin
  options$vmax <- vmax
  options$legendTitle <- legend_title
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "heatmap", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id,
    array_meta = c("rowLabels", "colLabels")
  )
}

#' @rdname bioheatmap
#' @export
heatmap_plotomics <- bioheatmap

#' Shiny bindings for bioheatmap
#'
#' Output and render functions for using [bioheatmap()] within Shiny
#' applications and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [bioheatmap()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `bioheatmapOutput()` returns a Shiny output UI element;
#'   `renderBioheatmap()` returns a Shiny render function.
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(bioheatmapOutput("hm"))
#'   server <- function(input, output) {
#'     output$hm <- renderBioheatmap({
#'       bioheatmap(matrix(rnorm(200), 20, 10))
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
#' @name bioheatmap-shiny
#' @export
bioheatmapOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "heatmap", width, height,
    package = "plotomics"
  )
}

#' @rdname bioheatmap-shiny
#' @export
renderBioheatmap <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, bioheatmapOutput, env, quoted = TRUE)
}
