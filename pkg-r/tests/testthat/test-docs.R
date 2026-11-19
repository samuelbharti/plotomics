# Checks on the docs that live in the source tree: the README, the help
# examples and the pkgdown setup. R CMD check runs the tests on the built
# package, which has none of these files, so there they are skipped.

pkg_file <- function(...) test_path("..", "..", ...)

test_that("the README volcano quick start sends the gene labels", {
  readme <- pkg_file("README.md")
  skip_if_not(file.exists(readme), "README.md is not in the built package")
  lines <- readLines(readme, warn = FALSE)
  starts <- grep("^``` r$", lines)
  ends <- grep("^```$", lines)
  code <- unlist(lapply(starts, function(s) {
    lines[(s + 1L):(min(ends[ends > s]) - 1L)]
  }))
  calls <- as.list(parse(text = code))
  is_volcano <- vapply(calls, function(e) {
    is.call(e) && identical(e[[1]], as.name("volcano"))
  }, logical(1))
  expect_true(any(is_volcano))

  # A results table shaped like the one DESeq2 returns.
  res <- data.frame(
    log2FoldChange = c(-2.1, 0.2, 3.4),
    padj = c(1e-4, 0.6, 1e-8),
    row.names = c("TP53", "GAPDH", "MYC")
  )
  w <- eval(calls[[which(is_volcano)[1]]], list(res = res), environment())
  expect_identical(w$x$data$columns$label, rownames(res))
})

test_that("the README Shiny block builds its UI", {
  skip_if_not_installed("shiny")
  readme <- pkg_file("README.md")
  skip_if_not(file.exists(readme), "README.md is not in the built package")
  lines <- readLines(readme, warn = FALSE)
  start <- grep("^## Shiny$", lines)
  expect_length(start, 1L)
  from <- start + match("``` r", lines[-seq_len(start)])
  to <- from + match("```", lines[-seq_len(from)]) - 1L
  if (!"package:shiny" %in% search()) {
    on.exit(
      if ("package:shiny" %in% search()) detach("package:shiny"),
      add = TRUE
    )
  }
  env <- new.env()
  # Without library(shiny) the block stops at fluidPage().
  eval(parse(text = lines[(from + 1L):to]), env)
  expect_s3_class(env$ui, "shiny.tag.list")
  expect_true(is.function(env$server))
})

test_that("the spatial() example draws on an image it builds itself", {
  rd <- pkg_file("man", "spatial.Rd")
  skip_if_not(file.exists(rd), "man/spatial.Rd is not in the built package")
  ex <- tempfile(fileext = ".R")
  on.exit(unlink(ex))
  tools::Rd2ex(rd, ex)
  w <- source(ex, local = new.env())$value
  expect_s3_class(w, "spatial")
  # A file such as tissue.png is fetched by the browser and, when missing,
  # leaves a blank background and a 404 on the reference page.
  expect_match(w$x$data$meta$image, "^data:image/svg\\+xml,")
})

test_that("DESCRIPTION lists the URL of the pkgdown site", {
  yml <- pkg_file("_pkgdown.yml")
  desc <- pkg_file("DESCRIPTION")
  skip_if_not(file.exists(yml), "_pkgdown.yml is not in the built package")
  site <- sub("^url:\\s*", "", grep("^url:", readLines(yml), value = TRUE))
  urls <- trimws(strsplit(read.dcf(desc, fields = "URL")[1, 1], ",")[[1]])
  expect_length(site, 1L)
  # pkgdown compares without a trailing slash.
  expect_true(sub("/$", "", site) %in% sub("/$", "", urls))
})
