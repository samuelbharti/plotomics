#' Volcano plot
#'
#' A GPU-accelerated volcano plot for differential-expression results. Points
#' are rendered with WebGL (via regl-scatterplot) so hundreds of thousands to
#' millions of genes/features stay interactive, while axes, threshold guides
#' and gene labels are drawn as crisp vector overlays.
#'
#' @param data A data frame with numeric columns `x` (log2 fold change) and `y`
#'   (`-log10` p-value). An optional `label` column supplies gene names for
#'   tooltips and top-hit labels.
#' @param fc_threshold Absolute log2 fold-change cutoff for calling a hit.
#' @param p_threshold P-value cutoff (applied on the `-log10` scale).
#' @param point_size Point radius in pixels.
#' @param opacity Point opacity in `[0, 1]`.
#' @param colors Optional named list of hex colors for the three point classes:
#'   `up`, `down` and `ns` (not significant). `NULL` (the default) uses the
#'   component's built-in palette.
#' @param x_label,y_label Axis titles.
#' @param show_threshold_lines Draw the fold-change / p-value threshold guides.
#' @param label_top_n Number of top up- and down-regulated genes to label.
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' df <- data.frame(
#'   x = rnorm(2000),
#'   y = abs(rnorm(2000)) * 3,
#'   label = paste0("GENE", seq_len(2000))
#' )
#' volcano(df)
#' @export
volcano <- function(data,
                    fc_threshold = 1,
                    p_threshold = 0.05,
                    point_size = 3,
                    opacity = 0.8,
                    colors = NULL,
                    x_label = "log2 fold change",
                    y_label = "-log10 p-value",
                    show_threshold_lines = TRUE,
                    label_top_n = 10,
                    theme = NULL,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (!all(c("x", "y") %in% names(data))) {
    stop("`data` must contain columns `x` and `y`.", call. = FALSE)
  }
  bv_require_nonempty(nrow(data), "data")

  x <- bv_require_numeric(data$x, "x")
  bv_check_finite(x, "x")
  y <- bv_require_numeric(data$y, "y")
  bv_check_finite(y, "y")

  columns <- list(x = x, y = y)
  if (!is.null(data$label)) {
    columns$label <- as.character(data$label)
  }

  options <- list(
    fcThreshold = fc_threshold,
    pThreshold = p_threshold,
    pointSize = point_size,
    opacity = opacity,
    xLabel = x_label,
    yLabel = y_label,
    showThresholdLines = show_threshold_lines,
    labelTopN = label_top_n
  )
  if (!is.null(colors)) options$colors <- colors
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "volcano", columns,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for volcano
#'
#' Output and render functions for using [volcano()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [volcano()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `volcanoOutput()` returns a Shiny output UI element;
#'   `renderVolcano()` returns a Shiny render function.
#' @name volcano-shiny
#' @export
volcanoOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "volcano", width, height,
    package = "plotomics"
  )
}

#' @rdname volcano-shiny
#' @export
renderVolcano <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, volcanoOutput, env, quoted = TRUE)
}
