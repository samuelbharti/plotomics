#' Gene / pathway treemap
#'
#' A hierarchical treemap of gene-set / pathway composition. The hierarchy is
#' built from a flat edge list with [d3-hierarchy](https://github.com/d3/d3-hierarchy)
#' (`stratify` + `treemap`) and tiles are rendered on a canvas so thousands of
#' leaves stay interactive; tile labels and a drill-down breadcrumb are drawn as
#' a crisp vector overlay. Click a tile to zoom into that node and the
#' breadcrumb to zoom back out.
#'
#' @param data A data frame describing a tree as an edge list. Required columns:
#'   `id` (unique node id) and `parent` (id of the parent; the root's parent is
#'   `NA` or `""`). A numeric `value` column supplies leaf weights (internal
#'   nodes are summed automatically); an optional `label` column supplies
#'   display names.
#' @param tile Tiling algorithm: `"squarify"` (golden-ratio rectangles) or
#'   `"binary"` (balanced binary partition).
#' @param padding_inner Padding between sibling tiles, in pixels.
#' @param color_by Color leaves by `"parent"` (top-level ancestor, categorical)
#'   or by `"value"` (a sequential/diverging ramp).
#' @param colormap Ramp used when `color_by = "value"`: `"viridis"` or `"rdbu"`.
#' @param label_min_size Minimum tile side (px) before a label is drawn.
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' df <- data.frame(
#'   id = c("root", "P1", "P2", "g1", "g2", "g3"),
#'   parent = c(NA, "root", "root", "P1", "P1", "P2"),
#'   value = c(0, 0, 0, 3, 5, 2),
#'   label = c("All", "Pathway 1", "Pathway 2", "Gene 1", "Gene 2", "Gene 3")
#' )
#' treemap(df)
#' @export
treemap <- function(data,
                    tile = c("squarify", "binary"),
                    padding_inner = 1,
                    color_by = c("parent", "value"),
                    colormap = c("viridis", "rdbu"),
                    label_min_size = 32,
                    theme = NULL,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  if (!all(c("id", "parent") %in% names(data))) {
    stop("`data` must contain columns `id` and `parent`.", call. = FALSE)
  }
  tile <- match.arg(tile)
  color_by <- match.arg(color_by)
  colormap <- match.arg(colormap)
  bv_require_nonempty(nrow(data), "data")

  id <- as.character(data$id)
  # `parent` NAs mark the root; send them as empty strings so JSON encodes a
  # plain string column (jsonlite would otherwise emit nulls).
  parent <- as.character(data$parent)
  parent[is.na(parent)] <- ""

  # Structural integrity: exactly one root, unique ids, resolvable parents.
  dup <- unique(id[duplicated(id)])
  if (length(dup) > 0L) {
    stop(sprintf("duplicate node id(s): %s", paste(dup, collapse = ", ")),
      call. = FALSE
    )
  }
  if (sum(parent == "") != 1L) {
    stop("treemap requires exactly one root", call. = FALSE)
  }
  nonroot <- parent[parent != ""]
  missing_parents <- unique(nonroot[!(nonroot %in% id)])
  if (length(missing_parents) > 0L) {
    stop(sprintf(
      "parent(s) not found among ids: %s",
      paste(missing_parents, collapse = ", ")
    ), call. = FALSE)
  }

  columns <- list(
    id = id,
    parent = parent
  )
  if (!is.null(data$value)) {
    value <- bv_require_numeric(data$value, "value")
    bv_check_finite(value, "value")
    columns$value <- value
  } else {
    columns$value <- rep(0, nrow(data))
  }

  meta <- list()
  if (!is.null(data$label)) {
    meta$labels <- as.character(data$label)
  }

  options <- list(
    tile = tile,
    paddingInner = padding_inner,
    colorBy = color_by,
    colormap = colormap,
    labelMinSize = label_min_size
  )
  if (!is.null(theme)) options$theme <- theme

  bioviz_widget(
    "treemap", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for treemap
#'
#' Output and render functions for using [treemap()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [treemap()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `treemapOutput()` returns a Shiny output UI element;
#'   `renderTreemap()` returns a Shiny render function.
#' @name treemap-shiny
#' @export
treemapOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "treemap", width, height,
    package = "bioviz"
  )
}

#' @rdname treemap-shiny
#' @export
renderTreemap <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, treemapOutput, env, quoted = TRUE)
}
