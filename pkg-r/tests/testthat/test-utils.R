# htmlwidgets serialises with auto_unbox = TRUE. These tests run the widget's
# preRenderHook, as htmlwidgets does before it serialises, and check that the
# vectors the JavaScript reads as arrays stay arrays at length 1.

rendered_json <- function(w) {
  x <- w$preRenderHook(w)$x
  as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", na = "null"))
}

test_that("a one-row data frame sends each column as an array", {
  json <- rendered_json(volcano(data.frame(x = 2, y = 5, label = "TP53")))
  expect_match(json, '"x":[2]', fixed = TRUE)
  expect_match(json, '"y":[5]', fixed = TRUE)
  expect_match(json, '"label":["TP53"]', fixed = TRUE)
})

test_that("an oncoplot with one class and one sample sends arrays", {
  w <- oncoplot(
    data.frame(gene = c("TP53", "KRAS"), sample = c("S1", "S1"), class = "missense"),
    annotations = list(list(name = "Subtype", values = c(S1 = "LumA")))
  )
  json <- rendered_json(w)
  expect_match(json, '"classes":["missense"]', fixed = TRUE)
  expect_match(json, '"samples":["S1"]', fixed = TRUE)
  expect_match(json, '"codes":[0]', fixed = TRUE)
})

test_that("one-element labels, ids and palettes stay arrays", {
  m <- matrix(5, 1, 1, dimnames = list("TP53", "s1"))
  json <- rendered_json(bioheatmap(m))
  expect_match(json, '"rowLabels":["TP53"]', fixed = TRUE)
  expect_match(json, '"colLabels":["s1"]', fixed = TRUE)
  expect_match(json, '"values":[5]', fixed = TRUE)

  net <- network(
    data.frame(id = c("TP53", "MDM2"), group = "a"),
    data.frame(source = "TP53", target = "MDM2"),
    palette = "#ff0000"
  )
  json <- rendered_json(net)
  expect_match(json, '"source":["TP53"]', fixed = TRUE)
  expect_match(json, '"palette":["#ff0000"]', fixed = TRUE)

  json <- rendered_json(volcano(
    data.frame(x = 1:2, y = 1:2),
    theme = list(categorical = "#123456")
  ))
  expect_match(json, '"categorical":["#123456"]', fixed = TRUE)
})

test_that("the theme padding goes to the browser as a number or an object", {
  df <- data.frame(x = 1:2, y = 1:2)
  json <- rendered_json(volcano(df, theme = list(padding = 16)))
  expect_match(json, '"padding":16', fixed = TRUE)
  json <- rendered_json(volcano(df, theme = list(
    padding = list(top = 4, right = 16, bottom = 4, left = 16)
  )))
  expect_match(
    json, '"padding":{"top":4,"right":16,"bottom":4,"left":16}',
    fixed = TRUE
  )
  # A named vector, which jsonlite would send as an array, is an object too.
  json <- rendered_json(volcano(df, theme = list(padding = c(top = 4, left = 30))))
  expect_match(json, '"padding":{"top":4,"left":30}', fixed = TRUE)
  json <- rendered_json(bioheatmap(matrix(1:4, 2), theme = list(
    padding = c(left = 30L), fontSize = 14
  )))
  expect_match(json, '"padding":{"left":30}', fixed = TRUE)
  json <- rendered_json(volcano(df, theme = list(fontSize = 14)))
  expect_no_match(json, "padding", fixed = TRUE)
})

test_that("a bad theme padding is an error, the one Python raises", {
  df <- data.frame(x = 1:2, y = 1:2)
  msg <- paste0(
    "`theme$padding` must be a number of 0 or more, or a named list of ",
    "them with names from top, right, bottom and left."
  )
  bad <- list(
    -1, NA, NaN, Inf, "16", c(4, 16), TRUE, factor(3), list(),
    list(top = -1), c(top = NaN), list(top = "4"), list(middle = 4),
    c(top = 1, top = 2), list(4, 5)
  )
  for (b in bad) {
    expect_error(volcano(df, theme = list(padding = b)), msg, fixed = TRUE)
  }
})

test_that("scalars in meta and options stay scalars", {
  m <- matrix(5, 1, 1)
  json <- rendered_json(bioheatmap(m, colormap = "viridis"))
  expect_match(json, '"nrows":1', fixed = TRUE)
  expect_match(json, '"colormap":"viridis"', fixed = TRUE)
})

test_that("the hook leaves the payload users inspect unchanged", {
  w <- volcano(data.frame(x = 2, y = 5))
  expect_false(inherits(w$x$data$columns$x, "AsIs"))
})

test_that("a named palette goes to the browser as its colours in order", {
  df <- data.frame(x = 1:3, y = 1:3, color = c("T", "B", "NK"))
  pal <- c(T = "#ff0000", B = "#0000ff", NK = "#00aa00")
  # Before the fix it went as an object, which the browser does not read as
  # a palette, so the plot drew its default colours.
  json <- rendered_json(embedding(df, theme = list(categorical = pal)))
  expect_match(json, '"categorical":["#ff0000","#0000ff","#00aa00"]',
               fixed = TRUE)
  json <- rendered_json(embedding(df, theme = list(categorical = as.list(pal))))
  expect_match(json, '"categorical":["#ff0000","#0000ff","#00aa00"]',
               fixed = TRUE)
  json <- rendered_json(embedding(df, theme = list(categorical = c(T = "#ff0000"))))
  expect_match(json, '"categorical":["#ff0000"]', fixed = TRUE)
  # Other theme entries lose their names too, and stay scalars.
  json <- rendered_json(volcano(df, theme = list(
    background = c(bg = "#000000"), fontSize = c(size = 14),
    padding = c(top = 4)
  )))
  expect_match(json, '"background":"#000000"', fixed = TRUE)
  expect_match(json, '"fontSize":14', fixed = TRUE)
  expect_match(json, '"padding":{"top":4}', fixed = TRUE)
  # htmlwidgets serialises with keep_vec_names, which warns about a named
  # vector; nothing named is left for it to warn about.
  w <- embedding(df, theme = list(categorical = pal))
  expect_silent(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
})

test_that("a theme given as a named vector still renders", {
  w <- volcano(
    data.frame(x = 1:3, y = 1:3),
    theme = c(background = "#000000", foreground = "#ffffff")
  )
  expect_no_error(w$preRenderHook(w))
  json <- rendered_json(w)
  expect_match(json, '"theme":{"background":"#000000","foreground":"#ffffff"}',
               fixed = TRUE)
})

test_that("each plot has one default height, as in Shiny and Python", {
  # The same table is in the Python tests (test_defaults.py).
  expected <- c(
    clustermap = 560, dotplot = 560, embedding = 480, heatmap = 480,
    hic = 480, km = 520, lollipop = 440, network = 480, oncoplot = 560,
    profile = 380, spatial = 560, treemap = 480, upset = 520, violin = 560,
    volcano = 480
  )
  expect_setequal(names(plotomics_heights), names(expected))
  expect_equal(plotomics_heights[names(expected)], expected)
  outputs <- c(heatmap = "bioheatmapOutput", profile = "bioprofileOutput")
  for (name in names(expected)) {
    fn <- if (name %in% names(outputs)) outputs[[name]] else paste0(name, "Output")
    expect_equal(
      formals(get(fn))$height, paste0(expected[[name]], "px"),
      info = name
    )
  }
  m <- matrix(1:6, 2, 3)
  expect_equal(clustermap(m)$sizingPolicy$defaultHeight, 560)
  expect_equal(bioheatmap(m)$sizingPolicy$defaultHeight, 480)
  expect_equal(
    bioprofile(data.frame(value = c(1, 2)))$sizingPolicy$defaultHeight, 380
  )
  expect_equal(formals(clustermapOutput)$height, "560px")
})

test_that("the warning about missing or infinite values says what it counts", {
  # Before the fix 30 NA read "`x` has 30 non-finite value(s) (NaN/Inf).",
  # and Python said "column 'x' contains ...". Both now say the same.
  df <- data.frame(x = c(rep(NA, 30), 1, 2), y = seq_len(32))
  warned <- testthat::capture_warnings(embedding(df))
  expect_equal(warned, paste0(
    "`x` has 30 value(s) that are missing (NA or NaN) or infinite ",
    "(Inf or -Inf)."
  ))
  warned <- testthat::capture_warnings(
    embedding(data.frame(x = c(NaN, Inf, -Inf, 1), y = 1:4))
  )
  expect_equal(warned, paste0(
    "`x` has 3 value(s) that are missing (NA or NaN) or infinite ",
    "(Inf or -Inf)."
  ))
})
