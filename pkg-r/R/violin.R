#' Stacked violin plot
#'
#' One row per feature, one violin per group. A box plot hides bimodality,
#' which in single-cell data is usually the whole story: a gene expressed in
#' half a cluster and silent in the other half has the same median as one
#' expressed weakly everywhere. The violin shows the shape, and stacking rows
#' on a shared x lets a marker panel be read down the page.
#'
#' The widget draws densities, it does not estimate them. Each violin arrives as
#' a vector of density values on a shared grid, because kernel bandwidth choice
#' changes what the figure claims and belongs with the data. [violin_density()]
#' computes them from raw values with [stats::density()].
#'
#' @param data A data frame with `feature` and `group` key columns, one row per
#'   violin, in the order to draw them.
#' @param grid Numeric vector, the shared evaluation grid, ascending.
#' @param density Numeric matrix, violins x `grid`, of density values.
#' @param median Optional numeric vector, one median per violin, drawn as a tick.
#' @param features,groups Character vectors fixing the row and column order.
#'   Factor `feature` / `group` columns supply them from their levels.
#' @param group_colors One hex colour per group. `NULL` uses the categorical
#'   palette.
#' @param violin_width Fraction of a cell's width the widest violin fills.
#' @param scale_per_violin Scale each violin to its own maximum rather than the
#'   row's. Per-row is the default so groups stay comparable within a feature.
#' @param show_median,show_feature_labels Toggle the median tick and row labels.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' d <- violin_density(list(`CD3D|T` = rnorm(50, 2), `CD3D|B` = rnorm(50, 0)))
#' violin(d$data, grid = d$grid, density = d$density, median = d$median)
#' @export
violin <- function(data,
                   grid,
                   density,
                   median = NULL,
                   features = NULL,
                   groups = NULL,
                   group_colors = NULL,
                   violin_width = 0.85,
                   scale_per_violin = FALSE,
                   show_median = TRUE,
                   show_feature_labels = TRUE,
                   theme = NULL,
                   width = NULL,
                   height = NULL,
                   element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  missing_cols <- setdiff(c("feature", "group"), names(data))
  if (length(missing_cols) > 0L) {
    stop(sprintf("`data` is missing column(s): %s",
                 paste(missing_cols, collapse = ", ")), call. = FALSE)
  }
  bv_require_nonempty(nrow(data), "data")
  if (violin_width <= 0 || violin_width > 1) {
    stop("`violin_width` must be in (0, 1].", call. = FALSE)
  }

  grid <- bv_require_numeric(grid, "grid")
  bv_check_finite(grid, "grid")
  if (is.unsorted(grid)) {
    stop("`grid` must be ascending.", call. = FALSE)
  }
  dm <- as.matrix(density)
  if (nrow(dm) != nrow(data)) {
    stop("`density` must have one row per violin.", call. = FALSE)
  }
  if (ncol(dm) != length(grid)) {
    stop("`density` must have one column per `grid` entry.", call. = FALSE)
  }

  columns <- list(
    feature = as.character(data$feature),
    group = as.character(data$group)
  )

  if (is.null(features) && is.factor(data$feature)) features <- levels(data$feature)
  if (is.null(groups) && is.factor(data$group)) groups <- levels(data$group)

  meta <- list(
    grid = I(as.numeric(grid)),
    # Row-major: the component indexes it as violin * gridLen + k.
    density = I(as.numeric(t(dm)))
  )
  if (!is.null(features)) {
    features <- as.character(features)
    unknown <- setdiff(unique(columns$feature), features)
    if (length(unknown) > 0L) {
      stop(sprintf("feature(s) not present in `features`: %s",
                   paste(utils::head(unknown, 5), collapse = ", ")), call. = FALSE)
    }
    meta$features <- I(features)
  }
  if (!is.null(groups)) {
    groups <- as.character(groups)
    unknown <- setdiff(unique(columns$group), groups)
    if (length(unknown) > 0L) {
      stop(sprintf("group(s) not present in `groups`: %s",
                   paste(utils::head(unknown, 5), collapse = ", ")), call. = FALSE)
    }
    meta$groups <- I(groups)
    if (!is.null(group_colors)) {
      if (length(group_colors) != length(groups)) {
        stop("`group_colors` must have one entry per group.", call. = FALSE)
      }
      meta$groupColors <- I(as.character(group_colors))
    }
  }
  if (!is.null(median)) {
    if (length(median) != nrow(data)) {
      stop("`median` must have one entry per violin.", call. = FALSE)
    }
    meta$median <- I(as.numeric(median))
  }

  options <- list(
    violinWidth = violin_width,
    scalePerViolin = scale_per_violin,
    showMedian = show_median,
    showFeatureLabels = show_feature_labels
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "violin", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Kernel densities on a shared grid
#'
#' Evaluates every group's density on one grid spanning all of them, which is
#' what lets the violins be compared. Groups with fewer than two distinct values
#' get a flat zero row rather than an error, since a cluster with one cell is a
#' real thing to encounter.
#'
#' @param values A named list of numeric vectors, one per violin. Names of the
#'   form `"feature|group"` are split into the two key columns.
#' @param n Grid resolution.
#' @param adjust Bandwidth multiplier, passed to [stats::density()].
#' @return A list with `data` (the key columns), `grid`, `density` and `median`.
#' @examples
#' violin_density(list(`A|x` = rnorm(20), `A|y` = rnorm(20, 3)))
#' @export
violin_density <- function(values, n = 64L, adjust = 1) {
  if (!length(values) || is.null(names(values))) {
    stop("`values` must be a named list of numeric vectors.", call. = FALSE)
  }
  all_v <- unlist(values, use.names = FALSE)
  all_v <- all_v[is.finite(all_v)]
  if (!length(all_v)) {
    stop("`values` contains no finite numbers.", call. = FALSE)
  }
  from <- min(all_v)
  to <- max(all_v)
  if (from == to) to <- from + 1
  grid <- seq(from, to, length.out = n)

  dens <- t(vapply(values, function(v) {
    v <- v[is.finite(v)]
    if (length(v) < 2L || length(unique(v)) < 2L) return(rep(0, n))
    d <- stats::density(v, from = from, to = to, n = n, adjust = adjust)
    d$y
  }, numeric(n)))
  med <- vapply(values, function(v) {
    v <- v[is.finite(v)]
    if (!length(v)) NA_real_ else stats::median(v)
  }, numeric(1))

  parts <- strsplit(names(values), "|", fixed = TRUE)
  feature <- vapply(parts, function(p) p[1], character(1))
  group <- vapply(parts, function(p) if (length(p) > 1) p[2] else "", character(1))

  list(
    data = data.frame(feature = feature, group = group,
                      stringsAsFactors = FALSE),
    grid = grid,
    density = dens,
    median = unname(med)
  )
}

#' Shiny bindings for violin
#'
#' Output and render functions for using [violin()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [violin()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `violinOutput()` returns a Shiny output UI element; `renderViolin()`
#'   returns a Shiny render function.
#' @name violin-shiny
#' @export
violinOutput <- function(output_id, width = "100%", height = "560px") {
  htmlwidgets::shinyWidgetOutput(output_id, "violin", width, height,
    package = "plotomics"
  )
}

#' @rdname violin-shiny
#' @export
renderViolin <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, violinOutput, env, quoted = TRUE)
}
