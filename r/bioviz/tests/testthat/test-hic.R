test_that("hic() builds an htmlwidget from a dense matrix", {
  m <- matrix(c(0, 1, 2, 1, 0, 3, 2, 3, 0), nrow = 3, byrow = TRUE)
  w <- hic(m, bin_size = 10000, chrom = "chr1", transform = "linear")

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$meta$n, 3L)
  expect_equal(w$x$data$meta$binSize, 10000)
  expect_equal(w$x$data$meta$chrom, "chr1")
  # row-major flatten
  expect_equal(w$x$data$columns$values, as.numeric(t(m)))
  expect_equal(w$x$options$transform, "linear")
  expect_equal(w$x$options$colormap, "viridis")
  expect_true(w$x$options$symmetric)
})

test_that("hic() accepts a sparse i/j/v triplet", {
  trip <- data.frame(i = c(0L, 0L, 1L), j = c(0L, 1L, 2L), v = c(5, 7, 9))
  w <- hic(trip, n = 3)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$meta$n, 3L)
  expect_equal(w$x$data$columns$i, c(0L, 0L, 1L))
  expect_equal(w$x$data$columns$j, c(0L, 1L, 2L))
  expect_equal(w$x$data$columns$v, c(5, 7, 9))
  expect_null(w$x$data$columns$values)
})

test_that("hic() infers n from sparse indices when omitted", {
  trip <- list(i = c(0L, 4L), j = c(2L, 1L), v = c(1, 2))
  w <- hic(trip)
  expect_equal(w$x$data$meta$n, 5L) # max index 4 -> n = 5
})

test_that("hic() only sends vmax when fixed", {
  m <- matrix(runif(4), 2, 2)
  auto <- hic(m)
  expect_null(auto$x$options$vmax)
  fixed <- hic(m, vmax = 42)
  expect_equal(fixed$x$options$vmax, 42)
})

test_that("hic() validates its input", {
  expect_error(hic(matrix(1:6, nrow = 2)), "square matrix")
  expect_error(hic(data.frame(a = 1, b = 2)), "i`, `j` and `v`")
  expect_error(hic("nope"), "square matrix or a list")
})

test_that("hic() rejects an unknown colormap", {
  expect_error(hic(matrix(1:4, nrow = 2), colormap = "plasma"))
})

test_that("hic() rejects out-of-range sparse indices", {
  trip <- list(i = c(0L, 5L), j = c(0L, 1L), v = c(1, 2))
  expect_error(hic(trip, n = 3), "indices must be in \\[0, n\\)")
})

test_that("hic() rejects mismatched i/j/v lengths", {
  trip <- list(i = c(0L, 1L), j = c(0L), v = c(1, 2))
  expect_error(hic(trip, n = 3), "must have equal length")
})

test_that("hic() rejects an empty triplet (guards the max() trap)", {
  trip <- list(i = integer(0), j = integer(0), v = numeric(0))
  expect_error(hic(trip, n = 3), "no rows/cells")
})

test_that("hic() rejects a factor sparse column", {
  trip <- list(i = factor(c("0", "1")), j = c(0L, 1L), v = c(1, 2))
  expect_error(hic(trip, n = 3), "`i` must be numeric")
})

test_that("hic() forwards vmax_percentile and theme when set", {
  m <- matrix(runif(4), 2, 2)
  w <- hic(m, vmax_percentile = 0.95, theme = list(background = "#000"))
  expect_equal(w$x$options$vmaxPercentile, 0.95)
  expect_equal(w$x$options$theme$background, "#000")

  auto <- hic(m)
  expect_null(auto$x$options$vmaxPercentile)
  expect_null(auto$x$options$theme)
})
