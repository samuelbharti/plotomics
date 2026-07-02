#' Network graph
#'
#' A GPU-accelerated node-link diagram for large gene/protein interaction
#' networks. Nodes and edges are rendered with WebGL (via sigma v3 over a
#' graphology graph) so tens of thousands of elements stay interactive. When
#' node coordinates are not supplied, a bounded ForceAtlas2 layout positions the
#' nodes in the browser; otherwise the supplied `x`/`y` are used. Categorical
#' node groups are colored from a colorblind-safe palette. Hovering a node
#' highlights it and its neighbors; zoom and pan use sigma's camera.
#'
#' @param nodes A data frame of nodes. Must contain an `id` column (coerced to
#'   character). Optional columns: `x`, `y` (precomputed coordinates), `size`
#'   (node radius in px), `group` (categorical, mapped to a palette color) and
#'   `label` (display name; defaults to `id`).
#' @param edges A data frame of edges with columns `source` and `target` holding
#'   node ids, and an optional numeric `weight` column.
#' @param layout Either `"forceatlas2"` (run a layout when coordinates are
#'   missing) or `"precomputed"` (require and use `x`/`y` from `nodes`).
#' @param iterations Number of ForceAtlas2 iterations (bounded internally).
#' @param default_node_color Fallback node color for nodes without a `group`.
#' @param default_edge_color Edge color.
#' @param label_threshold Minimum node size (px) for its label to render.
#' @param default_node_size Node radius (px) used when `size` is absent.
#' @param palette Optional character vector of hex colors overriding the default
#'   categorical palette used for node groups.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' nodes <- data.frame(
#'   id = paste0("N", 1:60),
#'   group = sample(c("A", "B", "C"), 60, replace = TRUE)
#' )
#' edges <- data.frame(
#'   source = paste0("N", sample(1:60, 120, replace = TRUE)),
#'   target = paste0("N", sample(1:60, 120, replace = TRUE))
#' )
#' network(nodes, edges)
#' @export
network <- function(nodes,
                    edges,
                    layout = c("forceatlas2", "precomputed"),
                    iterations = 200,
                    default_node_color = "#7c8598",
                    default_edge_color = "#d6dae1",
                    label_threshold = 8,
                    default_node_size = 4,
                    palette = NULL,
                    width = NULL,
                    height = NULL,
                    element_id = NULL) {
  if (!is.data.frame(nodes)) {
    stop("`nodes` must be a data frame.", call. = FALSE)
  }
  if (!is.data.frame(edges)) {
    stop("`edges` must be a data frame.", call. = FALSE)
  }
  if (!"id" %in% names(nodes)) {
    stop("`nodes` must contain an `id` column.", call. = FALSE)
  }
  if (!all(c("source", "target") %in% names(edges))) {
    stop("`edges` must contain `source` and `target` columns.", call. = FALSE)
  }
  layout <- match.arg(layout)

  columns <- list(
    id = as.character(nodes$id),
    source = as.character(edges$source),
    target = as.character(edges$target)
  )
  if (!is.null(nodes$x) && !is.null(nodes$y)) {
    columns$x <- as.numeric(nodes$x)
    columns$y <- as.numeric(nodes$y)
  }
  if (!is.null(nodes$size)) {
    columns$size <- as.numeric(nodes$size)
  }
  if (!is.null(edges$weight)) {
    columns$weight <- as.numeric(edges$weight)
  }

  meta <- list()
  if (!is.null(nodes$label)) {
    meta$nodeLabels <- as.character(nodes$label)
  }
  if (!is.null(nodes$group)) {
    meta$nodeGroup <- as.character(nodes$group)
  }

  options <- list(
    layout = layout,
    iterations = iterations,
    defaultNodeColor = default_node_color,
    defaultEdgeColor = default_edge_color,
    labelThreshold = label_threshold,
    defaultNodeSize = default_node_size
  )
  if (!is.null(palette)) {
    options$palette <- as.character(palette)
  }

  bioviz_widget(
    "network", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for network
#'
#' Output and render functions for using [network()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [network()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `networkOutput()` returns a Shiny output UI element;
#'   `renderNetwork()` returns a Shiny render function.
#' @name network-shiny
#' @export
networkOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "network", width, height,
    package = "bioviz"
  )
}

#' @rdname network-shiny
#' @export
renderNetwork <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, networkOutput, env, quoted = TRUE)
}
