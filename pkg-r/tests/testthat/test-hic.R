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

test_that("hic() accepts every colormap the browser draws", {
  m <- matrix(1:4, nrow = 2)
  for (cm in c("viridis", "rdbu", "ltc", "ltcdiv")) {
    expect_equal(hic(m, colormap = cm)$x$options$colormap, cm)
  }
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

test_that("hic() checks its numeric arguments", {
  m <- matrix(runif(4), 2, 2)
  number <- "must be a single finite number"
  expect_error(hic(m, vmin = "a"), paste0("`vmin` ", number))
  expect_error(hic(m, vmin = NaN), paste0("`vmin` ", number))
  expect_error(hic(m, vmin = -Inf), paste0("`vmin` ", number))
  expect_error(hic(m, vmax = c(1, 2)), paste0("`vmax` ", number))
  expect_error(hic(m, vmax = NaN), paste0("`vmax` ", number))
  expect_error(hic(m, vmax = Inf), paste0("`vmax` ", number))
  expect_error(hic(m, vmax = factor(3)), paste0("`vmax` ", number))
  expect_error(hic(m, vmax = TRUE), paste0("`vmax` ", number))
  expect_error(hic(m, vmax = -5), "`vmax` must be greater than `vmin`")
  expect_error(
    hic(m, vmin = 2, vmax = 2, transform = "linear"),
    "`vmax` must be greater than `vmin`"
  )
  expect_error(
    hic(m, vmin = -3, vmax = -1),
    "`vmax` must be greater than 0 with the log transform"
  )
  for (p in list(99, -1, 0, NaN, "0.9", c(0.5, 0.9))) {
    expect_error(
      hic(m, vmax_percentile = p),
      "`vmax_percentile` must be in \\(0, 1\\]"
    )
  }
  for (b in list(-5, 0, NaN, "a", c(1, 2))) {
    expect_error(
      hic(m, bin_size = b),
      "`bin_size` must be a single positive number"
    )
  }
  for (s in list("no", NA, 1, c(TRUE, FALSE), NULL)) {
    expect_error(
      hic(m, symmetric = s),
      "`symmetric` must be a single true or false value"
    )
  }
})

test_that("hic() keeps the numeric arguments it is given", {
  m <- matrix(runif(4), 2, 2)
  w <- hic(m,
    bin_size = 5000L, vmin = -2L, vmax = 3, vmax_percentile = 1,
    transform = "linear", symmetric = FALSE
  )
  expect_identical(w$x$data$meta$binSize, 5000)
  expect_identical(w$x$options$vmin, -2)
  expect_identical(w$x$options$vmax, 3)
  expect_identical(w$x$options$vmaxPercentile, 1)
  expect_false(w$x$options$symmetric)
  # Below 0 with the log transform, vmin acts as 0.
  expect_identical(hic(m, vmin = -3, vmax = 1)$x$options$vmax, 1)
})

test_that("hic() reads NA as an unset numeric argument", {
  m <- matrix(runif(4), 2, 2)
  w <- hic(m, bin_size = NA, vmin = NA, vmax = NA_real_, vmax_percentile = NA)
  expect_null(w$x$data$meta$binSize)
  expect_null(w$x$options$vmin)
  expect_null(w$x$options$vmax)
  expect_null(w$x$options$vmaxPercentile)
  expect_null(hic(m, vmin = NULL)$x$options$vmin)
})

test_that("hic() sends a named or 1x1 matrix argument as a plain value", {
  trip <- data.frame(i = 0, j = 1, v = 5)
  w <- hic(trip,
    n = 2, symmetric = c(a = FALSE), bin_size = c(b = 5000),
    vmin = matrix(1), vmax = c(top = 9), vmax_percentile = matrix(0.9)
  )
  expect_identical(w$x$options$symmetric, FALSE)
  expect_identical(
    hic(trip, n = 2, symmetric = matrix(TRUE))$x$options$symmetric, TRUE
  )
  expect_identical(w$x$data$meta$binSize, 5000)
  expect_identical(w$x$options$vmin, 1)
  expect_identical(w$x$options$vmax, 9)
  expect_identical(w$x$options$vmaxPercentile, 0.9)
  json <- as.character(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
  expect_match(json, '"symmetric":false', fixed = TRUE)
  expect_match(json, '"vmax":9', fixed = TRUE)
})
