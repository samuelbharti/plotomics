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

test_that("bv_colour() sends an R colour name CSS lacks as hex", {
  # The browser cannot read "grey20" or "steelblue4", and left out what
  # took them.
  expect_equal(bv_colour("grey20"), "#333333")
  expect_equal(bv_colour("steelblue4"), "#36648B")
  expect_equal(bv_colour("Firebrick3"), "#CD2626")
  expect_equal(bv_colour(c("grey50", "gray0")), c("#7F7F7F", "#000000"))
  # Names CSS knows stay, so "green" is the CSS green, not R's #00FF00.
  expect_equal(bv_colour(c("green", "SteelBlue", "white")),
               c("green", "SteelBlue", "white"))
  # Hex, with an alpha too, colour functions, var(), keywords and NA stay.
  kept <- c("#11223380", "#abc", "rgb(1 2 3)", "hsl(120 50% 50%)",
            "var(--x)", "none", "transparent", "currentColor", NA)
  expect_identical(bv_colour(kept), kept)
  # A name neither knows stays, for the browser to name in a warning.
  expect_equal(bv_colour("notacolour"), "notacolour")
  # Names, factors, lists and NULL.
  expect_equal(bv_colour(c(a = "grey20", b = "#000000")),
               c(a = "#333333", b = "#000000"))
  expect_equal(bv_colour(factor(c("grey20", "red"))), c("#333333", "red"))
  expect_equal(bv_colour(list(up = "grey20", ns = "grey")),
               list(up = "#333333", ns = "grey"))
  expect_null(bv_colour(NULL))
  expect_equal(bv_colour(3), 3)
})

test_that("bv_colour() keeps the alpha of an R colour", {
  # R names have no alpha of their own; col2rgb gives one for a hex.
  expect_equal(bv_colour("grey20"), "#333333")
  rgba <- grDevices::adjustcolor("grey20", alpha.f = 0.5)
  expect_equal(bv_colour(rgba), rgba)
})

test_that("bv_css_colours() holds the 148 names of CSS", {
  expect_length(bv_css_colours, 148L)
  expect_true(all(c("rebeccapurple", "grey", "darkslategrey") %in%
    bv_css_colours))
  expect_false(any(c("grey20", "steelblue4", "transparent") %in%
    bv_css_colours))
})

test_that("every theme colour and colour argument reaches the browser as hex", {
  theme <- list(
    background = "grey95", foreground = "grey20", muted = "grey50",
    grid = "#eeeeee", axis = "firebrick3", fontFamily = "Arial",
    fontSize = 14, padding = 5,
    categorical = c("grey50", "green", "#11223380", "var(--x)")
  )
  df <- data.frame(time = c(0, 5), surv = c(1, 0.5))
  w <- km(df, group_colors = "steelblue4", theme = theme)
  th <- w$x$options$theme
  expect_equal(th$background, "#F2F2F2")
  expect_equal(th$foreground, "#333333")
  expect_equal(th$muted, "#7F7F7F")
  expect_equal(th$grid, "#eeeeee")
  expect_equal(th$axis, "#CD2626")
  expect_equal(th$fontFamily, "Arial")
  expect_equal(th$fontSize, 14)
  expect_equal(th$categorical, c("#7F7F7F", "green", "#11223380", "var(--x)"))
  expect_equal(as.character(w$x$data$meta$groupColors), "#36648B")
  json <- as.character(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
  expect_match(json, '"categorical":["#7F7F7F","green","#11223380","var(--x)"]',
               fixed = TRUE)
  # A theme given as a named vector.
  v <- km(df, theme = c(foreground = "grey20", fontFamily = "serif"))
  expect_equal(v$x$options$theme[["foreground"]], "#333333")
  expect_equal(v$x$options$theme[["fontFamily"]], "serif")

  lol <- lollipop(
    data.frame(position = c(10, 20), count = c(2, 3),
               class = c("a", "b")),
    length = 100,
    class_colors = c("grey20", "red"),
    domains = data.frame(name = "D", start = 5, end = 40),
    domain_colors = "steelblue4",
    backbone_color = "grey90", stem_color = "grey40"
  )
  expect_equal(as.character(lol$x$data$meta$classColors), c("#333333", "red"))
  expect_equal(as.character(lol$x$data$meta$domainColors), "#36648B")
  expect_equal(lol$x$options$backboneColor, "#E5E5E5")
  expect_equal(lol$x$options$stemColor, "#666666")

  net <- network(
    data.frame(id = c("a", "b"), x = c(0, 1), y = c(0, 1)),
    data.frame(source = "a", target = "b", color = "grey30"),
    layout = "precomputed",
    default_node_color = "firebrick3", default_edge_color = "grey80",
    palette = c("grey20", "#000000")
  )
  expect_equal(net$x$data$columns$color, "#4D4D4D")
  expect_equal(net$x$options$defaultNodeColor, "#CD2626")
  expect_equal(net$x$options$defaultEdgeColor, "#CCCCCC")
  expect_equal(net$x$options$palette, c("#333333", "#000000"))

  vol <- volcano(
    data.frame(x = c(-2, 0, 2), y = c(3, 0.1, 4), label = c("A", "B", "C")),
    colors = list(up = "firebrick3", down = "steelblue4", ns = "grey70")
  )
  expect_equal(vol$x$options$colors,
               list(up = "#CD2626", down = "#36648B", ns = "#B3B3B3"))

  m <- matrix(c(TRUE, FALSE, FALSE, TRUE, TRUE, TRUE), nrow = 3, byrow = TRUE)
  up <- upset(
    data.frame(size = c(40, 25, 12)), sets = c("A", "B"), membership = m,
    bar_color = "grey20", empty_dot_color = "grey85"
  )
  expect_equal(up$x$options$barColor, "#333333")
  expect_equal(up$x$options$emptyDotColor, "#D9D9D9")
})

test_that("oncoplot and spatial colours reach the browser as hex", {
  alt <- data.frame(
    gene = c("TP53", "TP53", "PIK3CA"),
    sample = c("S1", "S2", "S2"),
    class = c("Missense", "Truncating", "Missense"),
    stringsAsFactors = FALSE
  )
  w <- oncoplot(alt,
    classes = c("Missense", "Truncating"),
    class_colors = c("grey20", "steelblue"),
    samples = c("S1", "S2"),
    annotations = list(list(
      name = "Subtype", values = c("A", "B"),
      colors = c(A = "firebrick3", B = "#000000")
    )),
    empty_color = "grey95", burden_color = "grey30",
    frequency_color = "steelblue4"
  )
  expect_equal(as.character(w$x$data$meta$classColors),
               c("#333333", "steelblue"))
  expect_equal(as.character(w$x$data$meta$annotations[[1]]$colors),
               c("#CD2626", "#000000"))
  expect_equal(w$x$options$emptyColor, "#F2F2F2")
  expect_equal(w$x$options$burdenColor, "#4D4D4D")
  expect_equal(w$x$options$frequencyColor, "#36648B")

  s <- spatial(
    data.frame(x = c(1, 2), y = c(1, 2), color = c("T", "N")),
    image = "tissue.png", img_width = 10, img_height = 10,
    colors = c("grey50", "gold")
  )
  expect_equal(as.character(s$x$data$meta$colors), c("#7F7F7F", "gold"))

  p <- bioprofile(data.frame(value = c(1, 2), group = c("a", "b")),
                  group_colors = c("grey20", "grey80"))
  expect_equal(as.character(p$x$data$meta$groupColors),
               c("#333333", "#CCCCCC"))
})

test_that("the KM payload of the browser test is what km() sends", {
  # pkg-js/test/browser/colour-vars.test.ts draws this payload, to check
  # that an R "grey50" draws. It is only in the source tree.
  path <- testthat::test_path(
    "..", "..", "..", "pkg-js", "test", "browser", "fixtures",
    "r-km-grey50.json"
  )
  skip_if_not(file.exists(path))
  w <- km(
    data.frame(
      time = c(0, 5, 10, 0, 5, 10, 0, 5, 10),
      surv = c(1, 0.8, 0.6, 1, 0.7, 0.4, 1, 0.9, 0.85),
      group = rep(c("a", "b", "c"), each = 3)
    ),
    show_ci = FALSE,
    theme = list(categorical = c("#e6194b", "grey50", "#4363d8"))
  )
  sent <- as.character(htmlwidgets:::toJSON(w$preRenderHook(w)$x))
  expect_equal(
    jsonlite::fromJSON(sent, simplifyVector = FALSE),
    jsonlite::fromJSON(path, simplifyVector = FALSE)
  )
})
