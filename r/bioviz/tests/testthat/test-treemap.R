test_that("treemap() builds an htmlwidget with the expected payload", {
  df <- data.frame(
    id = c("root", "P1", "P2", "g1", "g2", "g3"),
    parent = c(NA, "root", "root", "P1", "P1", "P2"),
    value = c(0, 0, 0, 3, 5, 2),
    label = c("All", "Pathway 1", "Pathway 2", "Gene 1", "Gene 2", "Gene 3")
  )
  w <- treemap(df,
    tile = "binary", padding_inner = 2,
    color_by = "value", colormap = "rdbu", label_min_size = 40
  )

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$id, df$id)
  # NA parent (root) is encoded as an empty string.
  expect_equal(w$x$data$columns$parent[1], "")
  expect_equal(w$x$data$columns$parent[4], "P1")
  expect_equal(w$x$data$columns$value, df$value)
  expect_equal(w$x$data$meta$labels, df$label)
  expect_equal(w$x$options$tile, "binary")
  expect_equal(w$x$options$paddingInner, 2)
  expect_equal(w$x$options$colorBy, "value")
  expect_equal(w$x$options$colormap, "rdbu")
  expect_equal(w$x$options$labelMinSize, 40)
})

test_that("treemap() defaults value/label sensibly when absent", {
  w <- treemap(data.frame(id = c("a", "b"), parent = c(NA, "a")))
  expect_equal(w$x$data$columns$value, c(0, 0))
  expect_null(w$x$data$meta$labels)
  expect_equal(w$x$options$tile, "squarify")
  expect_equal(w$x$options$colorBy, "parent")
})

test_that("treemap() validates its input", {
  expect_error(treemap(list(id = 1, parent = 2)), "must be a data frame")
  expect_error(treemap(data.frame(a = 1, b = 2)), "must contain columns")
})

test_that("treemap() rejects unknown option values", {
  df <- data.frame(id = "a", parent = NA)
  expect_error(treemap(df, tile = "spiral"))
  expect_error(treemap(df, colormap = "jet"))
})
