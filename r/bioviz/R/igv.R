#' Genome viewer (igv.js)
#'
#' An embeddable interactive genome browser powered by
#' [igv.js](https://github.com/igvteam/igv.js). Unlike the other bioviz
#' components this one is *config-driven*: igv.js streams and tiles remote
#' indexed files (BAM/CRAM, bigWig, VCF, BED, ...) itself, so data flows through
#' the browser configuration as URLs rather than as columns.
#'
#' Supply either a full igv.js `config` (a named list matching the igv.js
#' browser configuration) or the convenience arguments `genome`, `locus` and
#' `tracks`, which are assembled into a config when `config` is `NULL`.
#'
#' @param genome Genome identifier understood by igv.js (e.g. `"hg38"`,
#'   `"hg19"`, `"mm10"`). Used when `config` is `NULL`.
#' @param locus Optional initial locus string, e.g.
#'   `"chr8:127,736,588-127,739,371"`, or a gene symbol.
#' @param tracks A list of igv.js track configurations (each a named list with
#'   at least a `url`). Used when `config` is `NULL`.
#' @param config Optional full igv.js browser configuration (named list). When
#'   supplied it is passed through as-is and the convenience arguments are
#'   ignored.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' # Genome only
#' igv(genome = "hg38")
#'
#' # Genome + locus + a public bigWig track
#' igv(
#'   genome = "hg38",
#'   locus = "chr8:127,736,588-127,739,371",
#'   tracks = list(list(
#'     name = "CTCF",
#'     url = "https://www.encodeproject.org/files/ENCFF356YES/@@download/ENCFF356YES.bigWig",
#'     format = "bigWig"
#'   ))
#' )
#' @export
igv <- function(genome = "hg38",
                locus = NULL,
                tracks = list(),
                config = NULL,
                width = NULL,
                height = NULL,
                element_id = NULL) {
  if (!is.null(config) && !is.list(config)) {
    stop("`config` must be a named list (an igv.js browser config).",
      call. = FALSE
    )
  }
  if (!is.list(tracks)) {
    stop("`tracks` must be a list of igv.js track configurations.",
      call. = FALSE
    )
  }

  options <- list()
  if (!is.null(config)) {
    options$config <- config
  } else {
    if (!is.null(genome)) options$genome <- genome
    if (!is.null(locus)) options$locus <- locus
    if (length(tracks) > 0) options$tracks <- tracks
  }

  # igv streams via config URLs, so there are no data columns.
  bioviz_widget(
    "igv", columns = list(),
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for igv
#'
#' Output and render functions for using [igv()] within Shiny applications and
#' interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates an [igv()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `igvOutput()` returns a Shiny output UI element;
#'   `renderIgv()` returns a Shiny render function.
#' @name igv-shiny
#' @export
igvOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "igv", width, height,
    package = "bioviz"
  )
}

#' @rdname igv-shiny
#' @export
renderIgv <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, igvOutput, env, quoted = TRUE)
}
