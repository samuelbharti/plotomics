#' Hi-C contact matrix
#'
#' A GPU-accelerated Hi-C chromatin contact map. The matrix is uploaded once as
#' a single-channel float texture and drawn as one WebGL quad (via `regl`), with
#' the colormap and log/linear transform applied in the fragment shader, so
#' pan/zoom stays smooth on very large matrices. A precomputed level-of-detail
#' pyramid keeps interaction fast when zoomed out. Axes (genomic coordinate
#' ticks) and the colorbar are drawn as crisp vector overlays. No tile server is
#' required.
#'
#' @param mat Either a square numeric matrix of contact counts, or a data frame
#'   / list giving a sparse COO triplet with integer columns `i`, `j` and a
#'   numeric `v`. When a triplet is supplied, `n` must be given (or inferable
#'   from `max(i, j) + 1`).
#' @param n Number of bins per axis. Required for the sparse (i/j/v) form;
#'   ignored for a dense matrix (taken from `nrow(mat)`).
#' @param bin_size Genomic bin size in base pairs; used to label axes in
#'   bp/kb/Mb. `NULL` labels axes by bin index.
#' @param chrom Optional chromosome name shown as the axis title.
#' @param colormap Sequential colormap for intensity: `"viridis"` or `"rdbu"`.
#' @param transform Intensity transform, `"log"` (default) or `"linear"`.
#' @param vmax Upper clip of the intensity scale; `NULL` auto-picks a high
#'   percentile.
#' @param vmax_percentile Percentile in `(0, 1]` used to auto-pick `vmax` when
#'   `vmax` is `NULL`. `NULL` uses the component default.
#' @param vmin Lower clip of the intensity scale.
#' @param symmetric Mirror sparse `i`/`j`/`v` entries across the diagonal.
#' @param label Axis title (overrides `chrom` when set).
#' @param theme Optional named list of theme overrides (colors, fonts, ...)
#'   merged over the component defaults in the browser. `NULL` uses the default
#'   theme.
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
                colormap = c("viridis", "rdbu"),
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
  if (!is.null(bin_size)) meta$binSize <- as.numeric(bin_size)
  if (!is.null(chrom)) meta$chrom <- as.character(chrom)

  options <- list(
    colormap = colormap,
    transform = transform,
    vmin = vmin,
    symmetric = isTRUE(symmetric)
  )
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
