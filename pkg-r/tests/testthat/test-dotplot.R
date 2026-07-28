make_df <- function() {
  df <- expand.grid(gene = c("CD3D", "MS4A1"), cluster = c("T", "B"),
                    stringsAsFactors = FALSE)
  df$pct <- c(88, 4, 6, 91)
  df$value <- c(2.4, 0.1, 0.2, 2.7)
  df
}

test_that("dotplot() builds an htmlwidget with the expected payload", {
  w <- dotplot(make_df(), colormap = "ltc", max_radius = 12)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$gene, c("CD3D", "MS4A1", "CD3D", "MS4A1"))
  expect_equal(w$x$data$columns$cluster, c("T", "T", "B", "B"))
  expect_equal(w$x$data$columns$pct, c(88, 4, 6, 91))
  expect_equal(w$x$options$colormap, "ltc")
  expect_equal(w$x$options$maxRadius, 12)
  expect_equal(w$x$data$meta$sizeLabel, "% expressing")
})

test_that("dotplot() takes row and column order from factor levels", {
  df <- make_df()
  df$gene <- factor(df$gene, levels = c("MS4A1", "CD3D"))
  df$cluster <- factor(df$cluster, levels = c("B", "T"))
  w <- dotplot(df)
  expect_equal(as.character(w$x$data$meta$genes), c("MS4A1", "CD3D"))
  expect_equal(as.character(w$x$data$meta$clusters), c("B", "T"))
})

test_that("dotplot() leaves the order unset for character columns", {
  w <- dotplot(make_df())
  expect_null(w$x$data$meta$genes)
  expect_null(w$x$data$meta$clusters)
})

test_that("dotplot() carries an explicit value domain", {
  w <- dotplot(make_df(), value_domain = c(0, 5))
  expect_equal(as.numeric(w$x$options$valueDomain), c(0, 5))
})

test_that("dotplot() validates its input", {
  expect_error(dotplot(list(gene = "a")), "must be a data frame")
  expect_error(dotplot(data.frame(gene = "a")), "missing column")

  bad <- make_df()
  bad$pct[1] <- 140
  expect_error(dotplot(bad), "percentage in \\[0, 100\\]")

  # Non-finite values warn rather than error, matching the rest of the package:
  # a NaN in one cell should not cost you the whole figure.
  bad2 <- make_df()
  bad2$value[1] <- NA_real_
  expect_warning(dotplot(bad2), "non-finite")

  expect_error(dotplot(make_df(), genes = "CD3D"), "not present in `genes`")
  expect_error(dotplot(make_df(), clusters = "T"), "not present in `clusters`")
  expect_error(dotplot(make_df(), value_domain = 1), "length 2")
})
