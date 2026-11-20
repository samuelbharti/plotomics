#' Hi-C contact matrix
#'
#' A GPU-accelerated Hi-C chromatin contact map. The matrix is normalized to an
#' 8-bit texture and drawn as one WebGL quad (via `regl`), with the colormap
#' applied in the fragment shader, so pan/zoom stays smooth on very large
#' matrices. A precomputed level-of-detail pyramid keeps interaction fast when
#' zoomed out. Axes (genomic coordinate ticks) and the colorbar are drawn as
#' crisp vector overlays. No tile server is required.
#'
#' @param mat Either a square numeric matrix of contact counts, or a data frame
#'   / list giving a sparse COO triplet with integer columns `i`, `j` and a
#'   numeric `v`. When a triplet is supplied, `n` must be given (or inferable
#'   from `max(i, j) + 1`).
#' @param n Number of bins per axis. Required for the sparse (i/j/v) form;
#'   ignored for a dense matrix (taken from `nrow(mat)`).
#' @param bin_size Genomic bin size in base pairs, a positive number; used to
#'   label axes in bp/kb/Mb. `NULL` (or `NA`) labels axes by bin index.
#' @param chrom Optional chromosome name shown as the axis title.
#' @param colormap Colormap for intensity: sequential `"viridis"` (the
#'   default) or `"ltc"` (an earthy teal to sand to rust ramp), or diverging
#'   `"rdbu"` or `"ltcdiv"` (its counterpart, neutral cream at the midpoint).
#' @param transform Intensity transform, `"log"` (default) or `"linear"`.
#' @param vmax Upper clip of the intensity scale: a finite number greater
#'   than `vmin`, and greater than 0 with the log transform. `NULL` (or `NA`)
#'   auto-picks a high percentile.
#' @param vmax_percentile Percentile in `(0, 1]` used to auto-pick `vmax` when
#'   `vmax` is `NULL`. `NULL` (or `NA`) uses the component default.
#' @param vmin Lower clip of the intensity scale, a finite number. `NULL` (or
#'   `NA`) uses 0. With the log transform, or when `vmin` is 0 or more, values
#'   at or below it are drawn as background. With the linear transform and a
#'   negative `vmin` (for example observed/expected log2 ratios), values below
#'   it take the lowest color.
#' @param symmetric Mirror sparse `i`/`j`/`v` entries across the diagonal:
#'   `TRUE` or `FALSE`.
#' @param label Axis title (overrides `chrom` when set).
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
#'   Its `padding` entry is the space in px between the edge of the widget
#'   and the plot: one number for every side, or numbers named `top`,
#'   `right`, `bottom` and `left` in a list or vector, a side left out
#'   keeping the default of 10.
#'   A colour given as a CSS custom property, such as
#'   `background = "var(--bg)"`, takes the value the page gives it when the
#'   plot draws. After the page changes the property, what the plot drew on
#'   a canvas keeps the old colour until it draws again: resize the widget
#'   or render it again.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' set.seed(1)
#' n <- 200
#' # distance-decay background contact matrix
#' d <- abs(outer(seq_len(n), seq_len(n), `-`))
#' m <- 1000 / (d + 1)^1.2 + matrix(runif(n * n), n, n)
#' m <- (m + t(m)) / 2 # symmetrize
#' hic(m, bin_size = 10000, chrom = "chr1")
#' @export
hic <- function(mat,
                n = NULL,
                bin_size = NULL,
                chrom = NULL,
                colormap = c("viridis", "rdbu", "ltc", "ltcdiv"),
                transform = c("log", "linear"),
                vmax = NULL,
                vmax_percentile = NULL,
                vmin = 0,
                symmetric = TRUE,
                label = NULL,
                theme = NULL,
                width = NULL,
                height = NULL,
                element_id = NULL) {
  colormap <- match.arg(colormap)
  transform <- match.arg(transform)
  bin_size <- hic_number(
    bin_size, "bin_size", "a single positive number", function(v) v > 0
  )
  vmin <- hic_number(vmin, "vmin")
  vmax <- hic_number(vmax, "vmax")
  vmax_percentile <- hic_number(
    vmax_percentile, "vmax_percentile", "in (0, 1]", function(v) v > 0 && v <= 1
  )
  # A vmax at or below the bottom of the scale leaves every cell background.
  if (!is.null(vmax)) {
    if (vmax <= (if (is.null(vmin)) 0 else vmin)) {
      stop("`vmax` must be greater than `vmin`.", call. = FALSE)
    }
    if (transform == "log" && vmax <= 0) {
      stop("`vmax` must be greater than 0 with the log transform.",
        call. = FALSE
      )
    }
  }
  if (!is.logical(symmetric) || length(symmetric) != 1L || is.na(symmetric)) {
    stop("`symmetric` must be a single true or false value.", call. = FALSE)
  }
  # A plain TRUE or FALSE: a name or a dim would reach the browser as an
  # object or an array, which reads as true.
  symmetric <- isTRUE(symmetric)

  columns <- list()
  if (is.matrix(mat) || (is.array(mat) && length(dim(mat)) == 2)) {
    if (nrow(mat) != ncol(mat)) {
      stop("`mat` must be a square matrix.", call. = FALSE)
    }
    n <- nrow(mat)
    bv_require_nonempty(n, "mat")
    # Row-major (C order) flatten to match the JS `values` contract.
    columns$values <- bv_require_numeric(as.vector(t(mat)), "mat")
    bv_check_finite(columns$values, "mat")
  } else if (is.data.frame(mat) || is.list(mat)) {
    i <- mat[["i"]]
    j <- mat[["j"]]
    v <- mat[["v"]]
    if (is.null(i) || is.null(j) || is.null(v)) {
      stop(
        "Sparse `mat` must provide `i`, `j` and `v` columns.",
        call. = FALSE
      )
    }
    i <- bv_require_numeric(i, "i")
    j <- bv_require_numeric(j, "j")
    v <- bv_require_numeric(v, "v")
    bv_require_len(list(i = i, j = j, v = v))
    # Guard the empty-triplet trap: `max(integer(0))` is -Inf; require rows
    # before inferring `n` from the indices.
    bv_require_nonempty(length(i), "i/j/v")
    # A contact with no row or no column index has no cell. Before this
    # check, `max()` and the range check below met the NA and stopped with
    # "missing value where TRUE/FALSE needed". Python stops with the same
    # message.
    for (name in c("i", "j")) {
      bad <- sum(!is.finite(if (name == "i") i else j))
      if (bad > 0L) {
        stop(sprintf(paste0(
          "`%s` has %d missing or infinite value(s); every contact needs ",
          "an `i` and a `j` index."
        ), name, bad), call. = FALSE)
      }
    }
    bv_check_finite(v, "v")
    i <- as.integer(i)
    j <- as.integer(j)
    if (is.null(n)) {
      n <- max(i, j) + 1L
    }
    n <- as.integer(n)
    if (any(i < 0L) || any(i >= n) || any(j < 0L) || any(j >= n)) {
      stop(sprintf(
        "hi-c `i`/`j` indices must be in [0, n) = [0, %d).", n
      ), call. = FALSE)
    }
    columns$i <- i
    columns$j <- j
    columns$v <- as.numeric(v)
  } else {
    stop(
      "`mat` must be a square matrix or a list/data frame with i/j/v.",
      call. = FALSE
    )
  }

  meta <- list(n = as.integer(n))
  if (!is.null(bin_size)) meta$binSize <- bin_size
  if (!is.null(chrom)) meta$chrom <- as.character(chrom)

  options <- list(
    colormap = colormap,
    transform = transform,
    symmetric = symmetric
  )
  if (!is.null(vmin)) options$vmin <- vmin
  # `vmax = NULL` means auto; only send it when the user fixed it.
  if (!is.null(vmax)) options$vmax <- vmax
  if (!is.null(vmax_percentile)) options$vmaxPercentile <- vmax_percentile
  if (!is.null(label)) options$label <- as.character(label)
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "hic", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Shiny bindings for hic
#'
#' Output and render functions for using [hic()] within Shiny applications and
#' interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [hic()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `hicOutput()` returns a Shiny output UI element; `renderHic()`
#'   returns a Shiny render function.
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(hicOutput("h"))
#'   server <- function(input, output) {
#'     output$h <- renderHic({
#'       hic(matrix(runif(100), 10, 10))
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
#' @name hic-shiny
#' @export
hicOutput <- function(output_id, width = "100%", height = "480px") {
  htmlwidgets::shinyWidgetOutput(output_id, "hic", width, height,
    package = "plotomics"
  )
}

#' @rdname hic-shiny
#' @export
renderHic <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, hicOutput, env, quoted = TRUE)
}

#' One number for a hic() argument, or NULL when it is NULL or NA
#'
#' NA leaves the argument unset, as NULL does. NaN, an infinite value, text,
#' a factor, more than one value, or a value `ok()` refuses stops with
#' "`name` must be `what`.".
#' @noRd
hic_number <- function(x, name, what = "a single finite number", ok = NULL) {
  if (is.null(x) ||
    (is.atomic(x) && length(x) == 1L && is.na(x) && !is.nan(x))) {
    return(NULL)
  }
  if (!is.numeric(x) || length(x) != 1L || !is.finite(x) ||
    (!is.null(ok) && !ok(x))) {
    stop(sprintf("`%s` must be %s.", name, what), call. = FALSE)
  }
  # as.numeric() drops a name or a dim, so the browser gets a plain number.
  as.numeric(x)
}
