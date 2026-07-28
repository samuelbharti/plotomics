#' UpSet plot of set intersections
#'
#' Set intersections as a bar chart over a membership matrix. Venn diagrams stop
#' being readable at four sets and stop being drawable at five; UpSet replaces
#' the areas with an explicit matrix, so it scales to dozens of sets and stays
#' exact.
#'
#' Intersections are **exclusive**: a column counts the elements in precisely
#' that combination of sets and no others. That is what makes the columns sum to
#' the union rather than double-counting, and it is why a small `A + B` bar next
#' to large `A` and `B` bars is evidence of mutual exclusivity rather than an
#' artefact. [upset_intersections()] computes them from a logical matrix.
#'
#' @param data A data frame with a numeric `size` column, one row per
#'   intersection, in the order to draw them.
#' @param sets Character vector of set names, top to bottom.
#' @param membership Logical or 0/1 matrix, intersections x sets, saying which
#'   sets each intersection belongs to.
#' @param set_sizes Numeric vector of per-set totals for the left-hand bars.
#' @param total Universe size, shown in the corner.
#' @param bar_fraction Fraction of the height given to the intersection bars.
#' @param show_set_sizes Draw the per-set total bars.
#' @param dot_radius Matrix dot radius in pixels.
#' @param bar_color,empty_dot_color Fills for the bars and filled dots, and for
#'   dots not in the intersection. `NULL` uses the theme.
#' @param y_label Axis label for the intersection bars.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' m <- matrix(c(TRUE, FALSE, FALSE, TRUE, TRUE, TRUE), nrow = 3, byrow = TRUE)
#' upset(data.frame(size = c(40, 25, 12)), sets = c("A", "B"), membership = m)
#' @export
upset <- function(data,
                  sets,
                  membership,
                  set_sizes = NULL,
                  total = NULL,
                  bar_fraction = 0.55,
                  show_set_sizes = TRUE,
                  dot_radius = 5,
                  bar_color = NULL,
                  empty_dot_color = NULL,
                  y_label = "intersection size",
                  theme = NULL,
                  width = NULL,
                  height = NULL,
                  element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (is.null(data$size)) {
    stop("`data` must contain a `size` column.", call. = FALSE)
  }
  bv_require_nonempty(nrow(data), "data")
  sets <- as.character(sets)
  if (length(sets) == 0L) {
    stop("`sets` must name at least one set.", call. = FALSE)
  }

  size <- bv_require_numeric(data$size, "size")
  bv_check_finite(size, "size")

  m <- as.matrix(membership)
  if (nrow(m) != nrow(data)) {
    stop("`membership` must have one row per intersection.", call. = FALSE)
  }
  if (ncol(m) != length(sets)) {
    stop("`membership` must have one column per set.", call. = FALSE)
  }
  storage.mode(m) <- "integer"

  meta <- list(
    sets = I(sets),
    # Row-major: the component indexes it as intersection * nSets + set.
    membership = I(as.integer(t(m)))
  )
  if (!is.null(set_sizes)) {
    if (length(set_sizes) != length(sets)) {
      stop("`set_sizes` must have one entry per set.", call. = FALSE)
    }
    meta$setSizes <- I(as.numeric(set_sizes))
  }
  if (!is.null(total)) meta$total <- as.numeric(total)[1]

  options <- list(
    barFraction = bar_fraction,
    showSetSizes = show_set_sizes,
    dotRadius = dot_radius,
    yLabel = y_label
  )
  if (!is.null(bar_color)) options$barColor <- as.character(bar_color)[1]
  if (!is.null(empty_dot_color)) {
    options$emptyDotColor <- as.character(empty_dot_color)[1]
  }
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "upset", list(size = size),
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Exclusive set intersections from a membership matrix
#'
#' Counts the elements belonging to precisely each observed combination of sets.
#' Elements in no set are excluded, since they have no column to sit in.
#'
#' @param m A logical matrix, elements x sets, with set names as column names.
#' @param max_n Keep only the `max_n` largest intersections. `NULL` keeps all.
#' @return A list with `size` (integer vector), `membership` (logical matrix,
#'   intersections x sets), `sets`, `set_sizes` and `total`.
#' @examples
#' m <- cbind(A = c(TRUE, TRUE, FALSE), B = c(TRUE, FALSE, TRUE))
#' upset_intersections(m)
#' @export
upset_intersections <- function(m, max_n = NULL) {
  m <- as.matrix(m)
  if (is.null(colnames(m))) {
    stop("`m` must have column names naming the sets.", call. = FALSE)
  }
  storage.mode(m) <- "logical"
  m[is.na(m)] <- FALSE

  keys <- apply(m, 1L, function(r) paste0(as.integer(r), collapse = ""))
  empty <- strrep("0", ncol(m))
  keys <- keys[keys != empty]
  if (length(keys) == 0L) {
    return(list(size = integer(0),
                membership = matrix(FALSE, 0, ncol(m),
                                    dimnames = list(NULL, colnames(m))),
                sets = colnames(m), set_sizes = colSums(m), total = nrow(m)))
  }
  tab <- sort(table(keys), decreasing = TRUE)
  if (!is.null(max_n)) tab <- utils::head(tab, max_n)

  memb <- t(vapply(names(tab), function(k) {
    as.integer(strsplit(k, "", fixed = TRUE)[[1]]) == 1L
  }, logical(ncol(m))))
  dimnames(memb) <- list(NULL, colnames(m))

  list(size = as.integer(tab), membership = memb, sets = colnames(m),
       set_sizes = colSums(m), total = nrow(m))
}

#' Shiny bindings for upset
#'
#' Output and render functions for using [upset()] within Shiny applications and
#' interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates an [upset()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `upsetOutput()` returns a Shiny output UI element; `renderUpset()`
#'   returns a Shiny render function.
#' @name upset-shiny
#' @export
upsetOutput <- function(output_id, width = "100%", height = "520px") {
  htmlwidgets::shinyWidgetOutput(output_id, "upset", width, height,
    package = "plotomics"
  )
}

#' @rdname upset-shiny
#' @export
renderUpset <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, upsetOutput, env, quoted = TRUE)
}
