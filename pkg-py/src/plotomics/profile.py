"""Grouped categorical bar profile widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _column,
    _na_text,
    _not_in,
    _text_or_none,
    _to_float32,
    pack_columns,
)


class Profile(PlotomicsWidget):
    """An ordered bar profile whose categories collapse into coloured blocks.

    Built for the 96-context mutational signature plot, where the bars are the
    trinucleotide contexts and the six blocks are the substitution classes, a
    layout conventional enough that readers parse it without a legend. It
    generalises to any ordered categorical profile that groups into runs, hence
    the generic name.

    Bars are canvas-drawn, so a few thousand bins (a binned copy-number
    profile, a coverage track) work as well as 96 contexts.

    Bars are drawn in the order given. For SBS96 that order is part of the
    convention, so the component does not sort.

    In R this plot is ``bioprofile()``, with the alias
    ``profile_plotomics()``. A function named ``profile()`` would mask the
    ``stats::profile()`` generic, which profiles a fitted model's
    likelihood, when the R package is attached. Python has no such clash,
    so the class keeps the name ``Profile``.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays with a numeric ``value``
        column. Optional ``group`` (category per bar, whose contiguous runs
        become the header blocks) and ``label`` (per-bar tick label) columns.
    groups:
        Fixes the group order and colour assignment. Defaults to order of
        appearance. A missing group (None or NaN) crosses as null and, as in
        R, is a group of its own, drawn as an unnamed block.
    group_colors:
        One hex colour per group. ``None`` uses the categorical palette.
    title:
        Optional title drawn above the header band.
    bar_width:
        Fraction of each slot the bar occupies, in ``(0, 1]``.
    as_fraction:
        ``True`` to show each value as a share of the total, in place of
        the raw count. Every finite value must then be 0 or more.
    show_header, show_bar_labels:
        Toggle the header band and the tick labels.
    y_label:
        Axis label.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
        Its ``categorical`` entry is an ordered palette, a list of colours
        that go to the groups in order; colours are not matched by name.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> df = pd.DataFrame({
    ...     "value": [3, 5, 2, 8],
    ...     "group": ["C>A", "C>A", "C>T", "C>T"],
    ...     "label": ["ACA", "ACC", "TCA", "TCT"],
    ... })
    >>> Profile(df)  # doctest: +SKIP
    """

    _esm = STATIC / "profile.js"

    def __init__(
        self,
        data: Any,
        *,
        groups: list[str] | None = None,
        group_colors: list[str] | None = None,
        title: str | None = None,
        bar_width: float = 0.62,
        as_fraction: bool = False,
        show_header: bool = True,
        show_bar_labels: bool = True,
        y_label: str = "mutations",
        theme: dict | None = None,
        height: int = 380,
        **kwargs: Any,
    ) -> None:
        val = _column(data, "value")
        if val is None:
            raise ValueError("`data` must provide a `value` column.")
        if not 0 < bar_width <= 1:
            raise ValueError("`bar_width` must be in (0, 1].")
        # One True or False, so the check below and the plot read it alike.
        if not isinstance(as_fraction, (bool, np.bool_)):
            raise ValueError(
                "`as_fraction` must be a single true or false value."
            )
        as_fraction = bool(as_fraction)
        value = _to_float32(val, "value")
        if value.size == 0:
            raise ValueError("`data` must contain at least one row.")
        # Shares of a total with negative values are not defined. The sign
        # is read before the float32 rounding, which turns a value such as
        # -1e-50 into -0, so R and Python stop on the same values.
        if as_fraction:
            try:
                exact = np.asarray(val, dtype=np.float64)
            except (TypeError, ValueError):
                exact = value.astype(np.float64)
            finite = exact[np.isfinite(exact)]
            negative = int(np.count_nonzero(finite < 0))
            if negative:
                raise ValueError(
                    "`as_fraction` needs every `value` to be 0 or more; "
                    f"found {negative} negative value(s)."
                )

        buffer, schema = pack_columns({"value": value})

        json_columns: dict[str, list] = {}
        grp_col = _column(data, "group")
        grp = _text_or_none(grp_col) if grp_col is not None else None
        if grp is not None:
            json_columns["group"] = grp
        lab_col = _column(data, "label")
        if lab_col is not None:
            json_columns["label"] = _text_or_none(lab_col)

        meta: dict[str, Any] = {}
        if groups is None and grp is not None:
            seen: list[str] = []
            for g in grp:
                if g not in seen:
                    seen.append(g)
            groups = seen
        if groups is not None:
            groups = _text_or_none(groups)
            unknown = _not_in(grp or [], groups)
            if unknown:
                raise ValueError(
                    "group(s) not present in `groups`: " + _na_text(unknown)
                )
            meta["groups"] = groups
            if group_colors is not None:
                if len(group_colors) != len(groups):
                    raise ValueError(
                        "`group_colors` must have one entry per group."
                    )
                meta["groupColors"] = [str(c) for c in group_colors]
        if title is not None:
            meta["title"] = str(title)

        options: dict[str, Any] = {
            "barWidth": bar_width,
            "asFraction": as_fraction,
            "showHeader": show_header,
            "showBarLabels": show_bar_labels,
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
