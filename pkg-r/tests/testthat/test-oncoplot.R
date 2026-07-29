alt_fixture <- function() {
  data.frame(
    gene = c("TP53", "TP53", "TP53", "PIK3CA", "PIK3CA", "GATA3"),
    sample = c("S1", "S2", "S3", "S2", "S4", "S1"),
    class = c("Missense", "Truncating", "Missense", "Missense",
              "Amplification", "Missense"),
    stringsAsFactors = FALSE
  )
}

test_that("oncoplot() builds an htmlwidget with the expected payload", {
  w <- oncoplot(alt_fixture())

  expect_s3_class(w, "htmlwidget")
  # TP53 (3 samples) outranks PIK3CA (2) outranks GATA3 (1).
  expect_equal(w$x$data$meta$genes, c("TP53", "PIK3CA", "GATA3"))
  expect_equal(w$x$data$meta$nrows, 3)
  expect_equal(w$x$data$meta$ncols, 4)
  expect_length(w$x$data$columns$codes, 12)
})

test_that("codes are row-major with 0 for unaltered", {
  w <- oncoplot(alt_fixture())
  genes <- w$x$data$meta$genes
  samples <- w$x$data$meta$samples
  classes <- w$x$data$meta$classes
  codes <- w$x$data$columns$codes
  ncols <- length(samples)

  at <- function(g, s) codes[(match(g, genes) - 1L) * ncols + match(s, samples)]
  expect_equal(classes[at("TP53", "S1")], "Missense")
  expect_equal(classes[at("TP53", "S2")], "Truncating")
  expect_equal(classes[at("PIK3CA", "S4")], "Amplification")
  # GATA3 is only altered in S1, so every other GATA3 cell is unaltered.
  expect_equal(at("GATA3", "S2"), 0L)
  expect_equal(at("GATA3", "S4"), 0L)
})

test_that("frequency and burden are derived from the grid", {
  w <- oncoplot(alt_fixture())
  # TP53 in 3 of 4 samples, PIK3CA in 2, GATA3 in 1.
  expect_equal(w$x$data$columns$freq, c(75, 50, 25))
  # Burden is altered genes per sample, in the sorted sample order.
  samples <- w$x$data$meta$samples
  burden <- w$x$data$columns$tmb
  expect_equal(burden[match("S2", samples)], 2)
  expect_equal(burden[match("S1", samples)], 2)
  expect_equal(burden[match("S3", samples)], 1)
  expect_equal(sum(burden), 6)
})

test_that("memo sort puts the top gene's carriers first", {
  ord <- oncoplot_memo_sort(alt_fixture())
  expect_equal(ord$genes, c("TP53", "PIK3CA", "GATA3"))
  # S1, S2, S3 carry TP53; S4 does not, so it sorts last.
  expect_equal(ord$samples[4], "S4")
})

test_that("explicit orders are respected rather than re-sorted", {
  w <- oncoplot(alt_fixture(),
    genes = c("GATA3", "PIK3CA", "TP53"),
    samples = c("S4", "S3", "S2", "S1")
  )
  expect_equal(w$x$data$meta$genes, c("GATA3", "PIK3CA", "TP53"))
  expect_equal(w$x$data$meta$samples, c("S4", "S3", "S2", "S1"))
})

test_that("annotations are encoded as levels plus 0-based codes", {
  w <- oncoplot(alt_fixture(),
    samples = c("S1", "S2", "S3", "S4"),
    annotations = list(
      list(name = "Subtype", values = c("LumA", "Basal", "LumA", NA))
    )
  )
  a <- w$x$data$meta$annotations[[1]]
  expect_equal(a$name, "Subtype")
  expect_equal(as.character(a$levels), c("Basal", "LumA"))
  expect_equal(a$codes, c(1L, 0L, 1L, -1L))
})

test_that("oncoplot() validates its input", {
  expect_error(oncoplot(list(gene = 1)), "must be a data frame")
  expect_error(oncoplot(data.frame(a = 1, b = 2)), "must contain columns")
  expect_error(
    oncoplot(alt_fixture(), classes = c("Missense")),
    "not present in .classes."
  )
  expect_error(
    oncoplot(alt_fixture(), class_colors = c("#000000")),
    "one entry per class"
  )
  expect_error(
    oncoplot(alt_fixture(), burden = c(1, 2)),
    "one value per sample"
  )
  expect_error(
    oncoplot(alt_fixture(),
      annotations = list(list(name = "Subtype", values = c("A", "B")))
    ),
    "one value per sample"
  )
})

test_that("oncoplot() forwards the bar colour, label and cell-gap options", {
  d <- oncoplot(alt_fixture())
  expect_equal(d$x$options$burdenColor, "#0E7175")
  expect_equal(d$x$options$frequencyColor, "#ED773C")
  expect_equal(d$x$options$xLabel, "samples")
  expect_equal(d$x$options$burdenLabel, "alterations")
  expect_equal(d$x$options$cellGapX, 0.12)
  expect_equal(d$x$options$cellGapY, 0.16)

  w <- oncoplot(alt_fixture(), burden_color = "#111111",
                frequency_color = "#222222", x_label = "patients",
                burden_label = "mutations", cell_gap_x = 0, cell_gap_y = 0)
  expect_equal(w$x$options$burdenColor, "#111111")
  expect_equal(w$x$options$frequencyColor, "#222222")
  expect_equal(w$x$options$xLabel, "patients")
  expect_equal(w$x$options$burdenLabel, "mutations")
  # A zero gap draws a solid block, so it must survive the payload.
  expect_equal(w$x$options$cellGapX, 0)
  expect_equal(w$x$options$cellGapY, 0)
})
