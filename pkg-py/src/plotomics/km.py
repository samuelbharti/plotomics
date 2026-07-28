"""Kaplan-Meier survival curve widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


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
        columns. Within a stratum, rows must be in ascending time order.
    groups:
        Fixes the stratum order and colour assignment. Defaults to order of
        appearance, or to a pandas Categorical's categories.
    group_colors:
        One hex colour per stratum. ``None`` uses the categorical palette.
    censor:
        Optional mapping with ``time``, ``surv`` and ``group`` arrays marking
        censoring ticks.
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
        Optional theme overrides forwarded to the JS renderer.
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
        x_label: str = "months",
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
        if np.any(surv < 0) or np.any(surv > 1):
            raise ValueError("`surv` must be a probability in [0, 1].")

        numeric: dict[str, Any] = {"time": time, "surv": surv}
        for name in ("lower", "upper"):
            col = _column(data, name)
            if col is not None:
                numeric[name] = _to_float32(col, name)
        buffer, schema = pack_columns(numeric)

        json_columns: dict[str, list] = {}
        grp_col = _column(data, "group")
        grp = [str(v) for v in grp_col] if grp_col is not None else None
        if grp is not None:
            json_columns["group"] = grp

        meta: dict[str, Any] = {}
        if groups is None and grp_col is not None:
            # A pandas Categorical is the caller stating the stratum order.
            cats = getattr(getattr(grp_col, "dtype", None), "categories", None)
            if cats is not None:
                groups = [str(v) for v in cats]
            else:
                seen: list[str] = []
                for g in grp:
                    if g not in seen:
                        seen.append(g)
                groups = seen
        if groups is not None:
            groups = [str(g) for g in groups]
            unknown = sorted(set(grp or []) - set(groups))
            if unknown:
                raise ValueError(
                    "stratum/strata not present in `groups`: " + ", ".join(unknown)
                )
            meta["groups"] = groups
            if group_colors is not None:
                if len(group_colors) != len(groups):
                    raise ValueError(
                        "`group_colors` must have one entry per stratum."
                    )
                meta["groupColors"] = [str(c) for c in group_colors]

        if censor is not None:
            ct = _column(censor, "time")
            cs = _column(censor, "surv")
            if ct is not None and cs is not None:
                meta["censorTime"] = [float(v) for v in ct]
                meta["censorSurv"] = [float(v) for v in cs]
                cg = _column(censor, "group")
                if cg is not None:
                    meta["censorGroup"] = [str(v) for v in cg]

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
