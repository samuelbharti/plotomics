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
