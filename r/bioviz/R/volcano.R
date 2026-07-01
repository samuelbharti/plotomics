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
#' @param x_label,y_label Axis titles.
#' @param label_top_n Number of top up- and down-regulated genes to label.
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
                    x_label = "log2 fold change",
                    y_label = "-log10 p-value",
                    label_top_n = 10,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (!all(c("x", "y") %in% names(data))) {
    stop("`data` must contain columns `x` and `y`.", call. = FALSE)
  }

  columns <- list(
    x = as.numeric(data$x),
    y = as.numeric(data$y)
  )
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
    labelTopN = label_top_n
  )

  bioviz_widget(
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
    package = "bioviz"
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
