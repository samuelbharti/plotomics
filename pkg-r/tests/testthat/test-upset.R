test_that("upset() builds an htmlwidget with the expected payload", {
  m <- matrix(c(TRUE, FALSE, FALSE, TRUE, TRUE, TRUE), nrow = 3, byrow = TRUE)
  w <- upset(data.frame(size = c(40, 25, 12)), sets = c("A", "B"),
             membership = m, set_sizes = c(52, 37), total = 100)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$size, c(40, 25, 12))
  expect_equal(as.character(w$x$data$meta$sets), c("A", "B"))
  # Row-major: the component indexes membership as intersection * nSets + set.
  expect_equal(as.integer(w$x$data$meta$membership), c(1L, 0L, 0L, 1L, 1L, 1L))
  expect_equal(as.numeric(w$x$data$meta$setSizes), c(52, 37))
  expect_equal(w$x$data$meta$total, 100)
})

test_that("upset() validates its input", {
  m <- matrix(TRUE, nrow = 1, ncol = 1)
  expect_error(upset(list(size = 1), "A", m), "must be a data frame")
  expect_error(upset(data.frame(a = 1), "A", m), "must contain a `size` column")
  expect_error(upset(data.frame(size = 1), character(0), m), "at least one set")
  expect_error(
    upset(data.frame(size = c(1, 2)), "A", m),
    "one row per intersection"
  )
  expect_error(
    upset(data.frame(size = 1), c("A", "B"), m),
    "one column per set"
  )
  expect_error(
    upset(data.frame(size = 1), "A", m, set_sizes = c(1, 2)),
    "one entry per set"
  )
})

test_that("upset_intersections() counts exclusive combinations", {
  m <- cbind(
    A = c(TRUE, TRUE, TRUE, FALSE, FALSE),
    B = c(TRUE, FALSE, FALSE, TRUE, FALSE)
  )
  r <- upset_intersections(m)
  # A-only appears twice, A+B once, B-only once; the all-FALSE row is dropped
  # because it has no column to sit in.
  expect_equal(sum(r$size), 4L)
  expect_equal(r$total, 5L)
  expect_equal(unname(r$set_sizes), c(3L, 2L))

  combos <- apply(r$membership, 1, function(x) paste(r$sets[x], collapse = "+"))
  expect_equal(unname(r$size[combos == "A"]), 2L)
  expect_equal(unname(r$size[combos == "A+B"]), 1L)
  expect_equal(unname(r$size[combos == "B"]), 1L)
})

test_that("upset_intersections() sizes never exceed the set totals", {
  set.seed(3)
  m <- matrix(runif(300) > 0.7, nrow = 60,
              dimnames = list(NULL, c("A", "B", "C", "D", "E")))
  r <- upset_intersections(m)
  for (k in seq_along(r$sets)) {
    # Every element counted for a set across exclusive intersections must add
    # up to exactly that set's total.
    expect_equal(sum(r$size[r$membership[, k]]), unname(r$set_sizes[k]))
  }
  expect_lte(sum(r$size), r$total)
})

test_that("upset_intersections() keeps only the largest when capped", {
  m <- cbind(A = c(TRUE, TRUE, FALSE), B = c(FALSE, FALSE, TRUE))
  r <- upset_intersections(m, max_n = 1)
  expect_equal(length(r$size), 1L)
  expect_equal(r$size, 2L)
})

test_that("upset_intersections() handles empty and unnamed input", {
  expect_error(upset_intersections(matrix(TRUE, 1, 1)), "column names")
  m <- matrix(FALSE, nrow = 3, ncol = 2, dimnames = list(NULL, c("A", "B")))
  r <- upset_intersections(m)
  expect_equal(length(r$size), 0L)
  expect_equal(r$total, 3L)
})
