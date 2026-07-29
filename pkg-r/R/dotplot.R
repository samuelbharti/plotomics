#' Marker gene dot plot
#'
#' Features down the rows, groups across the columns, each cell a dot whose
#' size is the fraction of the group expressing the gene and whose colour is
#' the expression level. Two channels because colour alone cannot separate
#' "high in a few cells" from "moderate in all of them", and that distinction
#' is usually what decides whether a gene is a marker.
#'
#' Dot area, not radius, is proportional to the percentage. Scaling radius
#' linearly would quadruple the ink for a doubled percentage, which is the
#' classic way a dot plot overstates its strongest cells.
#'
#' Rows and columns are drawn in the order given. Sorting genes by the group
#' they best mark is an analysis decision, so the component does not do it.
#'
#' @param data A data frame in long form, one row per dot, with `gene` and
#'   `cluster` key columns, a `pct` column (percent expressing, 0-100) driving
#'   dot size, and a `value` column (expression level) driving dot colour.
#' @param genes Character vector fixing the row order. A factor `gene` column
#'   supplies it from its levels. Defaults to order of appearance.
#' @param clusters Character vector fixing the column order, likewise.
#' @param value_label,size_label Legend titles.
#' @param colormap Sequential ramp for the colour channel: `"viridis"`,
#'   `"rdbu"`, `"ltc"` (an earthy teal to sand to rust sequential ramp) or
#'   `"ltcdiv"` (its diverging counterpart, neutral cream at the midpoint).
#' @param max_radius Radius in pixels of a dot at 100 percent.
#' @param value_domain Length-2 numeric fixing the colour scale. `NULL` uses the
#'   data range. Set it when comparing two dot plots side by side.
#' @param show_grid,show_legend Toggle the gridlines and the legends.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' df <- expand.grid(gene = c("CD3D", "MS4A1"), cluster = c("T", "B"),
#'                   stringsAsFactors = FALSE)
#' df$pct <- c(88, 4, 6, 91)
#' df$value <- c(2.4, 0.1, 0.2, 2.7)
#' dotplot(df)
#' @export
dotplot <- function(data,
                    genes = NULL,
                    clusters = NULL,
                    value_label = "mean expression",
                    size_label = "% expressing",
                    colormap = c("viridis", "rdbu", "ltc", "ltcdiv"),
                    max_radius = 9,
                    value_domain = NULL,
                    show_grid = TRUE,
                    show_legend = TRUE,
                    theme = NULL,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame.", call. = FALSE)
  }
  missing_cols <- setdiff(c("gene", "cluster", "pct", "value"), names(data))
  if (length(missing_cols) > 0L) {
    stop(sprintf("`data` is missing column(s): %s",
                 paste(missing_cols, collapse = ", ")), call. = FALSE)
  }
  colormap <- match.arg(colormap)
  bv_require_nonempty(nrow(data), "data")

  pct <- bv_require_numeric(data$pct, "pct")
  bv_check_finite(pct, "pct")
  if (any(pct < 0 | pct > 100)) {
    stop("`pct` must be a percentage in [0, 100].", call. = FALSE)
  }
  value <- bv_require_numeric(data$value, "value")
  bv_check_finite(value, "value")

  columns <- list(
    gene = as.character(data$gene),
    cluster = as.character(data$cluster),
    pct = pct,
    value = value
  )

  # A factor is the caller stating the order they want, which for a dot plot is
  # the whole point: the diagonal only appears under a deliberate ordering.
  if (is.null(genes) && is.factor(data$gene)) genes <- levels(data$gene)
  if (is.null(clusters) && is.factor(data$cluster)) clusters <- levels(data$cluster)

  meta <- list(valueLabel = value_label, sizeLabel = size_label)
  if (!is.null(genes)) {
    genes <- as.character(genes)
    unknown <- setdiff(unique(columns$gene), genes)
    if (length(unknown) > 0L) {
      stop(sprintf("gene(s) not present in `genes`: %s",
                   paste(utils::head(unknown, 5), collapse = ", ")), call. = FALSE)
    }
    meta$genes <- I(genes)
  }
  if (!is.null(clusters)) {
    clusters <- as.character(clusters)
    unknown <- setdiff(unique(columns$cluster), clusters)
    if (length(unknown) > 0L) {
      stop(sprintf("cluster(s) not present in `clusters`: %s",
                   paste(utils::head(unknown, 5), collapse = ", ")), call. = FALSE)
    }
    meta$clusters <- I(clusters)
  }

  options <- list(
    colormap = colormap,
    maxRadius = max_radius,
    showGrid = show_grid,
    showLegend = show_legend
  )
  if (!is.null(value_domain)) {
    if (length(value_domain) != 2L) {
      stop("`value_domain` must be length 2.", call. = FALSE)
    }
    options$valueDomain <- I(as.numeric(value_domain))
  }
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "dotplot", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for dotplot
#'
#' Output and render functions for using [dotplot()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [dotplot()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `dotplotOutput()` returns a Shiny output UI element;
#'   `renderDotplot()` returns a Shiny render function.
#' @name dotplot-shiny
#' @export
dotplotOutput <- function(output_id, width = "100%", height = "560px") {
  htmlwidgets::shinyWidgetOutput(output_id, "dotplot", width, height,
    package = "plotomics"
  )
}

#' @rdname dotplot-shiny
#' @export
renderDotplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, dotplotOutput, env, quoted = TRUE)
}
