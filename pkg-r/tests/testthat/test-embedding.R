test_that("embedding() builds an htmlwidget with the expected payload", {
  df <- data.frame(
    x = c(-2, 0, 2),
    y = c(3, 0.1, 4),
    color = c("A", "B", "A"),
    label = c("c1", "c2", "c3")
  )
  w <- embedding(df, point_size = 5, color_mode = "categorical", show_axes = TRUE)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$x, c(-2, 0, 2))
  expect_equal(w$x$data$columns$color, c("A", "B", "A"))
  expect_equal(w$x$data$columns$label, c("c1", "c2", "c3"))
  expect_equal(w$x$options$pointSize, 5)
  expect_equal(w$x$options$colorMode, "categorical")
  expect_true(w$x$options$showAxes)
  expect_true(w$x$options$showLegend)
})

test_that("embedding() preserves a numeric color column for continuous mode", {
  df <- data.frame(x = 1:3, y = 1:3, color = c(0.1, 0.5, 0.9))
  w <- embedding(df)
  expect_equal(w$x$data$columns$color, c(0.1, 0.5, 0.9))
  expect_equal(w$x$options$colorMode, "auto")
})

test_that("embedding() sends factor levels as the category order", {
  df <- data.frame(
    x = 1:3, y = 1:3,
    color = factor(c("B", "A", "B"), levels = c("A", "B", "C"))
  )
  w <- embedding(df)
  # Levels, not first-appearance order, and the unused "C" survives so the
  # colours stay put when the data changes underneath.
  expect_equal(unlist(w$x$options$categories), c("A", "B", "C"))
  expect_equal(w$x$data$columns$color, c("B", "A", "B"))
})

test_that("embedding() leaves the category order unset for a character column", {
  df <- data.frame(x = 1:3, y = 1:3, color = c("B", "A", "B"),
                   stringsAsFactors = FALSE)
  expect_null(embedding(df)$x$options$categories)
})

test_that("embedding() validates its input", {
  expect_error(embedding(list(x = 1, y = 2)), "must be a data frame")
  expect_error(embedding(data.frame(a = 1, b = 2)), "must contain columns")
})

test_that("embedding() omits optional columns when absent", {
  w <- embedding(data.frame(x = 1:3, y = 1:3))
  expect_null(w$x$data$columns$color)
  expect_null(w$x$data$columns$label)
})

test_that("embedding() rejects a factor/character coordinate column", {
  df <- data.frame(x = factor(c("1", "2")), y = c(1, 2))
  expect_error(embedding(df), "`x` must be numeric, not a factor/character")
})

test_that("embedding() still allows a categorical color column", {
  df <- data.frame(x = 1:3, y = 1:3, color = factor(c("a", "b", "a")))
  w <- embedding(df)
  expect_equal(w$x$data$columns$color, c("a", "b", "a"))
})

test_that("embedding() warns on non-finite coordinates", {
  df <- data.frame(x = c(1, Inf), y = c(1, 2))
  expect_warning(embedding(df), "`x` has 1 non-finite value")
})

test_that("embedding() rejects empty input", {
  expect_error(
    embedding(data.frame(x = numeric(0), y = numeric(0))),
    "`data` has no rows/cells"
  )
})

test_that("embedding() forwards mouse_mode and theme options", {
  df <- data.frame(x = 1:3, y = 1:3)
  w <- embedding(df, mouse_mode = "lasso", theme = list(background = "#111"))
  expect_equal(w$x$options$mouseMode, "lasso")
  expect_equal(w$x$options$theme$background, "#111")

  # Default mouse mode is panZoom; theme omitted when NULL.
  d <- embedding(df)
  expect_equal(d$x$options$mouseMode, "panZoom")
  expect_null(d$x$options$theme)
})

test_that("embedding() carries the aspect option", {
  d <- data.frame(x = c(1, 2, 3), y = c(1, 2, 3))
  expect_equal(embedding(d)$x$options$aspect, "fill")
  expect_equal(embedding(d, aspect = "equal")$x$options$aspect, "equal")
  expect_error(embedding(d, aspect = "square"), "should be one of")
})

test_that("embedding() carries the fit padding", {
  d <- data.frame(x = c(1, 2, 3), y = c(1, 2, 3))
  expect_equal(embedding(d)$x$options$padding, 0.04)
  expect_equal(embedding(d, padding = 0.25)$x$options$padding, 0.25)
  # Zero is meaningful (fit tight to the data), so it must survive rather than
  # being dropped as a falsy value.
  expect_equal(embedding(d, padding = 0)$x$options$padding, 0)
})

test_that("embedding() carries the point scale mode", {
  d <- data.frame(x = c(1, 2, 3), y = c(1, 2, 3))
  expect_equal(embedding(d)$x$options$pointScaleMode, "asinh")
  expect_equal(embedding(d, point_scale_mode = "constant")$x$options$pointScaleMode,
               "constant")
  expect_error(embedding(d, point_scale_mode = "log"), "should be one of")
})
