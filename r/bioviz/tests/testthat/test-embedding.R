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

test_that("embedding() validates its input", {
  expect_error(embedding(list(x = 1, y = 2)), "must be a data frame")
  expect_error(embedding(data.frame(a = 1, b = 2)), "must contain columns")
})

test_that("embedding() omits optional columns when absent", {
  w <- embedding(data.frame(x = 1:3, y = 1:3))
  expect_null(w$x$data$columns$color)
  expect_null(w$x$data$columns$label)
})
