#' Network graph
#'
#' A GPU-accelerated node-link diagram for large gene/protein interaction
#' networks. Nodes and edges are rendered with WebGL (via sigma v3 over a
#' graphology graph) so tens of thousands of elements stay interactive. When
#' node coordinates are not supplied, a bounded ForceAtlas2 layout positions the
#' nodes in the browser; otherwise the supplied `x`/`y` are used. Categorical
#' node groups take the theme's palette: Okabe-Ito (colour-blind safe) for up
#' to 8 groups, and a 20-colour palette past 8. Hovering a node
#' highlights it and its neighbors; zoom and pan use sigma's camera. When the
#' nodes have groups, a legend of the groups sits in a gutter on the right. In
#' a Shiny app, clicking a node sets `input$<id>_selected` to the clicked node
#' id, and clicking the empty canvas clears it.
#'
#' @param nodes A data frame of nodes. Must contain an `id` column (coerced to
#'   character). Optional columns: `x`, `y` (precomputed coordinates), `size`
#'   (node radius in px), `group` (categorical, mapped to a palette color) and
#'   `label` (display name; defaults to `id`). A **factor** `group` fixes the
#'   order of the legend and the colours to its levels, and keeps unused
#'   levels in the legend, the way `drop = FALSE` does in ggplot2; other
#'   groups go in the order the nodes have them.
#' @param edges A data frame of edges with columns `source` and `target` holding
#'   node ids, an optional numeric `weight` column, and an optional `color`
#'   column giving a per-edge color (else `default_edge_color`). Edge width
#'   follows the absolute weight, scaled over the weights in the graph to 1.7-6
#'   px, and the layout pulls nodes together by the absolute weight, so a
#'   negative weight (as in a correlation network) counts by its size.
#' @param layout Either `"forceatlas2"` (run a layout when coordinates are
#'   missing) or `"precomputed"` (require and use `x`/`y` from `nodes`).
#' @param iterations Number of ForceAtlas2 iterations (bounded internally).
#' @param default_node_color Fallback node color for nodes without a `group`.
#' @param default_edge_color Colour of an edge with no colour of its own.
#'   `NULL` (the default) takes the theme background with a fifth of the
#'   theme foreground mixed in, so edges stay quieter than the nodes and the
#'   labels on a light and on a dark background.
#' @param label_threshold Minimum node size (px) on screen for its label to
#'   render. At the default of 4, nodes of the default size are labelled at
#'   the starting zoom, and the renderer's label grid keeps the labels from
#'   crowding. Where the letters of two labels would run into each other,
#'   the label of the smaller node is left out.
#' @param default_node_size Node radius (px) used when `size` is absent.
#' @param directed Draw the graph as directed, with arrowheads. When `TRUE`,
#'   `A -> B` and `B -> A` are kept as distinct edges; when `FALSE` (the default)
#'   the graph is undirected and a reciprocal pair collapses to one line.
#' @param palette Optional character vector of hex colors overriding the default
#'   categorical palette used for node groups.
#' @param show_legend Draw a legend of the node groups, in a gutter on the
#'   right, when `nodes` has a `group` column.
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#'   Its `padding` entry is the space in px between the edge of the widget
#'   and the plot: one number for every side, or numbers named `top`,
#'   `right`, `bottom` and `left` in a list or vector, a side left out
#'   keeping the default of 10.
#'   Its `categorical` entry is an ordered palette: the colours go to the node
#'   groups in order, and names on the colours are not matched to them.
#'   A colour given as a CSS custom property, such as
#'   `background = "var(--bg)"`, takes the value the page gives it when the
#'   plot draws. After the page changes the property, what the plot drew on
#'   a canvas keeps the old colour until it draws again: resize the widget
#'   or render it again.
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
                    default_edge_color = NULL,
                    label_threshold = 4,
                    default_node_size = 4,
                    directed = FALSE,
                    palette = NULL,
                    show_legend = TRUE,
                    theme = NULL,
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
  bv_require_nonempty(nrow(nodes), "nodes")

  id <- as.character(nodes$id)
  source <- as.character(edges$source)
  target <- as.character(edges$target)

  # Structural integrity: unique node ids and edges that reference real nodes.
  dup <- unique(id[duplicated(id)])
  if (length(dup) > 0L) {
    stop(sprintf("duplicate node id(s): %s", paste(dup, collapse = ", ")),
      call. = FALSE
    )
  }
  dangling <- unique(c(source[!(source %in% id)], target[!(target %in% id)]))
  if (length(dangling) > 0L) {
    stop(sprintf(
      "edge endpoint(s) not found among node ids: %s",
      paste(dangling, collapse = ", ")
    ), call. = FALSE)
  }
  if (layout == "precomputed" && (is.null(nodes$x) || is.null(nodes$y))) {
    stop(
      "network layout \"precomputed\" requires `x` and `y` columns in `nodes`.",
      call. = FALSE
    )
  }

  columns <- list(
    id = id,
    source = source,
    target = target
  )
  if (!is.null(nodes$x) && !is.null(nodes$y)) {
    x <- bv_require_numeric(nodes$x, "x")
    bv_check_finite(x, "x")
    y <- bv_require_numeric(nodes$y, "y")
    bv_check_finite(y, "y")
    columns$x <- x
    columns$y <- y
  }
  if (!is.null(nodes$size)) {
    size <- bv_require_numeric(nodes$size, "size")
    bv_check_finite(size, "size")
    columns$size <- size
  }
  if (!is.null(edges$weight)) {
    weight <- bv_require_numeric(edges$weight, "weight")
    bv_check_finite(weight, "weight")
    columns$weight <- weight
  }
  if (!is.null(edges$color)) {
    columns$color <- bv_colour(as.character(edges$color))
  }

  meta <- list()
  if (!is.null(nodes$label)) {
    meta$nodeLabels <- as.character(nodes$label)
  }
  if (!is.null(nodes$group)) {
    meta$nodeGroup <- as.character(nodes$group)
    # A factor is someone stating the order they want. Send the levels along
    # so the browser orders the legend and the colours by them, not by the
    # group the first node happens to have.
    if (is.factor(nodes$group)) meta$nodeGroupLevels <- levels(nodes$group)
  }

  options <- list(
    layout = layout,
    iterations = iterations,
    defaultNodeColor = bv_colour(default_node_color),
    labelThreshold = label_threshold,
    defaultNodeSize = default_node_size,
    directed = directed,
    showLegend = show_legend
  )
  if (!is.null(default_edge_color)) {
    options$defaultEdgeColor <- as.character(default_edge_color)[1]
  }
  if (!is.null(palette)) {
    options$palette <- bv_colour(as.character(palette))
  }
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "network", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id,
    array_meta = c("nodeLabels", "nodeGroup", "nodeGroupLevels"),
    array_options = "palette"
  )
}

#' Shiny bindings for network
#'
#' Output and render functions for using [network()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' In a Shiny app, clicking a node pushes its **id** (a character scalar, not a
#' row index) to `input$<output_id>_selected`, so `networkOutput("graph")`
#' populates `input$graph_selected`. It is `NULL` until the first click.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [network()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `networkOutput()` returns a Shiny output UI element;
#'   `renderNetwork()` returns a Shiny render function.
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(networkOutput("net"))
#'   server <- function(input, output) {
#'     output$net <- renderNetwork({
#'       network(
#'         nodes = data.frame(id = c("A", "B", "C")),
#'         edges = data.frame(source = c("A", "B"), target = c("B", "C"))
#'       )
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
#' @name network-shiny
#' @export
networkOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "network", width, height,
    package = "plotomics"
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
