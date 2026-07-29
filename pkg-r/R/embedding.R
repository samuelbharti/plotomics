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
#'   as continuous (sequential colormap + colorbar). A **factor** `color` fixes
#'   the legend order and the color assignment to its levels, and keeps unused
#'   levels in the legend, the way `drop = FALSE` does in ggplot2. An optional
#'   `label` column supplies per-point tooltip text.
#' @param point_size Point radius in pixels. Under the default
#'   `point_scale_mode` the renderer scales this by the camera and clamps it to
#'   one pixel on a widely-scaled plot, so set `point_scale_mode = "constant"`
#'   if you want it honoured literally.
#' @param point_scale_mode How `point_size` responds to zoom. `"asinh"` and
#'   `"linear"` shrink points as you zoom out, which keeps a dense embedding
#'   readable, but both floor at one pixel once the camera scale drops below
#'   `1 / point_size`. `"constant"` sizes points in literal pixels.
#' @param opacity Point opacity in `[0, 1]`.
#' @param color_mode How to interpret the `color` column: `"auto"` detects from
#'   its type, or force `"categorical"` / `"continuous"`.
#' @param colormap Sequential color ramp for continuous coloring: `"viridis"`
#'   or `"rdbu"`.
#' @param mouse_mode Primary drag gesture: `"panZoom"` (default) pans/zooms and
#'   `"lasso"` makes a plain drag draw a selection.
#' @param x_label,y_label Axis titles (shown when `show_axes = TRUE`).
#' @param aspect How the fitted view maps data units onto pixels. `"fill"`
#'   stretches each axis to fill the canvas, which suits a UMAP, whose axes
#'   carry no units. `"equal"` gives both axes the same units per pixel; use it
#'   when the axes share units and their relative spread is part of the claim,
#'   as in PCA scores.
#' @param padding Fraction of the data range to pad around the fitted view.
#'   Larger values zoom out, leaving more empty space at the edges, which stops
#'   the outermost points being clipped by the canvas border.
#' @param show_axes Draw the axis frame + ticks (embeddings usually hide axes).
#' @param show_legend Draw the legend (discrete swatches or a colorbar).
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
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
                      point_scale_mode = c("asinh", "linear", "constant"),
                      opacity = 0.8,
                      color_mode = c("auto", "categorical", "continuous"),
                      colormap = c("viridis", "rdbu"),
                      mouse_mode = c("panZoom", "lasso"),
                      aspect = c("fill", "equal"),
                      padding = 0.04,
                      x_label = "UMAP 1",
                      y_label = "UMAP 2",
                      show_axes = FALSE,
                      show_legend = TRUE,
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
  color_mode <- match.arg(color_mode)
  colormap <- match.arg(colormap)
  mouse_mode <- match.arg(mouse_mode)
  aspect <- match.arg(aspect)
  point_scale_mode <- match.arg(point_scale_mode)
  bv_require_nonempty(nrow(data), "data")

  x <- bv_require_numeric(data$x, "x")
  bv_check_finite(x, "x")
  y <- bv_require_numeric(data$y, "y")
  bv_check_finite(y, "y")

  columns <- list(x = x, y = y)
  categories <- NULL
  if (!is.null(data$color)) {
    # Preserve type: numeric -> continuous, character/factor -> categorical.
    if (is.numeric(data$color)) {
      col <- bv_require_numeric(data$color, "color")
      bv_check_finite(col, "color")
      columns$color <- col
    } else {
      # A factor is someone stating the order they want. Send the levels along
      # so the browser assigns colors by level rather than by whichever
      # category the first row happens to hold.
      if (is.factor(data$color)) categories <- levels(data$color)
      columns$color <- as.character(data$color)
    }
  }
  if (!is.null(data$label)) {
    columns$label <- as.character(data$label)
  }

  options <- list(
    pointSize = point_size,
    pointScaleMode = point_scale_mode,
    opacity = opacity,
    colorMode = color_mode,
    colormap = colormap,
    mouseMode = mouse_mode,
    aspect = aspect,
    padding = padding,
    xLabel = x_label,
    yLabel = y_label,
    showAxes = show_axes,
    showLegend = show_legend
  )
  if (!is.null(categories)) options$categories <- as.list(categories)
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
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
#' In a Shiny app the lasso selection is pushed back to the server as
#' `input$<output_id>_selected`, a 0-based integer vector of the selected rows
#' (so `embeddingOutput("umap")` populates `input$umap_selected`). It updates on
#' every completed selection and is `NULL` until the first one.
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
    package = "plotomics"
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
