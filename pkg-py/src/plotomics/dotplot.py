"""Marker gene dot plot widget."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Dotplot(PlotomicsWidget):
    """Features down the rows, groups across the columns, two channels per dot.

    Dot size is the fraction of the group expressing the gene and dot colour is
    the expression level. Two channels because colour alone cannot separate
    "high in a few cells" from "moderate in all of them", and that distinction
    is usually what decides whether a gene is a marker.

    Dot area, not radius, is proportional to the percentage. Scaling radius
    linearly would quadruple the ink for a doubled percentage, which is the
    classic way a dot plot overstates its strongest cells.

    Rows and columns are drawn in the order given. Sorting genes by the group
    they best mark is an analysis decision, so the component does not do it.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays in long form, one row per
        dot, with ``gene`` and ``cluster`` key columns, a ``pct`` column
        (percent expressing, 0-100) driving dot size, and a ``value`` column
        (expression level) driving dot colour.
    genes, clusters:
        Fix the row and column order. A pandas Categorical supplies it from its
        categories. Defaults to order of appearance.
    value_label, size_label:
        Legend titles.
    colormap:
        Sequential ramp for the colour channel: ``"viridis"``, ``"rdbu"``,
        ``"ltc"`` (an earthy teal to sand to rust sequential ramp) or
        ``"ltcdiv"`` (its diverging counterpart, neutral cream at the midpoint).
    max_radius:
        Radius in pixels of a dot at 100 percent.
    value_domain:
        ``(min, max)`` fixing the colour scale. ``None`` uses the data range.
        Set it when comparing two dot plots side by side.
    show_grid, show_legend:
        Toggle the gridlines and the legends.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> df = pd.DataFrame({
    ...     "gene": ["CD3D", "MS4A1", "CD3D", "MS4A1"],
    ...     "cluster": ["T", "T", "B", "B"],
    ...     "pct": [88, 4, 6, 91],
    ...     "value": [2.4, 0.1, 0.2, 2.7],
    ... })
    >>> Dotplot(df)  # doctest: +SKIP
    """

    _esm = STATIC / "dotplot.js"

    def __init__(
        self,
        data: Any,
        *,
        genes: list[str] | None = None,
        clusters: list[str] | None = None,
        value_label: str = "mean expression",
        size_label: str = "% expressing",
        colormap: Literal["viridis", "rdbu", "ltc", "ltcdiv"] = "viridis",
        max_radius: float = 9.0,
        value_domain: tuple[float, float] | None = None,
        show_grid: bool = True,
        show_legend: bool = True,
        theme: dict | None = None,
        height: int = 560,
        **kwargs: Any,
    ) -> None:
        gene = _column(data, "gene")
        cluster = _column(data, "cluster")
        pct_col = _column(data, "pct")
        value_col = _column(data, "value")
        missing = [
            name
            for name, col in (
                ("gene", gene), ("cluster", cluster),
                ("pct", pct_col), ("value", value_col),
            )
            if col is None
        ]
        if missing:
            raise ValueError("`data` is missing column(s): " + ", ".join(missing))

        pct = _to_float32(pct_col, "pct")
        value = _to_float32(value_col, "value")
        if pct.size == 0:
            raise ValueError("`data` must contain at least one row.")
        if np.any(pct < 0) or np.any(pct > 100):
            raise ValueError("`pct` must be a percentage in [0, 100].")

        buffer, schema = pack_columns({"pct": pct, "value": value})
        json_columns: dict[str, list] = {
            "gene": [str(v) for v in gene],
            "cluster": [str(v) for v in cluster],
        }

        # A pandas Categorical is the caller stating the order they want, which
        # for a dot plot is the point: the diagonal only appears under one.
        def categories_of(col: Any) -> list[str] | None:
            cats = getattr(getattr(col, "dtype", None), "categories", None)
            return None if cats is None else [str(v) for v in cats]

        if genes is None:
            genes = categories_of(gene)
        if clusters is None:
            clusters = categories_of(cluster)

        meta: dict[str, Any] = {
            "valueLabel": value_label,
            "sizeLabel": size_label,
        }
        for key, order, col in (
            ("genes", genes, json_columns["gene"]),
            ("clusters", clusters, json_columns["cluster"]),
        ):
            if order is None:
                continue
            order = [str(v) for v in order]
            unknown = sorted(set(col) - set(order))
            if unknown:
                raise ValueError(
                    f"value(s) not present in `{key}`: " + ", ".join(unknown[:5])
                )
            meta[key] = order

        options: dict[str, Any] = {
            "colormap": colormap,
            "maxRadius": max_radius,
            "showGrid": show_grid,
            "showLegend": show_legend,
        }
        if value_domain is not None:
            if len(value_domain) != 2:
                raise ValueError("`value_domain` must be length 2.")
            options["valueDomain"] = [float(v) for v in value_domain]
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
