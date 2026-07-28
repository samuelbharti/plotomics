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
#' @return An object of class `htmlwidget`.
#' @keywords internal
#' @noRd
plotomics_widget <- function(name, columns, meta = list(), options = list(),
                          width = NULL, height = NULL, element_id = NULL) {
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
    sizingPolicy = htmlwidgets::sizingPolicy(
      browser.fill = TRUE,
      viewer.fill = TRUE,
      knitr.figure = FALSE,
      defaultWidth = "100%",
      defaultHeight = 480,
      padding = 0
    )
  )
}
