test_that("clustermap() builds an htmlwidget with the expected payload", {
  mat <- matrix(1:6, nrow = 2, byrow = TRUE)
  rownames(mat) <- c("r1", "r2")
  colnames(mat) <- c("c1", "c2", "c3")
  w <- clustermap(mat,
    metric = "correlation", linkage = "ward",
    colormap = "rdbu", z_score = TRUE, legend_title = "expr"
  )

  expect_s3_class(w, "htmlwidget")
  # Values are flattened row-major: row 1 then row 2.
  expect_equal(w$x$data$columns$values, c(1, 2, 3, 4, 5, 6))
  expect_equal(w$x$data$meta$nrows, 2)
  expect_equal(w$x$data$meta$ncols, 3)
  expect_equal(w$x$data$meta$rowLabels, c("r1", "r2"))
  expect_equal(w$x$data$meta$colLabels, c("c1", "c2", "c3"))

  expect_equal(w$x$options$metric, "correlation")
  expect_equal(w$x$options$linkage, "ward")
  expect_equal(w$x$options$colormap, "rdbu")
  expect_true(w$x$options$zScore)
  expect_equal(w$x$options$legendTitle, "expr")
})

test_that("clustermap() carries precomputed order/linkage through meta", {
  mat <- matrix(rnorm(12), nrow = 3)
  w <- clustermap(mat, row_linkage = c(2L, 0L, 1L))
  expect_equal(w$x$data$meta$rowLinkage, c(2L, 0L, 1L))
  # colLinkage omitted when not supplied
  expect_null(w$x$data$meta$colLinkage)
})

test_that("clustermap() omits labels when the matrix has no dimnames", {
  mat <- matrix(rnorm(6), nrow = 2)
  w <- clustermap(mat)
  expect_null(w$x$data$meta$rowLabels)
  expect_null(w$x$data$meta$colLabels)
})

test_that("clustermap() validates its input", {
  expect_error(clustermap(matrix("a", 2, 2)), "numeric matrix")
})

test_that("clustermap() defaults match the JS/Python option names", {
  w <- clustermap(matrix(rnorm(6), nrow = 2))
  expect_equal(w$x$options$metric, "euclidean")
  expect_equal(w$x$options$linkage, "average")
  expect_equal(w$x$options$colormap, "viridis")
  expect_false(w$x$options$zScore)
  expect_true(w$x$options$clusterRows)
  expect_true(w$x$options$clusterCols)
})
