test_that("volcano() builds an htmlwidget with the expected payload", {
  df <- data.frame(
    x = c(-2, 0, 2),
    y = c(3, 0.1, 4),
    label = c("A", "B", "C")
  )
  w <- volcano(df, fc_threshold = 1.5, p_threshold = 0.01, label_top_n = 5)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$x, c(-2, 0, 2))
  expect_equal(w$x$data$columns$label, c("A", "B", "C"))
  expect_equal(w$x$options$fcThreshold, 1.5)
  expect_equal(w$x$options$pThreshold, 0.01)
  expect_equal(w$x$options$labelTopN, 5)
})

test_that("volcano() validates its input", {
  expect_error(volcano(list(x = 1, y = 2)), "must be a data frame")
  expect_error(volcano(data.frame(a = 1, b = 2)), "must contain columns")
})

test_that("volcano() omits the label column when absent", {
  w <- volcano(data.frame(x = 1:3, y = 1:3))
  expect_null(w$x$data$columns$label)
})
