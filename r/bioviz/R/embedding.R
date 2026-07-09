#' Embedding scatter (UMAP / t-SNE / PCA)
#'
#' A GPU-accelerated 2-D scatter viewer for dimensionality-reduction output.
#' Points are rendered with WebGL (via regl-scatterplot) so hundreds of
#' thousands to millions of cells stay interactive at 60fps, while the legend
#' and an optional axis frame are drawn as crisp vector overlays. Lasso
#' selection is enabled (drag from empty space to select points).
#'
#' @param data A data frame with numeric columns `x` and `y` (the embedding
#'   coordinates). An optional `color` column drives coloring: a character or
#'   factor column is treated as categorical (discrete legend), a numeric column
#'   as continuous (sequential colormap + colorbar). An optional `label` column
#'   supplies per-point tooltip text.
#' @param point_size Point radius in pixels.
#' @param opacity Point opacity in `[0, 1]`.
#' @param color_mode How to interpret the `color` column: `"auto"` detects from
#'   its type, or force `"categorical"` / `"continuous"`.
#' @param colormap Sequential color ramp for continuous coloring: `"viridis"`
#'   or `"rdbu"`.
#' @param x_label,y_label Axis titles (shown when `show_axes = TRUE`).
#' @param show_axes Draw the axis frame + ticks (embeddings usually hide axes).
#' @param show_legend Draw the legend (discrete swatches or a colorbar).
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' n <- 5000
#' k <- sample(0:5, n, replace = TRUE)
#' df <- data.frame(
#'   x = rnorm(n) + k * 4,
#'   y = rnorm(n) + (k %% 2) * 4,
#'   color = paste0("cluster ", k + 1),
#'   label = paste0("cell", seq_len(n))
#' )
#' embedding(df)
#' @export
embedding <- function(data,
                      point_size = 3,
                      opacity = 0.8,
                      color_mode = c("auto", "categorical", "continuous"),
                      colormap = c("viridis", "rdbu"),
                      x_label = "UMAP 1",
                      y_label = "UMAP 2",
                      show_axes = FALSE,
                      show_legend = TRUE,
                      width = NULL,
                      height = NULL,
                      element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (!all(c("x", "y") %in% names(data))) {
    stop("`data` must contain columns `x` and `y`.", call. = FALSE)
  }
  color_mode <- match.arg(color_mode)
  colormap <- match.arg(colormap)

  columns <- list(
    x = as.numeric(data$x),
    y = as.numeric(data$y)
  )
  if (!is.null(data$color)) {
    # Preserve type: numeric -> continuous, character/factor -> categorical.
    if (is.numeric(data$color)) {
      columns$color <- as.numeric(data$color)
    } else {
      columns$color <- as.character(data$color)
    }
  }
  if (!is.null(data$label)) {
    columns$label <- as.character(data$label)
  }

  options <- list(
    pointSize = point_size,
    opacity = opacity,
    colorMode = color_mode,
    colormap = colormap,
    xLabel = x_label,
    yLabel = y_label,
    showAxes = show_axes,
    showLegend = show_legend
  )

  bioviz_widget(
    "embedding", columns,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for embedding
#'
#' Output and render functions for using [embedding()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates an [embedding()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `embeddingOutput()` returns a Shiny output UI element;
#'   `renderEmbedding()` returns a Shiny render function.
#' @name embedding-shiny
#' @export
embeddingOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "embedding", width, height,
    package = "bioviz"
  )
}

#' @rdname embedding-shiny
#' @export
renderEmbedding <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, embeddingOutput, env, quoted = TRUE)
}
