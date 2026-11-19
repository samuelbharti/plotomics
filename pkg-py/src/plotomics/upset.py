"""UpSet set-intersection widget."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _column,
    _reject_lazy,
    _to_float64,
    pack_columns,
)


class Upset(PlotomicsWidget):
    """Set intersections as a bar chart over a membership matrix.

    Venn diagrams stop being readable at four sets and stop being drawable at
    five. UpSet replaces the areas with an explicit matrix, so it scales to
    dozens of sets and stays exact.

    Intersections are **exclusive**: a column counts the elements in precisely
    that combination of sets and no others. That is what makes the columns sum
    to the union rather than double-counting, and it is why a small ``A + B``
    bar next to large ``A`` and ``B`` bars is evidence of mutual exclusivity
    rather than an artefact.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping with a numeric ``size`` column, one
        row per intersection, in the order to draw them.
    sets:
        Set names, top to bottom.
    membership:
        Boolean or 0/1 array shaped (intersections, sets).
    set_sizes:
        Per-set totals for the left-hand bars.
    total:
        Universe size, shown in the corner.
    bar_fraction:
        Fraction of the height given to the intersection bars.
    show_set_sizes:
        Draw the per-set total bars.
    dot_radius:
        Matrix dot radius in pixels.
    bar_color, empty_dot_color:
        Fills for the bars and filled dots, and for dots not in the
        intersection. ``None`` uses the theme.
    y_label:
        Axis label for the intersection bars.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np, pandas as pd
    >>> m = np.array([[1, 0], [0, 1], [1, 1]])
    >>> Upset(pd.DataFrame({"size": [40, 25, 12]}), sets=["A", "B"],
    ...       membership=m)  # doctest: +SKIP
    """

    _esm = STATIC / "upset.js"

    def __init__(
        self,
        data: Any,
        *,
        sets: list[str],
        membership: Any,
        set_sizes: Any = None,
        total: float | None = None,
        bar_fraction: float = 0.55,
        show_set_sizes: bool = True,
        dot_radius: float = 5.0,
        bar_color: str | None = None,
        empty_dot_color: str | None = None,
        y_label: str = "intersection size",
        theme: dict | None = None,
        height: int = 520,
        **kwargs: Any,
    ) -> None:
        col = _column(data, "size")
        if col is None:
            raise ValueError("`data` must provide a `size` column.")
        # float64, so a count past 2**24 arrives exact, as it does from R.
        size = _to_float64(col, "size")
        if size.size == 0:
            raise ValueError("`data` must contain at least one row.")

        names = [str(s) for s in sets]
        if not names:
            raise ValueError("`sets` must name at least one set.")

        m = np.atleast_2d(np.asarray(membership)).astype(int)
        if m.shape[0] != size.size:
            raise ValueError("`membership` must have one row per intersection.")
        if m.shape[1] != len(names):
            raise ValueError("`membership` must have one column per set.")

        buffer, schema = pack_columns({"size": size})

        meta: dict[str, Any] = {
            "sets": names,
            # Row-major: the component indexes it as intersection * nSets + set.
            "membership": [int(v) for v in m.reshape(-1)],
        }
        if set_sizes is not None:
            sizes = [float(v) for v in np.asarray(set_sizes).reshape(-1)]
            if len(sizes) != len(names):
                raise ValueError("`set_sizes` must have one entry per set.")
            meta["setSizes"] = sizes
        if total is not None:
            meta["total"] = float(total)

        options: dict[str, Any] = {
            "barFraction": bar_fraction,
            "showSetSizes": show_set_sizes,
            "dotRadius": dot_radius,
            "yLabel": y_label,
        }
        if bar_color is not None:
            options["barColor"] = str(bar_color)
        if empty_dot_color is not None:
            options["emptyDotColor"] = str(empty_dot_color)
        if theme is not None:
            options["theme"] = theme

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": {}, "meta": meta},
            options=options,
            _height=height,
            **kwargs,
        )


def upset_intersections(m: Any, max_n: int | None = None) -> dict[str, Any]:
    """Exclusive set intersections from a membership table.

    Counts the elements that belong to exactly each combination of sets seen
    in ``m``, as R's ``upset_intersections()`` does, in the same order: the
    largest intersection first, and equal sizes by their membership read as
    0/1 text, so ``"01"`` (only the second set) comes before ``"10"``.
    Elements in no set are left out, since they have no column to sit in.

    Parameters
    ----------
    m:
        A pandas ``DataFrame`` or mapping of arrays: one row per element and
        one boolean or 0/1 column per set, named by the set. A missing value
        counts as not in the set.
    max_n:
        Keep only the ``max_n`` largest intersections. ``None`` keeps all.

    Returns
    -------
    dict
        ``size`` (integer array), ``membership`` (boolean array shaped
        (intersections, sets)), ``sets`` (the set names), ``set_sizes``
        (elements per set) and ``total`` (number of elements), ready for
        :class:`Upset`.

    Examples
    --------
    >>> import pandas as pd
    >>> m = pd.DataFrame({"A": [True, True, False], "B": [True, False, True]})
    >>> r = upset_intersections(m)
    >>> r["size"].tolist(), r["membership"].tolist()
    ([1, 1, 1], [[False, True], [True, False], [True, True]])
    >>> Upset({"size": r["size"]}, sets=r["sets"],  # doctest: +SKIP
    ...       membership=r["membership"], set_sizes=r["set_sizes"],
    ...       total=r["total"])
    """
    if isinstance(m, np.ndarray):
        raise ValueError(
            "`m` must have column names naming the sets: pass a pandas "
            "DataFrame or a dict of columns, not a plain numpy array."
        )
    _reject_lazy(m)
    names = getattr(m, "column_names", None)
    if names is None:
        names = m.keys() if isinstance(m, Mapping) else getattr(m, "columns", None)
    names = list(names) if names is not None else []
    if not names:
        raise ValueError("`m` must have column names naming the sets.")

    cols = [_in_set(m[name], str(name)) for name in names]
    sizes = {c.size for c in cols}
    if len(sizes) > 1:
        raise ValueError("every column of `m` must have the same length.")
    mat = np.column_stack(cols)
    sets = [str(name) for name in names]
    total = int(mat.shape[0])
    set_sizes = mat.sum(axis=0).astype(np.int64)

    hit = mat[mat.any(axis=1)]
    if hit.shape[0] == 0:
        return {
            "size": np.zeros(0, dtype=np.int64),
            "membership": np.zeros((0, len(sets)), dtype=bool),
            "sets": sets,
            "set_sizes": set_sizes,
            "total": total,
        }
    # Distinct rows in 0/1 text order (False before True), then the largest
    # first; the stable sort keeps that text order for equal sizes, as R's
    # sort(table(keys), decreasing = TRUE) does.
    patterns, counts = np.unique(hit, axis=0, return_counts=True)
    order = np.argsort(-counts, kind="stable")
    if max_n is not None:
        order = order[:max_n]
    return {
        "size": counts[order].astype(np.int64),
        "membership": patterns[order].astype(bool),
        "sets": sets,
        "set_sizes": set_sizes,
        "total": total,
    }


def _in_set(values: Any, name: str) -> np.ndarray:
    """A membership column as booleans; a missing value is not in the set.

    As R's ``as.logical`` on a number: zero is FALSE, any other number TRUE.
    """
    to_numpy = getattr(values, "to_numpy", None)
    try:
        if to_numpy is not None and hasattr(values, "dtype"):
            try:
                num = np.asarray(to_numpy(dtype=np.float64, na_value=np.nan))
            except TypeError:
                num = np.asarray(to_numpy(), dtype=np.float64)
        else:
            num = np.asarray(values, dtype=np.float64)
    except (TypeError, ValueError):
        raise ValueError(
            f"column '{name}' of `m` must be logical or 0/1."
        ) from None
    num = num.reshape(-1)
    return np.where(np.isnan(num), False, num != 0)
