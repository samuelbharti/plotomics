spots_fixture <- function() {
  data.frame(
    x = c(100, 150, 200, 250),
    y = c(120, 160, 90, 200),
    color = c("Cluster 1", "Cluster 2", "Cluster 1", "Cluster 3"),
    label = c("AAA", "CCC", "GGG", "TTT"),
    stringsAsFactors = FALSE
  )
}

test_that("spatial() builds an htmlwidget with the expected payload", {
  w <- spatial(spots_fixture(), image = "spatial/tissue.png",
               img_width = 600, img_height = 600, spot_diameter = 8)

  expect_s3_class(w, "htmlwidget")
  expect_equal(w$x$data$columns$x, c(100, 150, 200, 250))
  expect_equal(w$x$data$columns$y, c(120, 160, 90, 200))
  expect_equal(w$x$data$columns$color[1], "Cluster 1")
  expect_equal(w$x$data$meta$image, "spatial/tissue.png")
  expect_equal(w$x$data$meta$imgWidth, 600)
  expect_equal(w$x$data$meta$imgHeight, 600)
  expect_equal(w$x$data$meta$spotDiameter, 8)
})

test_that("a numeric color column stays numeric", {
  df <- spots_fixture()
  df$color <- c(0.1, 2.4, 1.0, 3.3)
  w <- spatial(df, image = "t.png", img_width = 10, img_height = 10)
  expect_true(is.numeric(w$x$data$columns$color))
  expect_equal(w$x$data$columns$color, c(0.1, 2.4, 1.0, 3.3))
})

test_that("levels and colors survive as arrays even when single", {
  w <- spatial(spots_fixture(), image = "t.png", img_width = 10, img_height = 10,
               levels = "Cluster 1", colors = "#0E7175")
  expect_equal(as.character(w$x$data$meta$levels), "Cluster 1")
  expect_equal(as.character(w$x$data$meta$colors), "#0E7175")
  expect_length(as.character(w$x$data$meta$levels), 1)
})

test_that("options are forwarded", {
  w <- spatial(spots_fixture(), image = "t.png", img_width = 10, img_height = 10,
               color_mode = "continuous", colormap = "ltc", spot_scale = 1.5,
               spot_opacity = 0.4, image_opacity = 0.7, show_legend = FALSE)
  expect_equal(w$x$options$colorMode, "continuous")
  expect_equal(w$x$options$colormap, "ltc")
  expect_equal(w$x$options$spotScale, 1.5)
  expect_equal(w$x$options$spotOpacity, 0.4)
  expect_equal(w$x$options$imageOpacity, 0.7)
  expect_false(w$x$options$showLegend)
})

test_that("spatial() validates its input", {
  df <- spots_fixture()
  expect_error(spatial(list(x = 1), image = "t.png", img_width = 1, img_height = 1),
               "must be a data frame")
  expect_error(spatial(data.frame(a = 1), image = "t.png", img_width = 1, img_height = 1),
               "must contain columns")
  expect_error(spatial(df, image = "", img_width = 1, img_height = 1),
               "must be a URL or path")
  expect_error(spatial(df, image = "t.png", img_width = 0, img_height = 1),
               "must be positive")
  expect_error(spatial(df, image = "t.png", img_width = 1, img_height = 1,
                       levels = c("a", "b"), colors = "#000000"),
               "one entry per level")
  expect_error(spatial(df, image = "t.png", img_width = 1, img_height = 1,
                       colormap = "jet"))
})
