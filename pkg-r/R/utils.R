# Default height in px of each plot, the same in R, Shiny and Python. It
# applies where the page does not set the size: R Markdown, Quarto, Shiny
# and Jupyter. The RStudio viewer and a browser fill the window.
plotomics_heights <- c(
  clustermap = 560, dotplot = 560, embedding = 480, heatmap = 480,
  hic = 480, km = 520, lollipop = 440, network = 480, oncoplot = 560,
  profile = 380, spatial = 560, treemap = 480, upset = 520, violin = 560,
  volcano = 480
)

plotomics_height <- function(name) {
  h <- plotomics_heights[name]
  if (is.na(h)) 480 else unname(h)
}

# The named colours of CSS (CSS Color Module Level 4), in lower case. The
# browser reads these names as CSS defines them. Every other colour name R
# knows, such as "grey20" or "steelblue4", is sent as its hex value; see
# bv_colour().
bv_css_colours <- c(
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige",
  "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
  "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
  "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
  "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
  "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
  "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
  "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred",
  "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen",
  "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink",
  "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
  "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
  "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue",
  "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
  "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace",
  "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
  "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red",
  "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
  "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen"
)

#' Colours as the browser reads them
#'
#' R knows colour names that CSS does not, such as "grey20", "grey50",
#' "steelblue4" and "firebrick3". The browser cannot read them, so the plot
#' left out the marks in such a colour. Each such name is sent as its hex
#' value from [grDevices::col2rgb()], with its alpha when it has one, as
#' "#RRGGBBAA". Everything else is kept as given: hex colours, the names
#' CSS knows (so "green" stays the CSS green, #008000, where R's is
#' #00FF00), `var()`, `rgb()`, `hsl()` and the other colour functions,
#' "none", "transparent", `NA` and `NULL`. A name neither knows is kept too,
#' and the browser names it in a console warning.
#'
#' @param x A character vector, a factor or a list of colours. Names and
#'   `NA` are kept, and any other value comes back as given.
#' @return `x`, each R colour name CSS lacks replaced by its hex value.
#' @keywords internal
#' @noRd
bv_colour <- function(x) {
  if (is.null(x)) return(x)
  if (is.list(x)) return(lapply(x, bv_colour))
  if (is.factor(x)) x <- as.character(x)
  if (!is.character(x)) return(x)
  keep <- c(bv_css_colours, "none", "transparent", "currentcolor")
  word <- !is.na(x) & grepl("^[A-Za-z][A-Za-z0-9 ]*$", x) &
    !(tolower(x) %in% keep)
  for (i in which(word)) {
    rgba <- tryCatch(
      grDevices::col2rgb(x[[i]], alpha = TRUE),
      error = function(e) NULL
    )
    if (is.null(rgba)) next
    hex <- grDevices::rgb(rgba[1L], rgba[2L], rgba[3L], maxColorValue = 255)
    if (rgba[4L] < 255) hex <- paste0(hex, sprintf("%02X", rgba[4L]))
    x[[i]] <- hex
  }
  x
}

#' The colours of a theme as the browser reads them
#'
#' Applies [bv_colour()] to every entry of a theme but `fontFamily`,
#' `fontSize` and `padding`: the background, foreground, muted, grid and
#' axis colours, and each colour of a palette such as `categorical`.
#'
#' @param theme The `theme` option: a list or a named vector, or `NULL`.
#' @return `theme`, its colours converted.
#' @keywords internal
#' @noRd
bv_theme_colours <- function(theme) {
  if (is.null(theme) || is.null(names(theme))) return(theme)
  keys <- setdiff(names(theme), c("", "fontFamily", "fontSize", "padding"))
  if (is.atomic(theme)) {
    theme[keys] <- bv_colour(theme[keys])
    return(theme)
  }
  for (k in keys) {
    if (!is.null(theme[[k]])) theme[[k]] <- bv_colour(theme[[k]])
  }
  theme
}

#' Construct a plotomics htmlwidget
#'
#' Internal helper shared by every component constructor. It assembles the
#' `list(data = list(columns, meta), options)` payload that the JavaScript
#' runtime (`window.plotomics`) expects and hands it to [htmlwidgets::createWidget()].
#' The per-component binding (`inst/htmlwidgets/<name>.js`) and its bundled JS
#' dependency (`inst/htmlwidgets/<name>.yaml`) are picked up automatically by
#' name.
#'
#' @param name Component name; must match the JS factory registered under
#'   `window.plotomics` and the binding/yaml file names.
#' @param columns Named list of equal-length column vectors.
#' @param meta Named list of scalar metadata (labels, level names, ...).
#' @param options Named list of component options (camelCase keys).
#' @param width,height Optional widget dimensions.
#' @param element_id Optional explicit DOM id.
#' @param array_meta,array_options Names of `meta` and `options` entries that
#'   the JavaScript reads as arrays. They stay JSON arrays at any length; see
#'   [bv_keep_arrays()].
#' @return An object of class `htmlwidget`.
#' @keywords internal
#' @noRd
plotomics_widget <- function(name, columns, meta = list(), options = list(),
                          width = NULL, height = NULL, element_id = NULL,
                          array_meta = character(),
                          array_options = character()) {
  # A colour name R knows and CSS lacks, such as "grey20", is sent as hex.
  if (!is.null(options$theme)) {
    options$theme <- bv_theme_colours(options$theme)
  }
  x <- list(
    data = list(columns = columns, meta = meta),
    options = bv_theme_padding(options)
  )

  htmlwidgets::createWidget(
    name = name,
    x = x,
    width = width,
    height = height,
    package = "plotomics",
    elementId = element_id,
    preRenderHook = function(widget) {
      bv_keep_arrays(widget, array_meta, array_options)
    },
    sizingPolicy = htmlwidgets::sizingPolicy(
      browser.fill = TRUE,
      viewer.fill = TRUE,
      knitr.figure = FALSE,
      defaultWidth = "100%",
      defaultHeight = plotomics_height(name),
      padding = 0
    )
  )
}

#' Keep the vectors the JavaScript reads as arrays as JSON arrays
#'
#' htmlwidgets serialises the payload with `auto_unbox = TRUE`, so a vector of
#' length 1 reaches the browser as a bare value: a one-row data frame sends
#' `"x":2` and a single class sends `"classes":"missense"`. The JavaScript then
#' reads the length of a number, or a string one character at a time. Every
#' data column is an array to the JavaScript, and so are the `meta` and
#' `options` entries named by the component, and `theme$categorical`. This
#' marks each of them with [I()] just before the widget is serialised, so the
#' payload a test or a user inspects stays as it was built. The theme is
#' shaped by `bv_theme_json()`.
#'
#' @param widget The widget passed to the `preRenderHook`.
#' @param array_meta,array_options Names of the `meta` and `options` entries to
#'   keep as arrays.
#' @return The widget with those entries marked.
#' @keywords internal
#' @noRd
bv_keep_arrays <- function(widget, array_meta = character(),
                           array_options = character()) {
  x <- widget$x
  x$data$columns <- lapply(x$data$columns, bv_as_array)
  for (k in intersect(array_meta, names(x$data$meta))) {
    x$data$meta[[k]] <- bv_as_array(x$data$meta[[k]])
  }
  for (k in intersect(array_options, names(x$options))) {
    x$options[[k]] <- bv_as_array(x$options[[k]])
  }
  if (!is.null(x$options$theme)) {
    x$options$theme <- bv_theme_json(x$options$theme)
  }
  widget$x <- x
  widget
}

#' Shape a theme for the browser
#'
#' jsonlite sends a named vector as a JSON object, which the JavaScript does
#' not read as a colour, a number or a palette. A palette in
#' `theme$categorical` with names, such as `c(T = "#ff0000", B = "#0000ff")`,
#' would reach the browser as an object, and the plot would fall back to its
#' default palette without a word. So the palette is sent as its colours in
#' the order given, as an array, and every other entry loses its names too.
#' `theme$padding` keeps its shape, set by `bv_theme_padding()`. A theme
#' given as a named vector becomes a list of its entries.
#'
#' @param theme The `theme` option.
#' @return The theme, ready to serialise.
#' @keywords internal
#' @noRd
bv_theme_json <- function(theme) {
  if (is.atomic(theme) && !is.null(names(theme))) {
    theme <- as.list(theme)
  }
  if (!is.list(theme)) {
    return(theme)
  }
  for (k in setdiff(names(theme), c("", "padding"))) {
    v <- theme[[k]]
    if (k == "categorical") {
      if (is.list(v)) v <- unlist(v, use.names = FALSE)
      theme[[k]] <- bv_as_array(unname(v))
    } else if (is.atomic(v) && !is.null(names(v))) {
      theme[[k]] <- unname(v)
    }
  }
  theme
}

#' Check the theme padding and shape it for the browser
#'
#' `theme$padding` is the space in px between the edge of the widget and
#' the plot. A single number of 0 or more sets all four sides and is sent as
#' a JSON number. Numbers named from `top`, `right`, `bottom` and `left`, as
#' a named vector or a named list, set those sides and are sent as a JSON
#' object; jsonlite would drop the names of a vector. Anything else (a
#' negative number, `NA`, `NaN`, `Inf`, text, or another name) is an error,
#' the one Python raises too.
#'
#' @param options Named list of component options.
#' @return `options`, with `theme$padding` as a number or a named list.
#' @keywords internal
#' @noRd
bv_theme_padding <- function(options) {
  theme <- options[["theme"]]
  if (!is.list(theme) || is.null(theme[["padding"]])) {
    return(options)
  }
  options$theme$padding <- bv_padding(theme[["padding"]])
  options
}

#' A padding value as a number or a named list of numbers
#' @noRd
bv_padding <- function(padding) {
  ok <- function(v) {
    is.numeric(v) && !is.factor(v) && length(v) == 1L && is.finite(v) &&
      v >= 0
  }
  nms <- names(padding)
  if (is.null(nms) && !is.list(padding) && ok(padding)) {
    return(as.numeric(padding))
  }
  sides <- if (is.list(padding)) {
    padding
  } else if (is.numeric(padding) && !is.factor(padding)) {
    as.list(padding)
  }
  if (length(sides) > 0L && !is.null(nms) &&
    all(nms %in% c("top", "right", "bottom", "left")) &&
    !anyDuplicated(nms) && all(vapply(sides, ok, logical(1)))) {
    return(lapply(sides, as.numeric))
  }
  stop(
    "`theme$padding` must be a number of 0 or more, or a named list of ",
    "them with names from top, right, bottom and left.",
    call. = FALSE
  )
}

#' Mark an atomic vector with I() so it serialises as a JSON array
#' @noRd
bv_as_array <- function(v) {
  if (is.null(v) || !is.atomic(v) || inherits(v, "AsIs")) v else I(v)
}

#' Distinct text values in code point order
#'
#' `sort()` orders text by the collation of the locale R runs in, so the
#' same data can sort differently on two machines, and differently from
#' Python's `sorted()`. The radix method sorts in the C locale, which for
#' UTF-8 text is code point order: the order Python uses.
#'
#' @param x A character vector.
#' @return The distinct values of `x`, NA left out, in code point order.
#' @keywords internal
#' @noRd
bv_sort_text <- function(x) {
  sort(unique(x), method = "radix")
}

#' Distinct text values, most frequent first
#'
#' Equal counts keep code point order, as Python's
#' `sorted(counts, key=lambda c: (-counts[c], c))` has them.
#'
#' @param x A character vector.
#' @return The distinct values of `x`, NA left out.
#' @keywords internal
#' @noRd
bv_by_frequency <- function(x) {
  x <- x[!is.na(x)]
  levs <- bv_sort_text(x)
  n <- tabulate(match(x, levs), nbins = length(levs))
  levs[order(-n, method = "radix")]
}
