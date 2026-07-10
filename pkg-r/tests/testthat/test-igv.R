test_that("igv() assembles a config from convenience args", {
  w <- igv(
    genome = "hg38",
    locus = "chr8:127,736,588-127,739,371",
    tracks = list(list(name = "t", url = "t.bw", format = "bigWig"))
  )

  expect_s3_class(w, "htmlwidget")
  # Config-driven: no data columns.
  expect_equal(w$x$data$columns, list())
  expect_equal(w$x$options$genome, "hg38")
  expect_equal(w$x$options$locus, "chr8:127,736,588-127,739,371")
  expect_equal(w$x$options$tracks[[1]]$url, "t.bw")
  # No explicit config passed through.
  expect_null(w$x$options$config)
})

test_that("igv() passes a full config through and ignores convenience args", {
  cfg <- list(genome = "hg19", locus = "chr1:1-1000")
  w <- igv(genome = "hg38", locus = "chr2", config = cfg)

  expect_equal(w$x$options$config, cfg)
  expect_null(w$x$options$genome)
  expect_null(w$x$options$locus)
})

test_that("igv() omits tracks when none are supplied", {
  w <- igv(genome = "hg38")
  expect_equal(w$x$options$genome, "hg38")
  expect_null(w$x$options$tracks)
})

test_that("igv() validates its input", {
  expect_error(igv(config = "not-a-list"), "must be a named list")
  expect_error(igv(tracks = "not-a-list"), "must be a list")
})
