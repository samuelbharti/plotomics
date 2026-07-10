#' Shared input-validation helpers
#'
#' Internal helpers used by every component constructor to keep validation
#' behaviour and error wording consistent across widgets (and parallel to the
#' Python package). They centralize numeric coercion, finiteness, equal-length
#' and non-empty checks so bad input fails loudly and early instead of producing
#' silently-wrong payloads.
#'
#' @keywords internal
#' @noRd
NULL

#' Require a numeric-like column, rejecting factors and characters.
#'
#' A bare `as.numeric()` silently turns a factor into its integer *codes* and a
#' character vector into `NA`s. This guard refuses both and returns a plain
#' double for anything else (integer, logical, double).
#'
#' @param x A vector read from user data.
#' @param name Column name used in the error message.
#' @return `as.numeric(x)`.
#' @keywords internal
#' @noRd
bv_require_numeric <- function(x, name) {
  if (is.factor(x) || is.character(x)) {
    stop(sprintf("`%s` must be numeric, not a factor/character.", name),
      call. = FALSE
    )
  }
  as.numeric(x)
}

#' Warn (once) about non-finite values in a numeric column.
#'
#' Counts `NaN`/`Inf` (and `NA`) entries and, if any, emits a single
#' `warning()` naming the column and the count. Never errors: non-finite values
#' are a data-quality issue, not a fatal one.
#'
#' @param x A numeric vector.
#' @param name Column name used in the warning message.
#' @return `x`, invisibly.
#' @keywords internal
#' @noRd
bv_check_finite <- function(x, name) {
  bad <- sum(!is.finite(x))
  if (bad > 0L) {
    warning(sprintf(
      "`%s` has %d non-finite value(s) (NaN/Inf).", name, bad
    ), call. = FALSE)
  }
  invisible(x)
}

#' Require every named vector in a list to share one length.
#'
#' @param named_list A named list of vectors that must all be equal length.
#' @return `named_list`, invisibly.
#' @keywords internal
#' @noRd
bv_require_len <- function(named_list) {
  lens <- vapply(named_list, length, integer(1))
  if (length(unique(lens)) > 1L) {
    parts <- paste0("`", names(named_list), "` (", lens, ")")
    stop(sprintf(
      "columns must have equal length; got %s.",
      paste(parts, collapse = ", ")
    ), call. = FALSE)
  }
  invisible(named_list)
}

#' Require a non-empty column/matrix input.
#'
#' @param n Row/cell count.
#' @param what Name of the input used in the error message.
#' @return `n`, invisibly.
#' @keywords internal
#' @noRd
bv_require_nonempty <- function(n, what) {
  if (n == 0L) {
    stop(sprintf("`%s` has no rows/cells.", what), call. = FALSE)
  }
  invisible(n)
}

#' Validate a precomputed clustermap leaf order / dendrogram.
#'
#' Accepts either a bare integer leaf order (a length-`n` permutation of
#' `0..n-1`) or a list with a valid `order` and an optional `merges` list (each
#' element carrying `left`, `right` and `height`). Mirrors the JS
#' `normalizePrecomputed` contract so bad structures error in R rather than
#' being silently dropped in the browser.
#'
#' @param x The supplied `row_linkage` / `col_linkage`.
#' @param n Number of leaves on that axis.
#' @param name Argument name used in error messages.
#' @return `x`, invisibly.
#' @keywords internal
#' @noRd
bv_check_linkage <- function(x, n, name) {
  is_valid_order <- function(o) {
    if (!is.numeric(o)) return(FALSE)
    if (length(o) != n || anyNA(o)) return(FALSE)
    if (any(o != floor(o))) return(FALSE)
    o <- as.integer(o)
    all(o >= 0L & o < n) && !anyDuplicated(o)
  }

  if (is.numeric(x)) {
    if (!is_valid_order(x)) {
      stop(sprintf(
        "`%s` leaf order must be a length-%d permutation of 0..%d.",
        name, n, n - 1L
      ), call. = FALSE)
    }
    return(invisible(x))
  }

  if (is.list(x)) {
    if (is.null(x$order)) {
      stop(sprintf(
        "`%s` must supply an `order` (0-based leaf order).", name
      ), call. = FALSE)
    }
    if (!is_valid_order(x$order)) {
      stop(sprintf(
        "`%s$order` must be a length-%d permutation of 0..%d.",
        name, n, n - 1L
      ), call. = FALSE)
    }
    if (!is.null(x$merges)) {
      ok <- is.list(x$merges) && all(vapply(x$merges, function(m) {
        is.list(m) && all(c("left", "right", "height") %in% names(m))
      }, logical(1)))
      if (!ok) {
        stop(sprintf(
          "`%s$merges` must each supply `left`, `right` and `height`.", name
        ), call. = FALSE)
      }
    }
    return(invisible(x))
  }

  stop(sprintf(
    "`%s` must be an integer leaf order or a list with `order`/`merges`.",
    name
  ), call. = FALSE)
}
