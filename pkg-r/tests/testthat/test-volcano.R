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

test_that("volcano() rejects a factor/character numeric column", {
  df <- data.frame(x = factor(c("1", "2")), y = c(1, 2))
  expect_error(volcano(df), "`x` must be numeric, not a factor/character")
})

test_that("volcano() warns (not errors) on missing or infinite values", {
  df <- data.frame(x = c(1, NaN, Inf), y = c(1, 2, 3))
  expect_warning(volcano(df), "`x` has 2 value(s) that are", fixed = TRUE)
})

test_that("volcano() rejects empty input", {
  df <- data.frame(x = numeric(0), y = numeric(0))
  expect_error(volcano(df), "`data` has no rows/cells")
})

test_that("volcano() forwards colors, threshold-lines and theme options", {
  df <- data.frame(x = c(-1, 1), y = c(1, 2))
  w <- volcano(df,
    colors = list(up = "#ff0000", down = "#0000ff", ns = "#cccccc"),
    show_threshold_lines = FALSE,
    theme = list(background = "#000000")
  )
  expect_equal(w$x$options$colors$up, "#ff0000")
  expect_false(w$x$options$showThresholdLines)
  expect_equal(w$x$options$theme$background, "#000000")
})

test_that("volcano() omits colors/theme when NULL and defaults threshold on", {
  w <- volcano(data.frame(x = 1:3, y = 1:3))
  expect_null(w$x$options$colors)
  expect_null(w$x$options$theme)
  expect_true(w$x$options$showThresholdLines)
})

test_that("volcano() keeps p = 0 rows and warns only about missing values", {
  df <- data.frame(x = c(1, 2, 3), y = c(2, Inf, 4))
  expect_silent(w <- volcano(df))
  # 0-based row of the Inf, since JSON sends Inf as null. It must reach the
  # browser as an array, also when there is only one.
  expect_equal(as.integer(w$x$data$meta$yInfinite), 1L)
  json <- jsonlite::toJSON(w$preRenderHook(w)$x, auto_unbox = TRUE)
  expect_match(as.character(json), '"yInfinite":[1]', fixed = TRUE)
  expect_null(volcano(data.frame(x = 1:2, y = 1:2))$x$data$meta$yInfinite)
  expect_warning(
    volcano(data.frame(x = 1:2, y = c(1, NA))),
    "`y` has 1 value(s) that are missing (NA or NaN) or -Inf",
    fixed = TRUE
  )
})

test_that("volcano() counts only the y values it does not draw, as Python does", {
  df <- data.frame(
    x = c(1, 2, 3, 4, 5, 6),
    y = c(Inf, Inf, NA, NaN, -Inf, 2)
  )
  # Before the fix the message said "(NaN/Inf)" for a count without the Inf.
  warned <- testthat::capture_warnings(volcano(df))
  expect_equal(warned, paste0(
    "`y` has 3 value(s) that are missing (NA or NaN) or -Inf; those rows ",
    "are not drawn."
  ))
})

test_that("volcano(label_top_n = Inf) labels every gene, as lollipop() does", {
  df <- data.frame(x = c(-3, -2, 2, 3), y = c(5, 4, 4, 5), label = letters[1:4])
  # JSON has no Inf: before the fix it went as null and nothing was labelled.
  w <- volcano(df, label_top_n = Inf)
  expect_equal(w$x$options$labelTopN, 4L)
  json <- as.character(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
  expect_match(json, '"labelTopN":4', fixed = TRUE)
  expect_equal(volcano(df, label_top_n = -Inf)$x$options$labelTopN, 0L)
  expect_equal(volcano(df, label_top_n = 2)$x$options$labelTopN, 2)
})
