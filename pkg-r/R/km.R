#' Kaplan-Meier survival curves with a number-at-risk table
#'
#' A right-continuous step curve per stratum, censoring ticks, an optional
#' pointwise confidence band, and the number-at-risk table underneath. The table
#' is on by default because a survival curve without one hides how much of its
#' tail rests on a handful of patients, which is where readers over-read it.
#'
#' The widget draws, it does not estimate. Pass a `survfit` object and the
#' estimates are read off it; pass a data frame and they are used as given. Both
#' routes mean the numbers on screen are the ones your model produced, so a
#' figure rendered here and the same figure rendered by `plot()` cannot disagree
#' about where a curve steps.
#'
#' @param data Either a `survival::survfit` object, or a data frame with numeric
#'   `time` and `surv` columns and optional `lower`, `upper` and `group`
#'   columns. Within a stratum, rows must be in ascending time order.
#' @param groups Character vector fixing the stratum order and colour
#'   assignment. Defaults to order of appearance.
#' @param group_colors One hex colour per stratum. `NULL` uses the component's
#'   categorical palette.
#' @param risk_times Numeric vector of times for the at-risk table, also used as
#'   the x-axis ticks. `NULL` picks an even grid across the follow-up.
#' @param risk_counts Integer matrix, strata x `risk_times`. Computed from a
#'   `survfit` object automatically; required alongside `risk_times` when you
#'   pass a data frame and want the table.
#' @param p_label Optional annotation drawn inside the panel, e.g.
#'   `"log-rank p = 0.02"`. Not computed here: pass what your test returned.
#' @param show_ci,show_censors,show_risk_table,show_legend Toggle the confidence
#'   band, censoring ticks, at-risk table and legend.
#' @param y_from_zero Start the y axis at zero. Opt-out rather than automatic:
#'   zooming y exaggerates separation between curves.
#' @param line_width Curve stroke width in pixels.
#' @param x_label,y_label Axis titles.
#' @param theme Optional named list of theme overrides.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @return An `htmlwidget` object.
#' @examples
#' df <- data.frame(
#'   time = c(0, 5, 12, 0, 7, 15),
#'   surv = c(1, 0.9, 0.7, 1, 0.8, 0.5),
#'   group = rep(c("treated", "control"), each = 3)
#' )
#' km(df)
#' @export
km <- function(data,
               groups = NULL,
               group_colors = NULL,
               risk_times = NULL,
               risk_counts = NULL,
               p_label = NULL,
               show_ci = TRUE,
               show_censors = TRUE,
               show_risk_table = TRUE,
               show_legend = TRUE,
               y_from_zero = TRUE,
               line_width = 2,
               x_label = "months",
               y_label = "overall survival",
               theme = NULL,
               width = NULL,
               height = NULL,
               element_id = NULL) {
  censor <- NULL
  if (inherits(data, "survfit")) {
    tidied <- bv_tidy_survfit(data, risk_times)
    censor <- tidied$censor
    if (is.null(risk_times)) risk_times <- tidied$risk_times
    if (is.null(risk_counts)) risk_counts <- tidied$risk_counts
    data <- tidied$curves
  }
  if (!is.data.frame(data)) {
    stop("`data` must be a data frame or a survfit object.", call. = FALSE)
  }
  if (is.null(data$time) || is.null(data$surv)) {
    stop("`data` must contain `time` and `surv` columns.", call. = FALSE)
  }
  bv_require_nonempty(nrow(data), "data")

  time <- bv_require_numeric(data$time, "time")
  bv_check_finite(time, "time")
  surv <- bv_require_numeric(data$surv, "surv")
  bv_check_finite(surv, "surv")
  if (any(surv < 0 | surv > 1)) {
    stop("`surv` must be a probability in [0, 1].", call. = FALSE)
  }
  columns <- list(time = time, surv = surv)
  if (!is.null(data$lower)) columns$lower <- bv_require_numeric(data$lower, "lower")
  if (!is.null(data$upper)) columns$upper <- bv_require_numeric(data$upper, "upper")

  grp <- if (!is.null(data$group)) as.character(data$group) else NULL
  if (!is.null(grp)) columns$group <- grp

  meta <- list()
  # A factor group column is the caller stating the stratum order; honour it.
  if (is.null(groups) && !is.null(data$group)) {
    groups <- if (is.factor(data$group)) levels(data$group) else unique(grp)
  }
  if (!is.null(groups)) {
    groups <- as.character(groups)
    unknown <- setdiff(unique(grp), groups)
    if (length(unknown) > 0L) {
      stop(sprintf(
        "stratum/strata not present in `groups`: %s",
        paste(unknown, collapse = ", ")
      ), call. = FALSE)
    }
    meta$groups <- I(groups)
    if (!is.null(group_colors)) {
      if (length(group_colors) != length(groups)) {
        stop("`group_colors` must have one entry per stratum.", call. = FALSE)
      }
      meta$groupColors <- I(as.character(group_colors))
    }
  }

  if (!is.null(censor) && nrow(censor) > 0L) {
    meta$censorTime <- I(as.numeric(censor$time))
    meta$censorSurv <- I(as.numeric(censor$surv))
    meta$censorGroup <- I(as.character(censor$group))
  }

  if (!is.null(risk_times)) {
    meta$riskTimes <- I(as.numeric(risk_times))
    if (!is.null(risk_counts)) {
      m <- as.matrix(risk_counts)
      if (ncol(m) != length(risk_times)) {
        stop("`risk_counts` must have one column per `risk_times` entry.",
             call. = FALSE)
      }
      if (!is.null(groups) && nrow(m) != length(groups)) {
        stop("`risk_counts` must have one row per stratum.", call. = FALSE)
      }
      # Row-major: the component indexes it as group * ntimes + j.
      meta$riskCounts <- I(as.integer(t(m)))
    }
  }
  if (!is.null(p_label)) meta$pLabel <- as.character(p_label)[1]

  options <- list(
    showCI = show_ci,
    showCensors = show_censors,
    showRiskTable = show_risk_table,
    showLegend = show_legend,
    yFromZero = y_from_zero,
    lineWidth = line_width,
    xLabel = x_label,
    yLabel = y_label
  )
  if (!is.null(theme)) options$theme <- theme

  plotomics_widget(
    "km", columns,
    meta = meta,
    options = options,
    width = width, height = height, element_id = element_id
  )
}

#' Read curves, censoring times and at-risk counts off a survfit object
#'
#' Reads the list elements `survival::survfit` populates, so it needs the
#' object but not the package attached.
#'
#' @param fit A `survfit` object.
#' @param risk_times Optional time grid; `NULL` picks an even grid.
#' @return A list with `curves`, `censor`, `risk_times` and `risk_counts`.
#' @noRd
bv_tidy_survfit <- function(fit, risk_times = NULL) {
  n <- length(fit$time)
  # A fit with no `strata` is a single unstratified curve.
  group <- if (is.null(fit$strata)) {
    rep("all", n)
  } else {
    # Strata names arrive as "subtype=LumA"; the variable name is noise here.
    labs <- sub("^[^=]*=", "", names(fit$strata))
    rep(labs, times = as.integer(fit$strata))
  }
  levs <- unique(group)

  curves <- data.frame(
    time = as.numeric(fit$time),
    surv = as.numeric(fit$surv),
    group = factor(group, levels = levs),
    stringsAsFactors = FALSE
  )
  if (!is.null(fit$lower)) curves$lower <- as.numeric(fit$lower)
  if (!is.null(fit$upper)) curves$upper <- as.numeric(fit$upper)

  # Every curve starts at 1 before the first event; survfit does not store that
  # row, and without it the step begins partway down.
  starts <- do.call(rbind, lapply(levs, function(g) {
    row <- curves[curves$group == g, , drop = FALSE][1, , drop = FALSE]
    row$time <- 0
    row$surv <- 1
    if (!is.null(row$lower)) row$lower <- 1
    if (!is.null(row$upper)) row$upper <- 1
    row
  }))
  curves <- rbind(starts, curves)
  curves <- curves[order(curves$group, curves$time), , drop = FALSE]

  censor <- if (!is.null(fit$n.censor)) {
    keep <- fit$n.censor > 0
    data.frame(
      time = as.numeric(fit$time[keep]),
      surv = as.numeric(fit$surv[keep]),
      group = group[keep],
      stringsAsFactors = FALSE
    )
  } else {
    NULL
  }

  if (is.null(risk_times)) {
    tmax <- if (n > 0) max(fit$time) else 1
    risk_times <- pretty(c(0, tmax), n = 5)
    risk_times <- risk_times[risk_times <= tmax]
  }

  # n.risk is the count just before each event time, so the number still at
  # risk at grid time t is the one attached to the first step at or after t.
  risk_counts <- t(vapply(levs, function(g) {
    idx <- which(group == g)
    tt <- fit$time[idx]
    nr <- fit$n.risk[idx]
    vapply(risk_times, function(t) {
      j <- which(tt >= t)
      if (length(j) == 0L) 0L else as.integer(nr[j[1]])
    }, integer(1))
  }, integer(length(risk_times))))

  list(curves = curves, censor = censor,
       risk_times = risk_times, risk_counts = risk_counts)
}

#' Shiny bindings for km
#'
#' Output and render functions for using [km()] within Shiny applications and
#' interactive R Markdown / Quarto documents.
#'
#' @param output_id Output variable to read from.
#' @param width,height Element size, passed to
#'   [htmlwidgets::shinyWidgetOutput()].
#' @param expr An expression that generates a [km()] widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Defaults to `FALSE`.
#' @return `kmOutput()` returns a Shiny output UI element; `renderKm()` returns
#'   a Shiny render function.
#' @name km-shiny
#' @export
kmOutput <- function(output_id, width = "100%", height = "520px") {
  htmlwidgets::shinyWidgetOutput(output_id, "km", width, height,
    package = "plotomics"
  )
}

#' @rdname km-shiny
#' @export
renderKm <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  }
  htmlwidgets::shinyRenderWidget(expr, kmOutput, env, quoted = TRUE)
}
