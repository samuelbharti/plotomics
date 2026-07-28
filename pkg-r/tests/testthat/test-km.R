test_that("km() builds an htmlwidget with the expected payload", {
  df <- data.frame(
    time = c(0, 5, 12, 0, 7, 15),
    surv = c(1, 0.9, 0.7, 1, 0.8, 0.5),
    lower = c(1, 0.8, 0.6, 1, 0.7, 0.4),
    upper = c(1, 1, 0.8, 1, 0.9, 0.6),
    group = rep(c("treated", "control"), each = 3),
    stringsAsFactors = FALSE
  )
  w <- km(df, p_label = "log-rank p = 0.03", x_label = "days")

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$time, df$time)
  expect_equal(w$x$data$columns$surv, df$surv)
  expect_equal(w$x$data$columns$lower, df$lower)
  expect_equal(as.character(w$x$data$meta$groups), c("treated", "control"))
  expect_equal(w$x$data$meta$pLabel, "log-rank p = 0.03")
  expect_equal(w$x$options$xLabel, "days")
  expect_true(w$x$options$showRiskTable)
})

test_that("km() honours factor levels as the stratum order", {
  df <- data.frame(
    time = c(0, 1, 0, 1),
    surv = c(1, 0.5, 1, 0.9),
    group = factor(c("b", "b", "a", "a"), levels = c("a", "b"))
  )
  expect_equal(as.character(km(df)$x$data$meta$groups), c("a", "b"))
})

test_that("km() flattens risk counts row-major", {
  df <- data.frame(
    time = c(0, 1, 0, 1), surv = c(1, 0.5, 1, 0.9),
    group = rep(c("a", "b"), each = 2)
  )
  counts <- matrix(c(10L, 5L, 20L, 9L), nrow = 2, byrow = TRUE)
  w <- km(df, risk_times = c(0, 1), risk_counts = counts)
  # The component reads riskCounts[g * ntimes + j], so group a's row comes first.
  expect_equal(unlist(w$x$data$meta$riskCounts), c(10L, 5L, 20L, 9L))
  expect_equal(unlist(w$x$data$meta$riskTimes), c(0, 1))
})

test_that("km() validates its input", {
  expect_error(km(list(time = 1, surv = 1)), "must be a data frame")
  expect_error(km(data.frame(a = 1, b = 2)), "must contain `time` and `surv`")
  expect_error(
    km(data.frame(time = 1, surv = 1.4)),
    "must be a probability"
  )
  df <- data.frame(time = c(0, 1), surv = c(1, 0.5), group = c("a", "a"))
  expect_error(km(df, groups = "b"), "not present in `groups`")
  expect_error(
    km(df, groups = "a", group_colors = c("#000", "#fff")),
    "one entry per stratum"
  )
  expect_error(
    km(df, risk_times = c(0, 1), risk_counts = matrix(1L, nrow = 1)),
    "one column per"
  )
})

test_that("km() reads a survfit object", {
  skip_if_not_installed("survival")
  set.seed(1)
  d <- data.frame(
    t = c(5, 8, 12, 20, 3, 9, 14, 25),
    e = c(1, 0, 1, 0, 1, 1, 0, 1),
    g = rep(c("a", "b"), each = 4)
  )
  fit <- survival::survfit(survival::Surv(t, e) ~ g, data = d)
  w <- km(fit)

  expect_s3_class(w, "htmlwidget")
  expect_equal(as.character(w$x$data$meta$groups), c("a", "b"))
  # The strata prefix ("g=a") is stripped down to the level.
  expect_false(any(grepl("=", as.character(w$x$data$meta$groups))))
  # survfit omits the origin, so the adapter prepends (time 0, surv 1) per
  # stratum; without it the step would start partway down.
  expect_equal(sum(w$x$data$columns$time == 0), 2L)
  expect_true(all(w$x$data$columns$surv[w$x$data$columns$time == 0] == 1))
  # Curves stay in ascending time within a stratum.
  for (g in c("a", "b")) {
    tt <- w$x$data$columns$time[w$x$data$columns$group == g]
    expect_false(is.unsorted(tt))
  }
  # Censoring ticks come from n.censor.
  expect_equal(length(unlist(w$x$data$meta$censorTime)), sum(d$e == 0))
  # A risk table is derived, one row per stratum.
  expect_equal(
    length(unlist(w$x$data$meta$riskCounts)),
    2L * length(unlist(w$x$data$meta$riskTimes))
  )
})

test_that("km() reads an unstratified survfit object", {
  skip_if_not_installed("survival")
  d <- data.frame(t = c(5, 8, 12, 20), e = c(1, 0, 1, 1))
  fit <- survival::survfit(survival::Surv(t, e) ~ 1, data = d)
  w <- km(fit)
  expect_equal(as.character(w$x$data$meta$groups), "all")
  expect_true(all(w$x$data$columns$surv <= 1))
})

test_that("km() at-risk counts are the number still at risk at each grid time", {
  skip_if_not_installed("survival")
  d <- data.frame(t = c(10, 20, 30, 40), e = c(1, 1, 1, 1))
  fit <- survival::survfit(survival::Surv(t, e) ~ 1, data = d)
  w <- km(fit, risk_times = c(0, 15, 35))
  # At time 0 all four are at risk; after the first event three; after three
  # events one.
  expect_equal(unlist(w$x$data$meta$riskCounts), c(4L, 3L, 1L))
})
