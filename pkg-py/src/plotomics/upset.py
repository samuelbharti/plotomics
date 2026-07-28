"""UpSet set-intersection widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


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
        Optional theme overrides forwarded to the JS renderer.
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
        size = _to_float32(col, "size")
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
