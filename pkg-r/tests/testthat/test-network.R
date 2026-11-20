test_that("network() builds an htmlwidget with the expected payload", {
  nodes <- data.frame(
    id = c("a", "b", "c"),
    x = c(0, 1, 2),
    y = c(0, 1, 0),
    size = c(4, 8, 6),
    group = c("G1", "G1", "G2"),
    label = c("Alpha", "Beta", "Gamma"),
    stringsAsFactors = FALSE
  )
  edges <- data.frame(
    source = c("a", "b"),
    target = c("b", "c"),
    weight = c(1.5, 2),
    stringsAsFactors = FALSE
  )
  w <- network(nodes, edges,
    layout = "precomputed", iterations = 100, label_threshold = 5
  )

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$id, c("a", "b", "c"))
  expect_equal(w$x$data$columns$source, c("a", "b"))
  expect_equal(w$x$data$columns$target, c("b", "c"))
  expect_equal(w$x$data$columns$x, c(0, 1, 2))
  expect_equal(w$x$data$columns$size, c(4, 8, 6))
  expect_equal(w$x$data$columns$weight, c(1.5, 2))
  expect_equal(w$x$data$meta$nodeGroup, c("G1", "G1", "G2"))
  expect_equal(w$x$data$meta$nodeLabels, c("Alpha", "Beta", "Gamma"))
  expect_equal(w$x$options$layout, "precomputed")
  expect_equal(w$x$options$iterations, 100)
  expect_equal(w$x$options$labelThreshold, 5)
})

test_that("network() omits optional columns when absent", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(
    source = "a", target = "b", stringsAsFactors = FALSE
  )
  w <- network(nodes, edges)

  expect_null(w$x$data$columns$x)
  expect_null(w$x$data$columns$size)
  expect_null(w$x$data$columns$weight)
  expect_null(w$x$data$meta$nodeGroup)
  expect_null(w$x$data$meta$nodeLabels)
  expect_equal(w$x$options$layout, "forceatlas2")
})

test_that("network() forwards a palette override", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  w <- network(nodes, edges, palette = c("#111111", "#222222"))
  expect_equal(w$x$options$palette, c("#111111", "#222222"))
})

test_that("network() validates its input", {
  nodes <- data.frame(id = "a", stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "a", stringsAsFactors = FALSE)

  expect_error(network(list(id = "a"), edges), "must be a data frame")
  expect_error(network(nodes, list(source = "a")), "must be a data frame")
  expect_error(
    network(data.frame(foo = 1), edges), "must contain an `id`"
  )
  expect_error(
    network(nodes, data.frame(a = 1, b = 2)), "must contain `source` and `target`"
  )
})

test_that("network() rejects duplicate node ids", {
  nodes <- data.frame(id = c("a", "a"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "a", stringsAsFactors = FALSE)
  expect_error(network(nodes, edges), "duplicate node id\\(s\\): a")
})

test_that("network() rejects an edge referencing a missing node", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "z", stringsAsFactors = FALSE)
  expect_error(
    network(nodes, edges),
    "edge endpoint\\(s\\) not found among node ids: z"
  )
})

test_that("network() requires x/y when layout is precomputed", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  expect_error(
    network(nodes, edges, layout = "precomputed"),
    "requires `x` and `y`"
  )
})

test_that("network() rejects a factor coordinate column", {
  nodes <- data.frame(
    id = c("a", "b"), x = factor(c("0", "1")), y = c(0, 1),
    stringsAsFactors = FALSE
  )
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  expect_error(network(nodes, edges), "`x` must be numeric")
})

test_that("network() rejects empty nodes", {
  nodes <- data.frame(id = character(0), stringsAsFactors = FALSE)
  edges <- data.frame(
    source = character(0), target = character(0), stringsAsFactors = FALSE
  )
  expect_error(network(nodes, edges), "`nodes` has no rows/cells")
})

test_that("network() forwards a theme override", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  w <- network(nodes, edges, theme = list(background = "#333"))
  expect_equal(w$x$options$theme$background, "#333")
  expect_null(network(nodes, edges)$x$options$theme)
})

test_that("network() forwards the directed option (default FALSE)", {
  nodes <- data.frame(id = c("a", "b"), stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  expect_false(network(nodes, edges)$x$options$directed)
  expect_true(network(nodes, edges, directed = TRUE)$x$options$directed)
})

test_that("network() passes a per-edge color column when present", {
  nodes <- data.frame(id = c("a", "b", "c"), stringsAsFactors = FALSE)
  edges <- data.frame(
    source = c("a", "b"), target = c("b", "c"),
    color = c("#ff0000", "#00ff00"), stringsAsFactors = FALSE
  )
  w <- network(nodes, edges)
  expect_equal(w$x$data$columns$color, c("#ff0000", "#00ff00"))

  edges_plain <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  expect_null(network(nodes, edges_plain)$x$data$columns$color)
})

test_that("network() labels default-size nodes and draws a group legend", {
  nodes <- data.frame(id = c("a", "b"), group = c("G1", "G2"),
                      stringsAsFactors = FALSE)
  edges <- data.frame(source = "a", target = "b", stringsAsFactors = FALSE)
  w <- network(nodes, edges)
  # A node of the default size 4 reaches the label threshold.
  expect_equal(w$x$options$labelThreshold, 4)
  expect_equal(w$x$options$defaultNodeSize, 4)
  expect_true(w$x$options$showLegend)
  expect_false(network(nodes, edges, show_legend = FALSE)$x$options$showLegend)
})

test_that("network() sends the levels of a factor group, in order", {
  nodes <- data.frame(id = c("a", "b", "c"))
  nodes$group <- factor(c("Low", "High", "Low"),
    levels = c("High", "Mid", "Low")
  )
  edges <- data.frame(source = "a", target = "b")
  w <- network(nodes, edges)
  # Before the fix only the text went, and the browser took the groups in
  # the order the nodes have them, which left "Mid" out.
  expect_equal(w$x$data$meta$nodeGroup, c("Low", "High", "Low"))
  expect_equal(w$x$data$meta$nodeGroupLevels, c("High", "Mid", "Low"))
  # Text groups state no order.
  nodes$group <- as.character(nodes$group)
  expect_null(network(nodes, edges)$x$data$meta$nodeGroupLevels)
  # One level still goes as an array.
  nodes$group <- factor("Only", levels = "Only")[c(1, 1, 1)]
  json <- jsonlite::toJSON(
    network(nodes, edges)$preRenderHook(network(nodes, edges))$x,
    auto_unbox = TRUE
  )
  expect_match(json, '"nodeGroupLevels":["Only"]', fixed = TRUE)
})

test_that("network() leaves the edge colour to the theme by default", {
  nodes <- data.frame(id = c("a", "b"))
  edges <- data.frame(source = "a", target = "b")
  # Before the fix every edge was #d6dae1, light in the dark theme too.
  expect_null(network(nodes, edges)$x$options$defaultEdgeColor)
  w <- network(nodes, edges, default_edge_color = "#d62728")
  expect_equal(w$x$options$defaultEdgeColor, "#d62728")
})

test_that("network() sends a missing edge colour as null", {
  nodes <- data.frame(id = c("a", "b", "c"))
  edges <- data.frame(
    source = c("a", "b"), target = c("b", "c"), color = c("#d62728", NA)
  )
  w <- network(nodes, edges)
  # null, not the text "NA", with the NA setting htmlwidgets writes it
  # with: the browser gives the edge the default colour.
  json <- jsonlite::toJSON(
    w$preRenderHook(w)$x,
    na = "null", auto_unbox = TRUE
  )
  expect_match(json, '"color":["#d62728",null]', fixed = TRUE)
})

test_that("network() sends an R colour name for the edges as hex", {
  nodes <- data.frame(id = c("a", "b"))
  edges <- data.frame(source = "a", target = "b")
  # Before the fix "grey85" went as it was, which the browser cannot read.
  w <- network(nodes, edges, default_edge_color = "grey85")
  expect_equal(w$x$options$defaultEdgeColor, "#D9D9D9")
  w <- network(nodes, edges, default_edge_color = "#d62728")
  expect_equal(w$x$options$defaultEdgeColor, "#d62728")
})
