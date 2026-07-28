#' Protein domain lollipop
#'
#' Variants along a protein, drawn over its domain architecture: a backbone
#' spanning the sequence with domain rectangles on it, mutation stems whose head
#' area is proportional to recurrence, and an optional post-translational
#' modification track below. Hotspots inside a functional domain read very
#' differently from truncating variants scattered across one, which is what this
#' figure exists to show.
#'
#' Stems and domains are canvas-drawn so a protein with thousands of variants
#' stays responsive; labels, axis and legend are a vector overlay.
#'
#' @param variants A data frame with columns `position` (amino-acid position,
#'   1-based) and `count` (recurrence). Optional `class` (variant class) and
#'   `label` (e.g. `"R175H"`) columns drive the colour and the text labels.
#' @param length Protein length in residues.
#' @param gene,uniprot Identifiers shown on the axis title.
#' @param domains Optional data frame of domain rectangles with columns `name`,
#'   `start` and `end`.
#' @param ptms Optional data frame of modification sites with columns
#'   `position` and `type`.
#' @param classes Character vector fixing the legend order and colour
#'   assignment. Defaults to the classes present, most frequent first.
#' @param class_colors,domain_colors Character vectors of hex colours. `NULL`
#'   uses the component's categorical palette.
#' @param label_top_n Label the `n` most recurrent variants. Which stems get a
#'   label is resolved here and sent to the browser, so a redraw, an export and
#'   any static counterpart all label the same ones.
#' @param show_ptms,show_domains,show_legend Toggle the surrounding tracks.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' v <- data.frame(
#'   position = c(175, 248, 273),
#'   count = c(21, 15, 13),
#'   class = c("Missense", "Missense", "Missense"),
#'   label = c("R175H", "R248Q", "R273H")
#' )
#' d <- data.frame(name = "P53 DNA-binding", start = 100, end = 288)
#' lollipop(v, length = 393, gene = "TP53", uniprot = "P04637", domains = d)
#' @export
lollipop <- function(variants,
                     length,
                     gene = NULL,
                     uniprot = NULL,
                     domains = NULL,
                     ptms = NULL,
                     classes = NULL,
                     class_colors = NULL,
                     domain_colors = NULL,
                     label_top_n = 12,
                     show_ptms = TRUE,
                     show_domains = TRUE,
                     show_legend = TRUE,
                     theme = NULL,
                     width = NULL,
                     height = NULL,
                     element_id = NULL) {
  if (!is.data.frame(variants)) {
    stop("`variants` must be a data frame.", call. = FALSE)
  }
  if (!all(c("position", "count") %in% names(variants))) {
    stop("`variants` must contain columns `position` and `count`.",
      call. = FALSE
    )
  }
  bv_require_nonempty(nrow(variants), "variants")
  if (!is.numeric(length) || base::length(length) != 1L || length < 1) {
    stop("`length` must be a single positive protein length.", call. = FALSE)
  }

  position <- bv_require_numeric(variants$position, "position")
  count <- bv_require_numeric(variants$count, "count")
  bv_check_finite(position, "position")
  bv_check_finite(count, "count")
  if (any(position < 1 | position > length)) {
    stop("`position` must fall within 1..length.", call. = FALSE)
  }

  cls <- if (!is.null(variants$class)) as.character(variants$class) else NULL
  lab <- if (!is.null(variants$label)) as.character(variants$label) else NULL

  if (is.null(classes) && !is.null(cls)) {
    classes <- names(sort(table(cls), decreasing = TRUE))
  }
  if (!is.null(classes)) {
    classes <- as.character(classes)
    unknown <- setdiff(unique(cls), classes)
    if (base::length(unknown) > 0L) {
      stop(sprintf(
        "class(es) not present in `classes`: %s",
        paste(unknown, collapse = ", ")
      ), call. = FALSE)
    }
    if (!is.null(class_colors) &&
          base::length(class_colors) != base::length(classes)) {
      stop("`class_colors` must have one entry per class.", call. = FALSE)
    }
  }

  columns <- list(position = position, count = count)
  if (!is.null(cls)) columns$class <- cls
  if (!is.null(lab)) columns$label <- lab

  meta <- list(length = as.numeric(length))
  if (!is.null(gene)) meta$gene <- as.character(gene)[1]
  if (!is.null(uniprot)) meta$uniprot <- as.character(uniprot)[1]
  if (!is.null(classes)) meta$classes <- I(classes)
  if (!is.null(class_colors)) meta$classColors <- I(as.character(class_colors))

  if (!is.null(domains)) {
    if (!all(c("name", "start", "end") %in% names(domains))) {
      stop("`domains` must contain columns `name`, `start` and `end`.",
        call. = FALSE
      )
    }
    # A one-row domain table must still serialize as a JSON array, hence the
    # list-of-lists rather than a data frame.
    meta$domains <- lapply(seq_len(nrow(domains)), function(i) {
      list(name = as.character(domains$name[i]),
           start = as.numeric(domains$start[i]),
           end = as.numeric(domains$end[i]))
    })
    if (!is.null(domain_colors)) {
      meta$domainColors <- I(as.character(domain_colors))
    }
  }
  if (!is.null(ptms)) {
    if (!all(c("position", "type") %in% names(ptms))) {
      stop("`ptms` must contain columns `position` and `type`.", call. = FALSE)
    }
    meta$ptms <- lapply(seq_len(nrow(ptms)), function(i) {
      list(position = as.numeric(ptms$position[i]),
           type = as.character(ptms$type[i]))
    })
  }

  # Resolve the labelled stems once, here, rather than letting the renderer
  # pick independently. 0-based for the JS side.
  if (!is.null(lab) && label_top_n > 0) {
    top <- order(-count)[seq_len(min(label_top_n, base::length(count)))]
    meta$labelIndex <- I(as.integer(sort(top) - 1L))
  }

  options <- list(
    showPtms = show_ptms,
    showDomains = show_domains,
    showLegend = show_legend
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "lollipop", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for lollipop
#'
#' Output and render functions for using [lollipop()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [lollipop()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `lollipopOutput()` returns a Shiny output UI element;
#'   `renderLollipop()` returns a Shiny render function.
#' @name lollipop-shiny
#' @export
lollipopOutput <- function(output_id, width = "100%", height = "440px") {
  htmlwidgets::shinyWidgetOutput(output_id, "lollipop", width, height,
    package = "plotomics"
  )
}

#' @rdname lollipop-shiny
#' @export
renderLollipop <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, lollipopOutput, env, quoted = TRUE)
}
