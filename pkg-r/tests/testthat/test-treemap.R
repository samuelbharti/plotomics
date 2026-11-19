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
  # No value column: the browser weighs every leaf as 1.
  expect_null(w$x$data$columns$value)
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

test_that("treemap() rejects duplicate node ids", {
  df <- data.frame(id = c("a", "a"), parent = c(NA, "a"))
  expect_error(treemap(df), "duplicate node id\\(s\\): a")
})

test_that("treemap() requires exactly one root", {
  two_roots <- data.frame(id = c("a", "b"), parent = c(NA, NA))
  expect_error(treemap(two_roots), "treemap requires exactly one root")
  no_root <- data.frame(id = c("a", "b"), parent = c("b", "a"))
  expect_error(treemap(no_root), "treemap requires exactly one root")
})

test_that("treemap() rejects a parent not found among ids", {
  df <- data.frame(id = c("root", "g1"), parent = c(NA, "nope"))
  expect_error(treemap(df), "parent\\(s\\) not found among ids: nope")
})

test_that("treemap() rejects a factor value column", {
  df <- data.frame(
    id = c("root", "g1"), parent = c(NA, "root"),
    value = factor(c("0", "3"))
  )
  expect_error(treemap(df), "`value` must be numeric")
})

test_that("treemap() rejects empty input", {
  df <- data.frame(id = character(0), parent = character(0))
  expect_error(treemap(df), "`data` has no rows/cells")
})

test_that("treemap() forwards a theme override", {
  df <- data.frame(id = c("a", "b"), parent = c(NA, "a"))
  w <- treemap(df, theme = list(background = "#222"))
  expect_equal(w$x$options$theme$background, "#222")
  expect_null(treemap(df)$x$options$theme)
})

test_that("treemap() rejects a cycle disjoint from the root", {
  # One valid root, but a and b point at each other: passes the one-root and
  # orphan checks yet crashes d3.stratify in the browser.
  df <- data.frame(id = c("root", "a", "b"), parent = c(NA, "b", "a"))
  expect_error(treemap(df), "cycle")
})

test_that("treemap() treats a literal \"NA\" parent as the root", {
  # Matches the JS/Python contract: both "" and "NA" mark the root.
  df <- data.frame(
    id = c("root", "g1"), parent = c("NA", "root"),
    stringsAsFactors = FALSE
  )
  w <- treemap(df)
  expect_equal(w$x$data$columns$parent[1], "")
})

test_that("treemap() accepts every colormap the browser draws", {
  df <- data.frame(id = c("r", "a", "b"), parent = c(NA, "r", "r"),
                   value = c(0, 1, 2))
  for (cm in c("viridis", "rdbu", "ltc", "ltcdiv")) {
    w <- treemap(df, color_by = "value", colormap = cm)
    expect_equal(w$x$options$colormap, cm)
  }
  expect_error(treemap(df, colormap = "plasma"), "should be one of")
})

test_that("treemap() checks the parent chains of 20,000 rows in under a second", {
  # One root, 100 groups and 20,300 leaves. The check was quadratic in the
  # number of rows and took 3.7 s here.
  n_leaf <- 20300L
  df <- data.frame(
    id = c("root", paste0("g", 1:100), paste0("leaf", seq_len(n_leaf))),
    parent = c(NA, rep("root", 100), paste0("g", rep_len(1:100, n_leaf))),
    value = 1
  )
  elapsed <- system.time(w <- treemap(df))[["elapsed"]]
  expect_s3_class(w, "htmlwidget")
  expect_lt(elapsed, 1)

  # A long chain is walked once too, and a cycle off it is still found.
  chain <- data.frame(
    id = paste0("n", 1:20000),
    parent = c(NA, paste0("n", 1:19999))
  )
  expect_lt(system.time(treemap(chain))[["elapsed"]], 1)
  chain$parent[20000] <- "n20000"
  expect_error(treemap(chain), "cycle in the parent chain (at 'n20000')",
               fixed = TRUE)
})
