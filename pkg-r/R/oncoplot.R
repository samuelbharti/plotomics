#' Oncoplot (OncoPrint)
#'
#' The cohort alteration landscape: a gene x sample grid of categorical
#' alteration classes, with a per-sample burden barplot above, a per-gene
#' frequency barplot to the right, and optional clinical annotation strips
#' below. The grid is drawn on a canvas, so cohort-scale matrices (hundreds of
#' genes by thousands of samples) stay interactive; labels and the legend are a
#' crisp vector overlay.
#'
#' The component renders rows and columns in exactly the order it is given and
#' uses the burden and frequency values as supplied. Ordering an oncoplot
#' (memo sort, burden sort, sort by a clinical variable) is the caller's
#' decision, and re-deriving it in the browser would let two renderings of the
#' same data disagree. Use [oncoplot_memo_sort()] to get the conventional order.
#'
#' @param alterations A data frame of altered pairs with columns `gene`,
#'   `sample` and `class`. Unaltered pairs are simply absent; the full grid is
#'   reconstructed from `genes` and `samples`.
#' @param genes Character vector of genes, top row first. Defaults to the genes
#'   present in `alterations`, most frequently altered first.
#' @param samples Character vector of samples, left column first. Defaults to
#'   the memo-sorted order.
#' @param classes Character vector of alteration classes, which fixes both the
#'   legend order and the colour assignment. Defaults to the classes present.
#' @param class_colors Character vector of hex colours, one per entry of
#'   `classes`. `NULL` uses the component's categorical palette.
#' @param burden Numeric vector, one value per sample, for the top barplot.
#'   Defaults to the number of altered genes per sample.
#' @param annotations Optional list of clinical strips. Each element is a list
#'   with `name` (character scalar), `values` (one value per sample) and an
#'   optional `colors`.
#' @param show_burden,show_frequency,show_annotations,show_legend Toggle the
#'   surrounding panels.
#' @param empty_color Fill for a gene x sample cell with no alteration.
#' @param theme Optional named list of theme overrides merged over the
#'   component defaults in the browser.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' alt <- data.frame(
#'   gene = c("TP53", "TP53", "PIK3CA", "PIK3CA", "GATA3"),
#'   sample = c("S1", "S2", "S2", "S3", "S1"),
#'   class = c("Missense", "Truncating", "Missense", "Amplification", "Missense")
#' )
#' oncoplot(alt)
#' @export
oncoplot <- function(alterations,
                     genes = NULL,
                     samples = NULL,
                     classes = NULL,
                     class_colors = NULL,
                     burden = NULL,
                     annotations = NULL,
                     show_burden = TRUE,
                     show_frequency = TRUE,
                     show_annotations = TRUE,
                     show_legend = TRUE,
                     empty_color = "#EFE9DC",
                     theme = NULL,
                     width = NULL,
                     height = NULL,
                     element_id = NULL) {
  if (!is.data.frame(alterations)) {
    stop("`alterations` must be a data frame.", call. = FALSE)
  }
  need <- c("gene", "sample", "class")
  if (!all(need %in% names(alterations))) {
    stop("`alterations` must contain columns `gene`, `sample` and `class`.",
      call. = FALSE
    )
  }
  bv_require_nonempty(nrow(alterations), "alterations")

  alt_gene <- as.character(alterations$gene)
  alt_sample <- as.character(alterations$sample)
  alt_class <- as.character(alterations$class)

  if (is.null(classes)) {
    classes <- names(sort(table(alt_class), decreasing = TRUE))
  }
  classes <- as.character(classes)
  unknown <- setdiff(unique(alt_class), classes)
  if (length(unknown) > 0L) {
    stop(sprintf(
      "class(es) not present in `classes`: %s",
      paste(unknown, collapse = ", ")
    ), call. = FALSE)
  }
  if (!is.null(class_colors) && length(class_colors) != length(classes)) {
    stop("`class_colors` must have one entry per class.", call. = FALSE)
  }

  ord <- oncoplot_memo_sort(alterations, genes = genes, samples = samples)
  genes <- ord$genes
  samples <- ord$samples
  nrows <- length(genes)
  ncols <- length(samples)
  bv_require_nonempty(nrows * ncols, "alterations")

  # Row-major integer codes: 0 is unaltered, k is classes[k].
  codes <- integer(nrows * ncols)
  gi <- match(alt_gene, genes)
  si <- match(alt_sample, samples)
  ci <- match(alt_class, classes)
  keep <- !is.na(gi) & !is.na(si) & !is.na(ci)
  codes[(gi[keep] - 1L) * ncols + si[keep]] <- ci[keep]

  mat <- matrix(codes, nrow = nrows, ncol = ncols, byrow = TRUE)
  freq <- round(100 * rowSums(mat > 0L) / ncols, 1)
  if (is.null(burden)) {
    burden <- colSums(mat > 0L)
  } else {
    burden <- bv_require_numeric(burden, "burden")
    if (length(burden) != ncols) {
      stop("`burden` must have one value per sample.", call. = FALSE)
    }
  }

  columns <- list(
    codes = codes,
    tmb = as.numeric(burden),
    freq = as.numeric(freq)
  )

  meta <- list(
    nrows = nrows,
    ncols = ncols,
    genes = genes,
    samples = samples,
    classes = classes
  )
  if (!is.null(class_colors)) meta$classColors <- as.character(class_colors)
  if (!is.null(annotations)) {
    meta$annotations <- lapply(annotations, function(a) {
      if (is.null(a$name) || is.null(a$values)) {
        stop("each annotation needs `name` and `values`.", call. = FALSE)
      }
      if (length(a$values) != ncols) {
        stop(sprintf(
          "annotation '%s' must have one value per sample.", a$name
        ), call. = FALSE)
      }
      f <- factor(as.character(a$values))
      out <- list(
        name = as.character(a$name)[1],
        # I() keeps a single-level annotation from unboxing to a JSON scalar.
        levels = I(levels(f)),
        codes = ifelse(is.na(f), -1L, as.integer(f) - 1L)
      )
      if (!is.null(a$colors)) out$colors <- I(as.character(a$colors))
      out
    })
  }

  options <- list(
    showBurden = show_burden,
    showFrequency = show_frequency,
    showAnnotations = show_annotations,
    showLegend = show_legend,
    emptyColor = empty_color
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "oncoplot", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Conventional oncoplot row and column ordering
#'
#' Genes are ordered by descending alteration frequency, then samples are
#' ordered so that the most frequently altered gene's carriers come first, ties
#' broken by the next gene down. This is the "memo sort" cBioPortal popularised;
#' it is what makes mutual exclusivity between drivers visible as a staircase.
#'
#' Exposed separately so a caller can compute the order once and reuse it for
#' both an interactive [oncoplot()] and a static rendering, rather than letting
#' two implementations tie-break differently.
#'
#' @param alterations A data frame with columns `gene`, `sample` and `class`.
#' @param genes Optional character vector to use instead of the derived gene
#'   order.
#' @param samples Optional character vector to use instead of the derived sample
#'   order.
#' @return A list with `genes` and `samples` character vectors.
#' @export
oncoplot_memo_sort <- function(alterations, genes = NULL, samples = NULL) {
  g <- as.character(alterations$gene)
  s <- as.character(alterations$sample)

  if (is.null(genes)) {
    genes <- names(sort(table(g), decreasing = TRUE))
  } else {
    genes <- as.character(genes)
  }
  if (is.null(samples)) {
    samples <- sort(unique(s))
    hit <- matrix(FALSE, nrow = length(genes), ncol = length(samples),
                  dimnames = list(genes, samples))
    gi <- match(g, genes)
    si <- match(s, samples)
    ok <- !is.na(gi) & !is.na(si)
    hit[cbind(gi[ok], si[ok])] <- TRUE
    # order() with one key per gene row, top gene first, so the top row
    # dominates and later rows only break ties.
    keys <- lapply(seq_len(nrow(hit)), function(i) -as.integer(hit[i, ]))
    samples <- samples[do.call(order, c(keys, list(method = "radix")))]
  } else {
    samples <- as.character(samples)
  }
  list(genes = genes, samples = samples)
}

#' Shiny bindings for oncoplot
#'
#' Output and render functions for using [oncoplot()] within Shiny applications
#' and interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates an [oncoplot()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `oncoplotOutput()` returns a Shiny output UI element;
#'   `renderOncoplot()` returns a Shiny render function.
#' @name oncoplot-shiny
#' @export
oncoplotOutput <- function(output_id, width = "100%", height = "560px") {
  htmlwidgets::shinyWidgetOutput(output_id, "oncoplot", width, height,
    package = "plotomics"
  )
}

#' @rdname oncoplot-shiny
#' @export
renderOncoplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, oncoplotOutput, env, quoted = TRUE)
}
