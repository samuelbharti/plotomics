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

test_that("violin() passes violin_aspect, and NULL or Inf turn the cap off", {
  a <- make_args()
  json <- function(w) {
    as.character(jsonlite::toJSON(w$preRenderHook(w)$x, auto_unbox = TRUE,
                                  null = "null", na = "null"))
  }
  w <- violin(a$data, a$grid, a$density)
  expect_equal(w$x$options$violinAspect, 0.8)
  w <- violin(a$data, a$grid, a$density, violin_aspect = 1.2)
  expect_equal(w$x$options$violinAspect, 1.2)
  # The browser reads null as no cap; the option must not be dropped, or
  # the browser falls back to its default of 0.8.
  for (off in list(NULL, Inf)) {
    w <- violin(a$data, a$grid, a$density, violin_aspect = off)
    expect_true("violinAspect" %in% names(w$x$options))
    expect_match(json(w), '"violinAspect":null', fixed = TRUE)
  }
})

test_that("violin() sends violin_width and violin_aspect as plain numbers", {
  a <- make_args()
  json <- function(w) {
    as.character(jsonlite::toJSON(w$preRenderHook(w)$x, auto_unbox = TRUE,
                                  null = "null", na = "null"))
  }
  # A named vector reached the browser as an object and a 1 x 1 matrix
  # as an array, which it does not read as a number.
  for (aspect in list(c(a = 1.2), matrix(1.2))) {
    w <- violin(a$data, a$grid, a$density, violin_aspect = aspect)
    expect_match(json(w), '"violinAspect":1.2,', fixed = TRUE)
  }
  for (width in list(c(a = 0.5), matrix(0.5))) {
    w <- violin(a$data, a$grid, a$density, violin_width = width)
    expect_match(json(w), '"violinWidth":0.5,', fixed = TRUE)
  }
  expect_error(violin(a$data, a$grid, a$density, violin_width = c(0.5, 0.6)),
               "must be in")
})

test_that("violin() keeps the argument order of earlier releases", {
  # Calls that pass arguments by position keep working: the arguments
  # added since come after the old ones.
  old <- c("data", "grid", "density", "grids", "median", "features",
           "groups", "group_colors", "violin_width", "scale_per_violin",
           "show_median", "show_feature_labels", "show_value_axis",
           "theme", "width", "height", "element_id")
  expect_equal(head(names(formals(violin)), length(old)), old)
})

test_that("violin() checks violin_aspect", {
  a <- make_args()
  for (bad in list(0, -1, NA_real_, NA, TRUE, "1", c(1, 2), numeric(0))) {
    expect_error(violin(a$data, a$grid, a$density, violin_aspect = bad),
                 "`violin_aspect` must be a single positive number.",
                 fixed = TRUE)
  }
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

test_that("violin() carries per-feature grids", {
  a <- make_args()
  gm <- rbind(seq(0, 3, length.out = 64), seq(0, 9, length.out = 64))
  w <- violin(a$data, grid = a$grid, density = a$density, grids = gm)
  expect_equal(length(as.numeric(w$x$data$meta$grids)), 2L * 64L)
  # Row-major, so the second feature's range follows the first's.
  expect_equal(as.numeric(w$x$data$meta$grids)[65], 0)
  expect_equal(as.numeric(w$x$data$meta$grids)[128], 9)

  expect_error(violin(a$data, a$grid, a$density, grids = gm[, 1:10]),
               "one column per `grid` entry")
  expect_error(violin(a$data, a$grid, a$density, grids = gm[1, , drop = FALSE]),
               "one row per feature")
})

test_that("violin() sends group_colors without a groups order", {
  a <- make_args()
  w <- violin(a$data, grid = a$grid, density = a$density,
              group_colors = c("#111111", "#222222"))
  # Colours follow the groups in order of first appearance.
  expect_equal(as.character(w$x$data$meta$groups), c("T", "B"))
  expect_equal(as.character(w$x$data$meta$groupColors), c("#111111", "#222222"))
})

test_that("violin() sends the value axis option", {
  a <- make_args()
  w <- violin(a$data, grid = a$grid, density = a$density)
  expect_true(w$x$options$showValueAxis)
  w <- violin(a$data, grid = a$grid, density = a$density,
              show_value_axis = FALSE)
  expect_false(w$x$options$showValueAxis)
})
