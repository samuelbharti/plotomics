#' Protein domain lollipop
#'
#' Variants along a protein, drawn over its domain architecture: a backbone
#' spanning the sequence with domain rectangles on it, mutation stems whose head
#' area is proportional to recurrence, and an optional post-translational
#' modification track below. Hotspots inside a functional domain read very
#' differently from truncating variants scattered across one, which is what this
#' figure exists to show. Variants at one residue stack on one stem, most
#' recurrent at the bottom, so the top of a stem is the residue's total.
#'
#' Stems and domains are canvas-drawn so a protein with thousands of variants
#' stays responsive; labels, axis and legend are a vector overlay.
#'
#' @param variants A data frame with columns `position` (amino-acid position,
#'   1-based) and `count` (recurrence, zero or more; a variant with a missing
#'   count is not drawn). Optional `class` (variant class) and `label` (e.g.
#'   `"R175H"`) columns drive the colour and the text labels.
#' @param length Protein length in residues.
#' @param gene,uniprot Identifiers shown on the axis title.
#' @param domains Optional data frame of domain rectangles with columns `name`,
#'   `start` and `end`.
#' @param ptms Optional data frame of modification sites with columns
#'   `position` and `type`.
#' @param classes Character vector fixing the legend order and colour
#'   assignment. Defaults to the classes present, most frequent first, equal
#'   counts by name in code point order, as in Python.
#' @param class_colors,domain_colors Character vectors of hex colours. `NULL`
#'   uses the component's categorical palette.
#' @param label_top_n Label the `n` most recurrent variants. Which stems get a
#'   label is resolved here and sent to the browser, so a redraw, an export and
#'   any static counterpart all label the same ones. `0` labels none.
#' @param show_ptms,show_domains,show_legend Toggle the surrounding tracks.
#' @param min_head_radius,max_head_radius Stem head radius range in pixels. Head
#'   *area* is proportional to recurrence, so these bound the mapping rather
#'   than setting a size: raise `max_head_radius` when one hotspot dwarfs the
#'   rest and you want the difference to read at a glance.
#' @param y_label Axis title for the recurrence axis.
#' @param backbone_color,stem_color Hex colours for the protein backbone
#'   rectangle and the mutation stems.
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
                     min_head_radius = 3,
                     max_head_radius = 11,
                     y_label = "samples",
                     backbone_color = "#E6DCC8",
                     stem_color = "#93a1b8",
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
  if (!is.numeric(length) || base::length(length) != 1L ||
      !is.finite(length) || length < 1) {
    stop("`length` must be a single positive protein length.", call. = FALSE)
  }

  position <- bv_require_numeric(variants$position, "position")
  count <- bv_require_numeric(variants$count, "count")
  bv_check_finite(position, "position")
  bv_check_finite(count, "count")
  if (any(count < 0, na.rm = TRUE)) {
    stop("`count` must be zero or more.", call. = FALSE)
  }
  if (any(position < 1 | position > length, na.rm = TRUE)) {
    stop("`position` must fall within 1..length.", call. = FALSE)
  }

  cls <- if (!is.null(variants$class)) as.character(variants$class) else NULL
  lab <- if (!is.null(variants$label)) as.character(variants$label) else NULL

  if (is.null(classes) && !is.null(cls)) {
    classes <- bv_by_frequency(cls)
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

  # Resolve the labelled stems once, here, so the renderer does not pick on
  # its own. 0-based for the JS side. With label_top_n = 0 the list is sent
  # empty: the browser labels the top 12 when it gets no list at all.
  if (!is.null(lab)) {
    n_top <- max(0, min(label_top_n, base::length(count)))
    top <- order(-count)[seq_len(n_top)]
    meta$labelIndex <- I(as.integer(sort(top) - 1L))
  }

  options <- list(
    showPtms = show_ptms,
    showDomains = show_domains,
    showLegend = show_legend,
    minHeadRadius = min_head_radius,
    maxHeadRadius = max_head_radius,
    yLabel = y_label,
    backboneColor = backbone_color,
    stemColor = stem_color
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
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(lollipopOutput("lp"))
#'   server <- function(input, output) {
#'     output$lp <- renderLollipop({
#'       variants <- data.frame(
#'         position = c(100, 250, 400),
#'         count = c(12, 5, 3),
#'         label = c("A", "B", "C")
#'       )
#'       lollipop(variants, length = 500)
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
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
