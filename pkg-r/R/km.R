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
#'   columns. Within a stratum, rows must be in ascending time order. A row
#'   with a missing `time` or `surv` (`NA` or `NaN`) is left out with a
#'   warning, so the step before it runs on to the next row. A `survfit`
#'   stratum is named by its levels alone: `"sex=1, ph.ecog=0"` becomes
#'   `"1, 0"`. A `survfit` of a Cox model with several `newdata` rows draws
#'   one curve per row, named by the row names of `newdata` (`"1"`, `"2"`,
#'   ... unless set).
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
#'   Its `padding` entry is the space in px between the edge of the widget
#'   and the plot: one number for every side, or numbers named `top`,
#'   `right`, `bottom` and `left` in a list or vector, a side left out
#'   keeping the default of 10.
#'   Its `categorical` entry is an ordered palette: the colours go to the strata
#'   in order, and names on the colours are not matched to them.
#' @param width,height Widget dimensions (any valid CSS size).
#' @param element_id Optional explicit DOM id.
#' @param censor Optional data frame of censoring ticks, with numeric `time`
#'   and `surv` columns and an optional `group` column naming each tick's
#'   stratum, as Python's `Km(censor=)` takes. Column names must match
#'   exactly. With a `survfit` object the ticks are read off the fit unless
#'   `censor` is given. It comes last so the arguments before it keep their
#'   positions.
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
               x_label = "time",
               y_label = "overall survival",
               theme = NULL,
               width = NULL,
               height = NULL,
               element_id = NULL,
               censor = NULL) {
  if (inherits(data, "survfit")) {
    tidied <- bv_tidy_survfit(data, risk_times)
    if (is.null(censor)) censor <- tidied$censor
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
  surv <- bv_require_numeric(data$surv, "surv")
  # A row with no time or no estimate has no place on the curve. Drawn, it
  # would join its neighbours with a slope; left out, the step before it runs
  # on to the next row. Python leaves it out with the same warning.
  gone <- is.na(time) | is.na(surv)
  if (any(gone)) {
    warning(sprintf(
      "Left out %d row(s) with a missing `time` or `surv`.", sum(gone)
    ), call. = FALSE)
    data <- as.data.frame(data)[!gone, , drop = FALSE]
    time <- time[!gone]
    surv <- surv[!gone]
    bv_require_nonempty(nrow(data), "data")
  }
  bv_check_finite(time, "time")
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
  # A missing group (NA) is no stratum: its rows draw no curve.
  present <- unique(grp[!is.na(grp)])
  if (is.null(groups) && !is.null(data$group)) {
    groups <- if (is.factor(data$group)) levels(data$group) else present
  }
  if (!is.null(groups)) {
    groups <- as.character(groups)
    unknown <- setdiff(present, groups)
    if (length(unknown) > 0L) {
      stop(sprintf(
        "stratum/strata not present in `groups`: %s",
        paste(unknown, collapse = ", ")
      ), call. = FALSE)
    }
    meta$groups <- I(groups)
  }
  # A single curve has one stratum, so its colour is sent too.
  if (!is.null(group_colors)) {
    n_strata <- if (is.null(groups)) 1L else length(groups)
    if (length(group_colors) != n_strata) {
      stop("`group_colors` must have one entry per stratum.", call. = FALSE)
    }
    meta$groupColors <- I(as.character(group_colors))
  }

  if (!is.null(censor)) {
    # [[ ]] matches names exactly; $ would take a column `times` for
    # `time`, where Python stops.
    if (!is.data.frame(censor) || is.null(censor[["time"]]) ||
        is.null(censor[["surv"]])) {
      stop("`censor` must be a data frame with `time` and `surv` columns.",
           call. = FALSE)
    }
    if (nrow(censor) > 0L) {
      meta$censorTime <- I(bv_require_numeric(censor[["time"]], "censor$time"))
      meta$censorSurv <- I(bv_require_numeric(censor[["surv"]], "censor$surv"))
      # A tick without a group belongs to the only curve, as in Python.
      if (!is.null(censor[["group"]])) {
        meta$censorGroup <- I(as.character(censor[["group"]]))
      }
    }
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
      # Counts read off a survfit carry their stratum as the row name, in the
      # fit's order. The browser reads row g as groups[g], so follow `groups`.
      if (!is.null(groups) && !is.null(rownames(m)) &&
          setequal(rownames(m), groups)) {
        m <- m[groups, , drop = FALSE]
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
  if (is.null(fit$surv)) {
    stop("`data` is a survfit object without survival estimates (`surv`).",
         call. = FALSE)
  }
  n <- length(fit$time)
  # A fit with no `strata` is a single unstratified curve.
  stratum <- if (is.null(fit$strata)) {
    rep("all", n)
  } else {
    rep(bv_strata_labels(names(fit$strata)), times = as.integer(fit$strata))
  }
  # A Cox model predicted for several `newdata` rows holds one column of
  # estimates per row, all at the same times. Each column is a curve of its
  # own, named by its row of `newdata`.
  surv <- as.matrix(fit$surv)
  k <- ncol(surv)
  curve <- colnames(surv)
  if (is.null(curve)) curve <- as.character(seq_len(k))
  group <- if (k == 1L) {
    stratum
  } else if (is.null(fit$strata)) {
    rep(curve, each = n)
  } else {
    paste(rep(stratum, times = k), rep(curve, each = n), sep = ", ")
  }
  levs <- unique(group)
  # Every curve's values one after the other: a matrix column by column, and
  # a vector all curves share (the times, the counts) once for each curve.
  per_curve <- function(v) {
    if (is.null(v)) return(NULL)
    v <- as.matrix(v)
    if (ncol(v) == k) as.numeric(v) else rep(as.numeric(v[, 1L]), times = k)
  }
  time <- rep(as.numeric(fit$time), times = k)
  surv <- as.numeric(surv)
  n_risk <- per_curve(fit$n.risk)
  n_censor <- per_curve(fit$n.censor)

  curves <- data.frame(
    time = time,
    surv = surv,
    group = factor(group, levels = levs),
    stringsAsFactors = FALSE
  )
  if (!is.null(fit$lower)) curves$lower <- per_curve(fit$lower)
  if (!is.null(fit$upper)) curves$upper <- per_curve(fit$upper)

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

  censor <- if (!is.null(n_censor)) {
    keep <- n_censor > 0
    data.frame(
      time = time[keep],
      surv = surv[keep],
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
  counts <- vapply(levs, function(g) {
    idx <- which(group == g)
    tt <- time[idx]
    nr <- n_risk[idx]
    vapply(risk_times, function(t) {
      j <- which(tt >= t)
      if (length(j) == 0L) 0L else as.integer(nr[j[1]])
    }, integer(1))
  }, integer(length(risk_times)))
  # One row per stratum and one column per time, also for a single time,
  # where vapply returns a plain vector.
  risk_counts <- matrix(counts, nrow = length(levs), ncol = length(risk_times),
                        byrow = TRUE, dimnames = list(levs, NULL))

  list(curves = curves, censor = censor,
       risk_times = risk_times, risk_counts = risk_counts)
}

#' Stratum names without their variable names
#'
#' survfit names a stratum after each variable and its level, as in
#' `"sex=1, I(age > 65)=FALSE"`, padded with spaces to a common width. Only
#' the levels are kept, so that one reads `"1, FALSE"`. A variable name may
#' hold `==`, `<=`, `>=` or `!=`, as `I(age >= 65)` does; the `=` that ends
#' the name is the first one that is not part of such an operator.
#'
#' @param x Stratum names, `names(fit$strata)`.
#' @return The levels of each name, joined by ", ".
#' @noRd
bv_strata_labels <- function(x) {
  name <- "(^|, )(?:[^=]|(?<=[<>!])=|==)*?(?<![<>!=])=(?!=)"
  trimws(gsub(name, "\\1", x, perl = TRUE))
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
#' @examples
#' if (interactive() && requireNamespace("shiny", quietly = TRUE)) {
#'   ui <- shiny::fluidPage(kmOutput("surv"))
#'   server <- function(input, output) {
#'     output$surv <- renderKm({
#'       km(data.frame(
#'         time = c(0, 5, 12, 0, 7, 15),
#'         surv = c(1, 0.9, 0.7, 1, 0.8, 0.5),
#'         group = rep(c("treated", "control"), each = 3)
#'       ))
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
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
