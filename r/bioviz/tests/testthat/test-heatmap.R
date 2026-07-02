test_that("bioheatmap() builds an htmlwidget with a row-major payload", {
  m <- matrix(c(1, 2, 3, 4, 5, 6), nrow = 2, ncol = 3, byrow = TRUE)
  rownames(m) <- c("g1", "g2")
  colnames(m) <- c("s1", "s2", "s3")
  w <- bioheatmap(m, colormap = "rdbu", z_score = TRUE, show_colorbar = FALSE)

  expect_s3_class(w, "htmlwidget")
  # Row-major flatten: row 1 then row 2.
  expect_equal(w$x$data$columns$values, c(1, 2, 3, 4, 5, 6))
  expect_equal(w$x$data$meta$nrows, 2)
  expect_equal(w$x$data$meta$ncols, 3)
  expect_equal(w$x$data$meta$rowLabels, c("g1", "g2"))
  expect_equal(w$x$data$meta$colLabels, c("s1", "s2", "s3"))
  expect_equal(w$x$options$colormap, "rdbu")
  expect_true(w$x$options$zScore)
  expect_false(w$x$options$showColorbar)
})

test_that("bioheatmap() flattens column-major R matrices in row-major order", {
  # Default matrix() fill is column-major; the widget must emit row-major.
  m <- matrix(1:6, nrow = 2, ncol = 3) # columns: (1,2) (3,4) (5,6)
  w <- bioheatmap(m)
  # Row 1 is (1, 3, 5), row 2 is (2, 4, 6).
  expect_equal(w$x$data$columns$values, c(1, 3, 5, 2, 4, 6))
})

test_that("bioheatmap() passes vmin/vmax clamps through", {
  m <- matrix(rnorm(12), nrow = 3, ncol = 4)
  w <- bioheatmap(m, vmin = -2, vmax = 2)
  expect_equal(w$x$options$vmin, -2)
  expect_equal(w$x$options$vmax, 2)

  # Auto-scaling omits the clamps (NULL drops from the list).
  w2 <- bioheatmap(m)
  expect_null(w2$x$options$vmin)
  expect_null(w2$x$options$vmax)
})

test_that("bioheatmap() validates its input", {
  expect_error(bioheatmap(list(1, 2, 3)), "must be a numeric matrix")
  expect_error(bioheatmap(matrix("a", 1, 1)), "must be a numeric matrix")
  expect_error(bioheatmap(matrix(1, 1, 1), colormap = "plasma"))
})

test_that("heatmap_bioviz() is an alias for bioheatmap()", {
  expect_identical(heatmap_bioviz, bioheatmap)
})

test_that("bioheatmap() omits labels when the matrix is unnamed", {
  w <- bioheatmap(matrix(1:4, nrow = 2))
  expect_null(w$x$data$meta$rowLabels)
  expect_null(w$x$data$meta$colLabels)
})
