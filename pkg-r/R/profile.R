#' Grouped categorical bar profile
#'
#' An ordered bar profile whose categories collapse into coloured header blocks.
#' Built for the 96-context mutational signature plot, where the bars are the
#' trinucleotide contexts and the six blocks are the substitution classes, a
#' layout conventional enough that readers parse it without a legend. It
#' generalises to any ordered categorical profile that groups into runs, hence
#' the generic name.
#'
#' Bars are canvas-drawn, so a few thousand bins (a binned copy-number profile,
#' a coverage track) work as well as 96 contexts.
#'
#' Bars are drawn in the order given. For SBS96 that order is part of the
#' convention, so the component does not sort.
#'
#' Named `bioprofile()` rather than `profile()` so that attaching the package
#' does not mask the [stats::profile()] generic, which profiles a fitted
#' model's likelihood. This follows [bioheatmap()], which keeps clear of
#' [stats::heatmap()] the same way. `profile_plotomics()` is an alias, for
#' symmetry with `heatmap_plotomics()`.
#'
#' @param data A data frame with a numeric `value` column. Optional `group`
#'   (category per bar, whose contiguous runs become the header blocks) and
#'   `label` (per-bar tick label) columns.
#' @param groups Character vector fixing the group order and colour assignment.
#'   Defaults to order of appearance.
#' @param group_colors One hex colour per group. `NULL` uses the component's
#'   categorical palette.
#' @param title Optional title drawn above the header band.
#' @param bar_width Fraction of each slot the bar occupies, in `(0, 1]`.
#' @param as_fraction Show values as a share of the total rather than raw counts.
#' @param show_header,show_bar_labels Toggle the header band and tick labels.
#' @param y_label Axis label.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' df <- data.frame(
#'   value = c(3, 5, 2, 8),
#'   group = c("C>A", "C>A", "C>T", "C>T"),
#'   label = c("ACA", "ACC", "TCA", "TCT")
#' )
#' bioprofile(df)
#' @export
bioprofile <- function(data,
                       groups = NULL,
                       group_colors = NULL,
                       title = NULL,
                       bar_width = 0.62,
                       as_fraction = FALSE,
                       show_header = TRUE,
                       show_bar_labels = TRUE,
                       y_label = "mutations",
                       theme = NULL,
                       width = NULL,
                       height = NULL,
                       element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (is.null(data$value)) {
    stop("`data` must contain a `value` column.", call. = FALSE)
  }
  bv_require_nonempty(nrow(data), "data")
  if (bar_width <= 0 || bar_width > 1) {
    stop("`bar_width` must be in (0, 1].", call. = FALSE)
  }

  value <- bv_require_numeric(data$value, "value")
  bv_check_finite(value, "value")
  columns <- list(value = value)

  grp <- if (!is.null(data$group)) as.character(data$group) else NULL
  if (!is.null(grp)) columns$group <- grp
  if (!is.null(data$label)) columns$label <- as.character(data$label)

  meta <- list()
  if (is.null(groups) && !is.null(grp)) groups <- unique(grp)
  if (!is.null(groups)) {
    groups <- as.character(groups)
    unknown <- setdiff(unique(grp), groups)
    if (length(unknown) > 0L) {
      stop(sprintf(
        "group(s) not present in `groups`: %s",
        paste(unknown, collapse = ", ")
      ), call. = FALSE)
    }
    meta$groups <- I(groups)
    if (!is.null(group_colors)) {
      if (length(group_colors) != length(groups)) {
        stop("`group_colors` must have one entry per group.", call. = FALSE)
      }
      meta$groupColors <- I(as.character(group_colors))
    }
  }
  if (!is.null(title)) meta$title <- as.character(title)[1]

  options <- list(
    barWidth = bar_width,
    asFraction = as_fraction,
    showHeader = show_header,
    showBarLabels = show_bar_labels,
    yLabel = y_label
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "profile", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' @rdname bioprofile
#' @export
profile_plotomics <- bioprofile

#' Shiny bindings for bioprofile
#'
#' Output and render functions for using [bioprofile()] within Shiny
#' applications and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [bioprofile()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `bioprofileOutput()` returns a Shiny output UI element;
#'   `renderBioprofile()` returns a Shiny render function.
#' @name bioprofile-shiny
#' @export
bioprofileOutput <- function(output_id, width = "100%", height = "380px") {
  htmlwidgets::shinyWidgetOutput(output_id, "profile", width, height,
    package = "plotomics"
  )
}

#' @rdname bioprofile-shiny
#' @export
renderBioprofile <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, bioprofileOutput, env, quoted = TRUE)
}
