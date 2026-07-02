#' Declarative genomics figures (Gosling.js)
#'
#' A config-driven genome-visualization widget powered by
#' [Gosling.js](https://gosling-lang.org), the grammar of scalable, linked,
#' interactive nucleotide graphics. Rendering is fully declarative: you pass a
#' Gosling *specification* (an R list serialized to JSON) and data flows through
#' the spec's own `data` blocks (tileset URLs, indexed BAM/BED/VCF/BigWig, or
#' CSV/JSON URLs and inline values). Gosling streams and tiles large genomic
#' datasets on the GPU via HiGlass, so no separate `data` argument is needed.
#'
#' @param spec A Gosling specification as a (nested) named list. It is passed
#'   through verbatim to Gosling.js after JSON serialization, so option keys use
#'   Gosling's own camelCase names (e.g. `tracks`, `xDomain`, `alignment`). Must
#'   contain at least one of `tracks`, `views`, `arrangement`, `alignment` or
#'   `template`.
#' @param padding Optional outer padding (pixels) forwarded to Gosling's embed
#'   options.
#' @param theme Optional Gosling theme: a built-in name (e.g. `"dark"`) or a
#'   theme list.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' spec <- list(
#'   title = "Example track",
#'   tracks = list(list(
#'     data = list(
#'       url = paste0(
#'         "https://server.gosling-lang.org/api/v1/tileset_info/",
#'         "?d=cistrome-multivec"
#'       ),
#'       type = "multivec",
#'       row = "sample",
#'       column = "position",
#'       value = "peak",
#'       categories = list("sample 1")
#'     ),
#'     mark = "bar",
#'     x = list(field = "start", type = "genomic"),
#'     xe = list(field = "end", type = "genomic"),
#'     y = list(field = "peak", type = "quantitative"),
#'     width = 700, height = 200
#'   ))
#' )
#' gosling(spec)
#' @export
gosling <- function(spec,
                    padding = NULL,
                    theme = NULL,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.list(spec)) {
    stop("`spec` must be a list (a Gosling specification).", call. = FALSE)
  }
  spec_keys <- c("tracks", "views", "arrangement", "alignment", "template")
  if (!any(spec_keys %in% names(spec))) {
    stop(
      "`spec` must contain at least one of: ",
      paste(spec_keys, collapse = ", "), ".",
      call. = FALSE
    )
  }

  options <- list(spec = spec)
  if (!is.null(padding)) options$padding <- padding
  if (!is.null(theme)) options$theme <- theme

  # Gosling is spec-driven; the shared runtime still expects a `data` payload,
  # so an empty columns/meta object is supplied.
  bioviz_widget(
    "gosling", columns = list(),
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for gosling
#'
#' Output and render functions for using [gosling()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [gosling()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `goslingOutput()` returns a Shiny output UI element;
#'   `renderGosling()` returns a Shiny render function.
#' @name gosling-shiny
#' @export
goslingOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "gosling", width, height,
    package = "bioviz"
  )
}

#' @rdname gosling-shiny
#' @export
renderGosling <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, goslingOutput, env, quoted = TRUE)
}
