# bounded_view on the plots that pan and zoom: volcano(), embedding() and
# network(). Python checks the same values with the same message.

points <- data.frame(x = c(-1, 0, 1), y = c(0.5, 1, 2))
makers <- list(
  volcano = function(...) volcano(points, ...),
  embedding = function(...) embedding(points, ...),
  network = function(...) {
    network(
      data.frame(id = c("a", "b")),
      data.frame(source = "a", target = "b"),
      ...
    )
  }
)

test_that("bounded_view is on by default and always sent", {
  # Always sent, so a re-render that drops it builds the plot again with
  # the default, as for every other option.
  for (name in names(makers)) {
    w <- makers[[name]]()
    expect_identical(w$x$options$boundedView, TRUE, info = name)
  }
})

test_that("bounded_view = FALSE is sent as a plain FALSE", {
  for (name in names(makers)) {
    for (value in list(FALSE, c(a = FALSE), matrix(FALSE))) {
      w <- makers[[name]](bounded_view = value)
      expect_identical(w$x$options$boundedView, FALSE, info = name)
      json <- as.character(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
      expect_match(json, '"boundedView":false', fixed = TRUE, info = name)
    }
  }
})

test_that("bounded_view rejects anything but one TRUE or FALSE", {
  for (name in names(makers)) {
    for (value in list(NA, NULL, 1, 0, "no", "TRUE", c(TRUE, FALSE), NaN)) {
      expect_error(
        makers[[name]](bounded_view = value),
        "`bounded_view` must be a single true or false value",
        fixed = TRUE,
        info = name
      )
    }
  }
})
