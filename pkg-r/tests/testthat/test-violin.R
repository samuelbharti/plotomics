make_args <- function() {
  set.seed(1)
  violin_density(list(`CD3D|T` = rnorm(40, 2), `CD3D|B` = rnorm(40, 0),
                      `MS4A1|T` = rnorm(40, 0), `MS4A1|B` = rnorm(40, 2)))
}

test_that("violin() builds an htmlwidget with the expected payload", {
  a <- make_args()
  w <- violin(a$data, grid = a$grid, density = a$density, median = a$median)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$feature, c("CD3D", "CD3D", "MS4A1", "MS4A1"))
  expect_equal(w$x$data$columns$group, c("T", "B", "T", "B"))
  expect_equal(length(as.numeric(w$x$data$meta$grid)), 64L)
  # Row-major: the component indexes density as violin * gridLen + k.
  expect_equal(length(as.numeric(w$x$data$meta$density)), 4L * 64L)
  expect_equal(as.numeric(w$x$data$meta$density)[1:64], unname(a$density[1, ]))
  expect_true(w$x$options$showMedian)
})

test_that("violin() takes row and column order from factor levels", {
  a <- make_args()
  a$data$feature <- factor(a$data$feature, levels = c("MS4A1", "CD3D"))
  a$data$group <- factor(a$data$group, levels = c("B", "T"))
  w <- violin(a$data, grid = a$grid, density = a$density)
  expect_equal(as.character(w$x$data$meta$features), c("MS4A1", "CD3D"))
  expect_equal(as.character(w$x$data$meta$groups), c("B", "T"))
})

test_that("violin() validates its input", {
  a <- make_args()
  expect_error(violin(list(), a$grid, a$density), "must be a data frame")
  expect_error(violin(data.frame(feature = "a"), a$grid, a$density),
               "missing column")
  expect_error(violin(a$data, rev(a$grid), a$density), "must be ascending")
  expect_error(violin(a$data, a$grid, a$density[1:2, ]),
               "one row per violin")
  expect_error(violin(a$data, a$grid[1:10], a$density),
               "one column per `grid` entry")
  expect_error(violin(a$data, a$grid, a$density, median = 1),
               "one entry per violin")
  expect_error(violin(a$data, a$grid, a$density, violin_width = 0),
               "must be in")
  expect_error(violin(a$data, a$grid, a$density, features = "CD3D"),
               "not present in `features`")
})

test_that("violin_density() evaluates every group on one shared grid", {
  set.seed(2)
  x <- rnorm(50)
  y <- rnorm(50, 5)
  d <- violin_density(list(`A|x` = x, `A|y` = y), n = 32L)
  expect_equal(length(d$grid), 32L)
  expect_equal(dim(d$density), c(2L, 32L))
  # The grid must span both groups exactly, or the violins are not comparable.
  expect_equal(d$grid[1], min(c(x, y)))
  expect_equal(d$grid[32], max(c(x, y)))
  expect_false(is.unsorted(d$grid))
  expect_equal(d$data$feature, c("A", "A"))
  expect_equal(d$data$group, c("x", "y"))
  expect_equal(length(d$median), 2L)
})

test_that("violin_density() survives groups too small to estimate", {
  # A cluster with one cell is a real thing to encounter; it should give a flat
  # row rather than bringing the whole figure down.
  d <- violin_density(list(`A|x` = c(1, 2, 3, 4), `A|y` = 2, `A|z` = numeric(0)),
                      n = 16L)
  expect_equal(dim(d$density), c(3L, 16L))
  expect_true(all(d$density[2, ] == 0))
  expect_true(all(d$density[3, ] == 0))
  expect_true(any(d$density[1, ] > 0))
  expect_true(is.na(d$median[3]))
})

test_that("violin_density() validates its input", {
  expect_error(violin_density(list()), "named list")
  expect_error(violin_density(list(1, 2)), "named list")
  expect_error(violin_density(list(`A|x` = c(NA_real_, NaN))), "no finite")
})

test_that("violin_density() handles a constant column without dividing by zero", {
  d <- violin_density(list(`A|x` = rep(3, 10)), n = 8L)
  expect_equal(length(d$grid), 8L)
  expect_false(any(is.na(d$grid)))
  expect_gt(d$grid[8], d$grid[1])
})
