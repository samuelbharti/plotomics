# Default height in px of each plot, the same in R, Shiny and Python. It
# applies where the page does not set the size: R Markdown, Quarto, Shiny
# and Jupyter. The RStudio viewer and a browser fill the window.
plotomics_heights <- c(
  clustermap = 560, dotplot = 560, embedding = 480, heatmap = 480,
  hic = 480, km = 520, lollipop = 440, network = 480, oncoplot = 560,
  profile = 380, spatial = 560, treemap = 480, upset = 520, violin = 560,
  volcano = 480
)

plotomics_height <- function(name) {
  h <- plotomics_heights[name]
  if (is.na(h)) 480 else unname(h)
}

#' Construct a plotomics htmlwidget
#'
#' Internal helper shared by every component constructor. It assembles the
#' `list(data = list(columns, meta), options)` payload that the JavaScript
#' runtime (`window.plotomics`) expects and hands it to [htmlwidgets::createWidget()].
#' The per-component binding (`inst/htmlwidgets/<name>.js`) and its bundled JS
#' dependency (`inst/htmlwidgets/<name>.yaml`) are picked up automatically by
#' name.
#'
#' @param name Component name; must match the JS factory registered under
#'   `window.plotomics` and the binding/yaml file names.
#' @param columns Named list of equal-length column vectors.
#' @param meta Named list of scalar metadata (labels, level names, ...).
#' @param options Named list of component options (camelCase keys).
#' @param width,height Optional widget dimensions.
#' @param element_id Optional explicit DOM id.
#' @param array_meta,array_options Names of `meta` and `options` entries that
#'   the JavaScript reads as arrays. They stay JSON arrays at any length; see
#'   [bv_keep_arrays()].
#' @return An object of class `htmlwidget`.
#' @keywords internal
#' @noRd
plotomics_widget <- function(name, columns, meta = list(), options = list(),
                          width = NULL, height = NULL, element_id = NULL,
                          array_meta = character(),
                          array_options = character()) {
  x <- list(
    data = list(columns = columns, meta = meta),
    options = options
  )

  htmlwidgets::createWidget(
    name = name,
    x = x,
    width = width,
    height = height,
    package = "plotomics",
    elementId = element_id,
    preRenderHook = function(widget) {
      bv_keep_arrays(widget, array_meta, array_options)
    },
    sizingPolicy = htmlwidgets::sizingPolicy(
      browser.fill = TRUE,
      viewer.fill = TRUE,
      knitr.figure = FALSE,
      defaultWidth = "100%",
      defaultHeight = plotomics_height(name),
      padding = 0
    )
  )
}

#' Keep the vectors the JavaScript reads as arrays as JSON arrays
#'
#' htmlwidgets serialises the payload with `auto_unbox = TRUE`, so a vector of
#' length 1 reaches the browser as a bare value: a one-row data frame sends
#' `"x":2` and a single class sends `"classes":"missense"`. The JavaScript then
#' reads the length of a number, or a string one character at a time. Every
#' data column is an array to the JavaScript, and so are the `meta` and
#' `options` entries named by the component, and `theme$categorical`. This
#' marks each of them with [I()] just before the widget is serialised, so the
#' payload a test or a user inspects stays as it was built.
#'
#' @param widget The widget passed to the `preRenderHook`.
#' @param array_meta,array_options Names of the `meta` and `options` entries to
#'   keep as arrays.
#' @return The widget with those entries marked.
#' @keywords internal
#' @noRd
bv_keep_arrays <- function(widget, array_meta = character(),
                           array_options = character()) {
  x <- widget$x
  x$data$columns <- lapply(x$data$columns, bv_as_array)
  for (k in intersect(array_meta, names(x$data$meta))) {
    x$data$meta[[k]] <- bv_as_array(x$data$meta[[k]])
  }
  for (k in intersect(array_options, names(x$options))) {
    x$options[[k]] <- bv_as_array(x$options[[k]])
  }
  theme <- x$options$theme
  if (is.list(theme) && !is.null(theme$categorical)) {
    x$options$theme$categorical <- bv_as_array(theme$categorical)
  }
  widget$x <- x
  widget
}

#' Mark an atomic vector with I() so it serialises as a JSON array
#' @noRd
bv_as_array <- function(v) {
  if (is.null(v) || !is.atomic(v) || inherits(v, "AsIs")) v else I(v)
}
