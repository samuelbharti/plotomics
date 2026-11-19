profile_fixture <- function() {
  data.frame(
    value = c(3, 5, 2, 8, 1, 4),
    group = c("C>A", "C>A", "C>G", "C>G", "C>T", "C>T"),
    label = c("ACA", "ACC", "TCA", "TCT", "GCG", "ACG"),
    stringsAsFactors = FALSE
  )
}

test_that("bioprofile() builds an htmlwidget with the expected payload", {
  w <- bioprofile(profile_fixture(), title = "Cohort catalogue",
               y_label = "SNVs", bar_width = 0.5)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$value, c(3, 5, 2, 8, 1, 4))
  expect_equal(w$x$data$columns$label[1], "ACA")
  expect_equal(as.character(w$x$data$meta$groups), c("C>A", "C>G", "C>T"))
  expect_equal(w$x$data$meta$title, "Cohort catalogue")
  expect_equal(w$x$options$yLabel, "SNVs")
  expect_equal(w$x$options$barWidth, 0.5)
})

test_that("group order follows first appearance unless given", {
  df <- profile_fixture()
  w1 <- bioprofile(df)
  expect_equal(as.character(w1$x$data$meta$groups), c("C>A", "C>G", "C>T"))
  w2 <- bioprofile(df, groups = c("C>T", "C>G", "C>A"))
  expect_equal(as.character(w2$x$data$meta$groups), c("C>T", "C>G", "C>A"))
})

test_that("a single group still serializes as an array", {
  w <- bioprofile(data.frame(value = c(1, 2), group = c("g", "g"),
                          stringsAsFactors = FALSE))
  expect_true(is.character(as.character(w$x$data$meta$groups)))
  expect_length(as.character(w$x$data$meta$groups), 1)
})

test_that("value works without group or label columns", {
  w <- bioprofile(data.frame(value = c(1, 2, 3)))
  expect_equal(w$x$data$columns$value, c(1, 2, 3))
  expect_null(w$x$data$columns$group)
  expect_null(w$x$data$meta$groups)
})

test_that("bioprofile() warns on values that are not finite and keeps their rows", {
  # JSON sends NA, NaN and Inf as null. The plot draws no bar for them and
  # leaves them out of the total, as it does for NaN from Python.
  expect_warning(
    w <- bioprofile(data.frame(value = c(3, NaN, Inf, 5)), as_fraction = TRUE),
    "`value` has 2 non-finite value"
  )
  json <- jsonlite::toJSON(
    w$preRenderHook(w)$x,
    auto_unbox = TRUE, null = "null", na = "null"
  )
  expect_match(as.character(json), '"value":[3,null,null,5]', fixed = TRUE)
  expect_true(w$x$options$asFraction)
})

test_that("bioprofile() refuses negative values as shares", {
  # Shares of a total with negative values are not defined. A value that is
  # not finite is left out of the count, as the plot leaves it out.
  df <- data.frame(value = c(2, -2, 1, -Inf, NaN))
  expect_error(
    suppressWarnings(bioprofile(df, as_fraction = TRUE)),
    "`as_fraction` needs every `value` to be 0 or more; found 1 negative value(s).",
    fixed = TRUE
  )
  # The sign is read as given: -1e-50 is negative, as in Python.
  expect_error(
    bioprofile(data.frame(value = c(-1e-50, 2)), as_fraction = TRUE),
    "found 1 negative value(s).",
    fixed = TRUE
  )
  # Without as_fraction the bars of negative values go down from 0.
  w <- bioprofile(data.frame(value = c(2, -2, 1)))
  expect_equal(w$x$data$columns$value, c(2, -2, 1))
  expect_false(w$x$options$asFraction)
})

test_that("bioprofile() takes as_fraction as one TRUE or FALSE", {
  # Before the fix as_fraction = 1 skipped the check for negative values,
  # while the plot took 1 as true.
  df <- data.frame(value = c(2, -2, 1))
  for (bad in list(1, NA, c(TRUE, FALSE), "yes")) {
    expect_error(
      bioprofile(df, as_fraction = bad),
      "`as_fraction` must be a single true or false value.",
      fixed = TRUE
    )
  }
  expect_true(bioprofile(profile_fixture(), as_fraction = TRUE)$x$options$asFraction)
})

test_that("bioprofile() validates its input", {
  df <- profile_fixture()
  expect_error(bioprofile(list(value = 1)), "must be a data frame")
  expect_error(bioprofile(data.frame(a = 1)), "must contain a .value. column")
  expect_error(bioprofile(df, bar_width = 0), "in \\(0, 1\\]")
  expect_error(bioprofile(df, bar_width = 1.5), "in \\(0, 1\\]")
  expect_error(bioprofile(df, groups = c("C>A")), "not present in .groups.")
  expect_error(
    bioprofile(df, group_colors = c("#000000")),
    "one entry per group"
  )
})
