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
    annotations = list(list(name = "Subtype", values = "LumA"))
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

test_that("scalars in meta and options stay scalars", {
  m <- matrix(5, 1, 1)
  json <- rendered_json(bioheatmap(m))
  expect_match(json, '"nrows":1', fixed = TRUE)
  expect_match(json, '"colormap":"viridis"', fixed = TRUE)
})

test_that("the hook leaves the payload users inspect unchanged", {
  w <- volcano(data.frame(x = 2, y = 5))
  expect_false(inherits(w$x$data$columns$x, "AsIs"))
})
