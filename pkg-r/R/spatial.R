#' Spatial map over a tissue image
#'
#' Measurements plotted at their real coordinates on a slide, drawn on top of
#' the histology image they came from. This is the layout of a spatial
#' transcriptomics experiment: for a spatial assay the tissue *is* the axis, and
#' a cluster tracing the edge of an invasive front says something an embedding
#' cannot.
#'
#' The image and the spots share one "contain" fit, computed once, so histology
#' and overlay cannot drift apart on resize, full-screen, or a high-DPI display.
#'
#' `color` may be a character vector (categorical, discrete legend) or numeric
#' (continuous, sequential ramp with a colourbar), which is what lets one view
#' toggle between colouring by cluster and by a gene's expression.
#'
#' @section Scale:
#' Spots are drawn one at a time on a 2-D canvas, which suits a Visium-scale
#' slide of a few thousand spots. This is **not** a renderer for Xenium or
#' CosMx-scale single-cell output: a million cells will not stay interactive
#' here. For that many points use [embedding()], which draws on the GPU via
#' regl-scatterplot, and accept that it has no image underlay. Plotting both a
#' histology image and a million single cells is not something this package
#' currently does.
#'
#' @param data A data frame with numeric `x` and `y` columns giving spot centres
#'   **in image pixel coordinates**. Optional `color` (character or numeric) and
#'   `label` (tooltip text) columns.
#' @param image URL or path of the tissue image, as the browser will fetch it.
#' @param img_width,img_height Natural size of that image in pixels.
#' @param spot_diameter Spot diameter in image pixels.
#' @param levels,colors Character vectors fixing the categorical order and
#'   colours. `NULL` derives them from the data and the theme palette.
#' @param color_mode `"auto"` (detect from the column type), `"categorical"` or
#'   `"continuous"`.
#' @param colormap Sequential ramp for continuous colouring: `"viridis"`,
#'   `"rdbu"`, `"ltc"` (an earthy teal to sand to rust sequential ramp) or
#'   `"ltcdiv"` (its diverging counterpart, neutral cream at the midpoint).
#' @param spot_scale Multiplier on `spot_diameter`; 1 draws true size.
#' @param spot_opacity,image_opacity Opacities in `[0, 1]`. Lower the spot
#'   opacity to read the histology underneath.
#' @param show_image,show_legend Toggle the underlay and the legend.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' df <- data.frame(
#'   x = c(100, 150, 200), y = c(120, 160, 90),
#'   color = c("Cluster 1", "Cluster 2", "Cluster 1")
#' )
#' spatial(df, image = "tissue.png", img_width = 600, img_height = 600,
#'         spot_diameter = 8)
#' @export
spatial <- function(data,
                    image,
                    img_width,
                    img_height,
                    spot_diameter = 4,
                    levels = NULL,
                    colors = NULL,
                    color_mode = c("auto", "categorical", "continuous"),
                    colormap = c("viridis", "rdbu", "ltc", "ltcdiv"),
                    spot_scale = 1,
                    spot_opacity = 0.85,
                    image_opacity = 1,
                    show_image = TRUE,
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
  bv_require_nonempty(nrow(data), "data")
  color_mode <- match.arg(color_mode)
  colormap <- match.arg(colormap)
  if (missing(image) || !nzchar(as.character(image)[1])) {
    stop("`image` must be a URL or path the browser can fetch.", call. = FALSE)
  }
  if (!is.numeric(img_width) || !is.numeric(img_height) ||
        img_width <= 0 || img_height <= 0) {
    stop("`img_width` and `img_height` must be positive.", call. = FALSE)
  }

  x <- bv_require_numeric(data$x, "x")
  y <- bv_require_numeric(data$y, "y")
  bv_check_finite(x, "x")
  bv_check_finite(y, "y")

  columns <- list(x = x, y = y)
  if (!is.null(data$color)) {
    columns$color <- if (is.numeric(data$color)) {
      as.numeric(data$color)
    } else {
      as.character(data$color)
    }
  }
  if (!is.null(data$label)) columns$label <- as.character(data$label)

  meta <- list(
    image = as.character(image)[1],
    imgWidth = as.numeric(img_width)[1],
    imgHeight = as.numeric(img_height)[1],
    spotDiameter = as.numeric(spot_diameter)[1]
  )
  # I() so a single level or colour still crosses as a JSON array.
  if (!is.null(levels)) meta$levels <- I(as.character(levels))
  if (!is.null(colors)) meta$colors <- I(as.character(colors))
  if (!is.null(levels) && !is.null(colors) &&
        length(levels) != length(colors)) {
    stop("`colors` must have one entry per level.", call. = FALSE)
  }

  options <- list(
    colorMode = color_mode,
    colormap = colormap,
    spotScale = spot_scale,
    spotOpacity = spot_opacity,
    imageOpacity = image_opacity,
    showImage = show_image,
    showLegend = show_legend
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "spatial", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for spatial
#'
#' Output and render functions for using [spatial()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [spatial()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `spatialOutput()` returns a Shiny output UI element;
#'   `renderSpatial()` returns a Shiny render function.
#' @name spatial-shiny
#' @export
spatialOutput <- function(output_id, width = "100%", height = "560px") {
  htmlwidgets::shinyWidgetOutput(output_id, "spatial", width, height,
    package = "plotomics"
  )
}

#' @rdname spatial-shiny
#' @export
renderSpatial <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, spatialOutput, env, quoted = TRUE)
}
