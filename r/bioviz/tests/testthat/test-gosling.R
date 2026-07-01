test_that("gosling() builds an htmlwidget carrying the spec verbatim", {
  spec <- list(
    title = "t",
    tracks = list(list(
      mark = "bar",
      x = list(field = "start", type = "genomic")
    ))
  )
  w <- gosling(spec, padding = 30, theme = "dark")

  expect_s3_class(w, "htmlwidget")
  # The spec is passed through under options$spec, unmodified.
  expect_equal(w$x$options$spec, spec)
  expect_equal(w$x$options$padding, 30)
  expect_equal(w$x$options$theme, "dark")
  # Gosling is spec-driven, so columns are empty.
  expect_equal(w$x$data$columns, list())
})

test_that("gosling() omits padding and theme when not supplied", {
  w <- gosling(list(tracks = list()))
  expect_null(w$x$options$padding)
  expect_null(w$x$options$theme)
})

test_that("gosling() validates its input", {
  expect_error(gosling("not a list"), "must be a list")
  expect_error(gosling(list(foo = 1)), "must contain at least one")
})
