variants_fixture <- function() {
  data.frame(
    position = c(175, 248, 273, 220, 42),
    count = c(21, 15, 13, 7, 2),
    class = c("Missense", "Missense", "Missense", "Missense", "Truncating"),
    label = c("R175H", "R248Q", "R273H", "Y220C", "E42*"),
    stringsAsFactors = FALSE
  )
}

domains_fixture <- function() {
  data.frame(
    name = c("P53 transactivation motif", "P53 DNA-binding domain"),
    start = c(6, 100), end = c(30, 288),
    stringsAsFactors = FALSE
  )
}

test_that("lollipop() builds an htmlwidget with the expected payload", {
  w <- lollipop(variants_fixture(), length = 393, gene = "TP53",
                uniprot = "P04637", domains = domains_fixture())

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$position, c(175, 248, 273, 220, 42))
  expect_equal(w$x$data$columns$count, c(21, 15, 13, 7, 2))
  expect_equal(w$x$data$meta$length, 393)
  expect_equal(w$x$data$meta$gene, "TP53")
  expect_equal(w$x$data$meta$uniprot, "P04637")
  # Missense (4) outranks Truncating (1).
  expect_equal(as.character(w$x$data$meta$classes), c("Missense", "Truncating"))
})

test_that("domains and PTMs serialize as arrays of objects", {
  w <- lollipop(variants_fixture(), length = 393,
                domains = domains_fixture(),
                ptms = data.frame(position = c(15, 392),
                                  type = c("phospho", "phospho")))
  expect_length(w$x$data$meta$domains, 2)
  expect_equal(w$x$data$meta$domains[[2]]$name, "P53 DNA-binding domain")
  expect_equal(w$x$data$meta$domains[[2]]$start, 100)
  expect_equal(w$x$data$meta$domains[[2]]$end, 288)
  expect_length(w$x$data$meta$ptms, 2)
  expect_equal(w$x$data$meta$ptms[[1]]$position, 15)
})

test_that("a single domain still yields a list, not a bare object", {
  w <- lollipop(variants_fixture(), length = 393,
                domains = data.frame(name = "only", start = 10, end = 20))
  expect_true(is.list(w$x$data$meta$domains))
  expect_length(w$x$data$meta$domains, 1)
  expect_equal(w$x$data$meta$domains[[1]]$name, "only")
})

test_that("labelled stems are resolved server-side, 0-based and sorted", {
  w <- lollipop(variants_fixture(), length = 393, label_top_n = 3)
  # The three most recurrent are rows 1, 2, 3 (counts 21, 15, 13) -> 0, 1, 2.
  expect_equal(as.integer(w$x$data$meta$labelIndex), c(0L, 1L, 2L))
})

test_that("label_top_n = 0 emits no label index", {
  w <- lollipop(variants_fixture(), length = 393, label_top_n = 0)
  expect_null(w$x$data$meta$labelIndex)
})

test_that("lollipop() validates its input", {
  v <- variants_fixture()
  expect_error(lollipop(list(position = 1), length = 10), "must be a data frame")
  expect_error(lollipop(data.frame(a = 1), length = 10), "must contain columns")
  expect_error(lollipop(v, length = 0), "positive protein length")
  expect_error(lollipop(v, length = 100), "within 1..length")
  expect_error(
    lollipop(v, length = 393, classes = "Missense"),
    "not present in .classes."
  )
  expect_error(
    lollipop(v, length = 393, class_colors = "#000000"),
    "one entry per class"
  )
  expect_error(
    lollipop(v, length = 393, domains = data.frame(a = 1)),
    "must contain columns"
  )
  expect_error(
    lollipop(v, length = 393, ptms = data.frame(a = 1)),
    "must contain columns"
  )
})
