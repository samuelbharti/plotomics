#' Expression heatmap
#'
#' A GPU-accelerated heatmap for large expression matrices (samples x genes).
#' The matrix is uploaded to the GPU as a single texture and colormapped in a
#' fragment shader (via `regl`), so matrices with a million or more cells pan
#' and zoom smoothly. The colorbar legend and row/column tick labels are drawn
#' as crisp vector overlays; ticks appear only when few enough to be legible.
#'
#' The function is exported as `bioheatmap()` (and aliased as `heatmap_plotomics()`)
#' to avoid masking [stats::heatmap()].
#'
#' @param mat A numeric matrix (rows x columns). `rownames(mat)` and
#'   `colnames(mat)`, when present, are used as row/column tick labels.
#' @param colormap Color ramp: `"viridis"` (sequential) or `"rdbu"` (diverging).
#' @param z_score Logical; if `TRUE`, each row is z-score normalized before
#'   coloring (a row-centered heatmap).
#' @param vmin,vmax Lower/upper clamp of the color domain. `NULL` (the default)
#'   auto-scales from the data; for `"rdbu"` the auto domain is symmetric about
#'   zero.
#' @param show_colorbar Logical; draw the colorbar legend.
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
                       colormap = c("viridis", "rdbu"),
                       z_score = FALSE,
                       vmin = NULL,
                       vmax = NULL,
                       show_colorbar = TRUE,
                       theme = NULL,
                       width = NULL,
                       height = NULL,
                       element_id = NULL) {
  if (!is.matrix(mat) || !is.numeric(mat)) {
    stop("`mat` must be a numeric matrix.", call. = FALSE)
  }
  colormap <- match.arg(colormap)

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
    colormap = colormap,
    zScore = z_score,
    showColorbar = show_colorbar
  )
  # NULL clamps must be sent as JSON null, not dropped, so the JS side can tell
  # "auto" from "unset". jsonlite serializes NULL inside a named list as null.
  options$vmin <- vmin
  options$vmax <- vmax
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "heatmap", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
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
