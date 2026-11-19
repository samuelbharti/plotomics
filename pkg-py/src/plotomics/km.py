"""Kaplan-Meier survival curve widget."""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _category_levels,
    _column,
    _text_or_none,
    _to_float32,
    pack_columns,
)


class Km(PlotomicsWidget):
    """Kaplan-Meier survival curves with a number-at-risk table.

    A right-continuous step curve per stratum, censoring ticks, an optional
    pointwise confidence band, and the number-at-risk table underneath. The
    table is on by default because a survival curve without one hides how much
    of its tail rests on a handful of patients, which is where readers
    over-read it.

    The widget draws, it does not estimate. Pass what your fit produced, from
    ``lifelines``, ``scikit-survival`` or anywhere else, so a figure rendered
    here and the same figure rendered by your library cannot disagree about
    where a curve steps.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays with numeric ``time`` and
        ``surv`` columns and optional ``lower``, ``upper`` and ``group``
        columns. Within a stratum, rows must be in ascending time order. A
        row with a missing ``time`` or ``surv`` (None or NaN) is left out
        with a warning, as in R, so the step before it runs on to the next
        row.
    groups:
        Fixes the stratum order and colour assignment. Defaults to order of
        appearance, or to a pandas Categorical's categories.
    group_colors:
        One hex colour per stratum. ``None`` uses the categorical palette.
    censor:
        Optional mapping with ``time`` and ``surv`` arrays, and an optional
        ``group`` array, marking censoring ticks. R's ``km(censor =)`` takes
        the same columns.
    risk_times:
        Times for the at-risk table, also used as the x-axis ticks.
    risk_counts:
        Array shaped (strata, len(risk_times)) of the number still at risk.
    p_label:
        Optional annotation drawn inside the panel, e.g. ``"log-rank p =
        0.02"``. Not computed here: pass what your test returned.
    show_ci, show_censors, show_risk_table, show_legend:
        Toggle the confidence band, censoring ticks, at-risk table and legend.
    y_from_zero:
        Start the y axis at zero. Opt-out rather than automatic: zooming y
        exaggerates separation between curves.
    line_width:
        Curve stroke width in pixels.
    x_label, y_label:
        Axis titles.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
        Its ``categorical`` entry is an ordered palette, a list of colours
        that go to the strata in order; colours are not matched by name.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> df = pd.DataFrame({
    ...     "time": [0, 5, 12, 0, 7, 15],
    ...     "surv": [1, 0.9, 0.7, 1, 0.8, 0.5],
    ...     "group": ["treated"] * 3 + ["control"] * 3,
    ... })
    >>> Km(df)  # doctest: +SKIP
    """

    _esm = STATIC / "km.js"

    def __init__(
        self,
        data: Any,
        *,
        groups: list[str] | None = None,
        group_colors: list[str] | None = None,
        censor: Any = None,
        risk_times: Any = None,
        risk_counts: Any = None,
        p_label: str | None = None,
        show_ci: bool = True,
        show_censors: bool = True,
        show_risk_table: bool = True,
        show_legend: bool = True,
        y_from_zero: bool = True,
        line_width: float = 2.0,
        x_label: str = "time",
        y_label: str = "overall survival",
        theme: dict | None = None,
        height: int = 520,
        **kwargs: Any,
    ) -> None:
        t = _column(data, "time")
        s = _column(data, "surv")
        if t is None or s is None:
            raise ValueError("`data` must provide `time` and `surv` columns.")

        time = _to_float32(t, "time")
        surv = _to_float32(s, "surv")
        if time.size == 0:
            raise ValueError("`data` must contain at least one row.")

        numeric: dict[str, Any] = {"time": time, "surv": surv}
        for name in ("lower", "upper"):
            col = _column(data, name)
            if col is not None:
                numeric[name] = _to_float32(col, name)
        grp_col = _column(data, "group")
        # A missing group crosses as null (no curve), never as a group "nan".
        grp = _text_or_none(grp_col) if grp_col is not None else None

        # A row with no time or no estimate has no place on the curve. Drawn,
        # it would join its neighbours with a slope; left out, the step
        # before it runs on to the next row. R leaves it out with the same
        # warning. Columns of another length are left to pack_columns, which
        # names them.
        if time.size == surv.size:
            keep = ~(np.isnan(time) | np.isnan(surv))
            if not keep.all():
                warnings.warn(
                    f"Left out {int(keep.size - keep.sum())} row(s) with a "
                    "missing `time` or `surv`.",
                    stacklevel=2,
                )
                if not keep.any():
                    raise ValueError("`data` must contain at least one row.")
                numeric = {
                    k: v[keep] if v.size == keep.size else v
                    for k, v in numeric.items()
                }
                if grp is not None and len(grp) == keep.size:
                    grp = [g for g, k in zip(grp, keep) if k]
        surv = numeric["surv"]
        if np.any(surv < 0) or np.any(surv > 1):
            raise ValueError("`surv` must be a probability in [0, 1].")
        buffer, schema = pack_columns(numeric)

        json_columns: dict[str, list] = {}
        if grp is not None:
            json_columns["group"] = grp

        meta: dict[str, Any] = {}
        if groups is None and grp_col is not None:
            # A pandas Categorical is the caller stating the stratum order.
            cats = _category_levels(grp_col)
            if cats is not None:
                groups = cats
            else:
                seen: list[str] = []
                for g in grp:
                    if g is not None and g not in seen:
                        seen.append(g)
                groups = seen
        if groups is not None:
            groups = [str(g) for g in groups]
            unknown = sorted({g for g in grp or [] if g is not None} - set(groups))
            if unknown:
                raise ValueError(
                    "stratum/strata not present in `groups`: " + ", ".join(unknown)
                )
            meta["groups"] = groups
        # A single curve has one stratum, so its colour is sent too.
        if group_colors is not None:
            n_strata = 1 if groups is None else len(groups)
            if len(group_colors) != n_strata:
                raise ValueError("`group_colors` must have one entry per stratum.")
            meta["groupColors"] = [str(c) for c in group_colors]

        if censor is not None:
            ct = _column(censor, "time")
            cs = _column(censor, "surv")
            if ct is None or cs is None:
                # R stops too; leaving the ticks out would hide the mistake.
                raise ValueError(
                    "`censor` must provide `time` and `surv` columns."
                )
            meta["censorTime"] = [float(v) for v in ct]
            meta["censorSurv"] = [float(v) for v in cs]
            cg = _column(censor, "group")
            if cg is not None:
                # A tick with no group is left out, like its curve.
                meta["censorGroup"] = _text_or_none(cg)

        if risk_times is not None:
            times = [float(v) for v in risk_times]
            meta["riskTimes"] = times
            if risk_counts is not None:
                counts = np.atleast_2d(np.asarray(risk_counts))
                if counts.shape[1] != len(times):
                    raise ValueError(
                        "`risk_counts` must have one column per `risk_times` entry."
                    )
                if groups is not None and counts.shape[0] != len(groups):
                    raise ValueError(
                        "`risk_counts` must have one row per stratum."
                    )
                # A DataFrame indexed by stratum is put in `groups` order, as
                # R does with a matrix that has row names.
                index = getattr(risk_counts, "index", None)
                if (
                    groups is not None
                    and hasattr(risk_counts, "iloc")
                    and type(index).__name__ != "RangeIndex"
                ):
                    labels = [str(v) for v in index]
                    if len(set(labels)) == len(labels) and set(labels) == set(groups):
                        counts = counts[[labels.index(g) for g in groups]]
                # Row-major: the component indexes it as group * ntimes + j.
                meta["riskCounts"] = [int(v) for v in counts.reshape(-1)]

        if p_label is not None:
            meta["pLabel"] = str(p_label)

        options: dict[str, Any] = {
            "showCI": show_ci,
            "showCensors": show_censors,
            "showRiskTable": show_risk_table,
            "showLegend": show_legend,
            "yFromZero": y_from_zero,
            "lineWidth": line_width,
            "xLabel": x_label,
            "yLabel": y_label,
        }
        if theme is not None:
            options["theme"] = theme

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": meta},
            options=options,
            _height=height,
            **kwargs,
        )
