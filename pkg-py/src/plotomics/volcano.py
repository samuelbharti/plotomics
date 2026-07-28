"""Volcano plot widget."""

from __future__ import annotations

from typing import Any

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Volcano(PlotomicsWidget):
    """GPU-accelerated volcano plot for differential-expression results.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or a mapping of arrays. Must provide numeric
        ``x`` (log2 fold change) and ``y`` (``-log10`` p-value); an optional
        ``label`` column supplies gene names for tooltips and top-hit labels.
    fc_threshold:
        Absolute log2 fold-change cutoff for calling a hit.
    p_threshold:
        P-value cutoff (applied on the ``-log10`` scale).
    point_size, opacity:
        Point radius (px) and opacity in ``[0, 1]``.
    x_label, y_label:
        Axis titles.
    label_top_n:
        Number of top up- and down-regulated genes to label.
    colors:
        Optional mapping overriding the up / down / not-significant point colors
        (keys ``"up"``, ``"down"``, ``"ns"``). ``None`` keeps the defaults.
    show_threshold_lines:
        Draw the fold-change / p-value threshold guide lines.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np, pandas as pd
    >>> n = 200_000
    >>> df = pd.DataFrame({
    ...     "x": np.random.randn(n),
    ...     "y": np.abs(np.random.randn(n)) * 3,
    ...     "label": [f"GENE{i}" for i in range(n)],
    ... })
    >>> Volcano(df)  # doctest: +SKIP
    """

    _esm = STATIC / "volcano.js"

    def __init__(
        self,
        data: Any,
        *,
        fc_threshold: float = 1.0,
        p_threshold: float = 0.05,
        point_size: float = 3.0,
        opacity: float = 0.8,
        x_label: str = "log2 fold change",
        y_label: str = "-log10 p-value",
        label_top_n: int = 10,
        colors: dict | None = None,
        show_threshold_lines: bool = True,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        x = _column(data, "x")
        y = _column(data, "y")
        if x is None or y is None:
            raise ValueError("`data` must provide `x` and `y` columns.")

        x_arr = _to_float32(x, "x")
        y_arr = _to_float32(y, "y")
        if x_arr.size == 0:
            raise ValueError("`data` must contain at least one row.")

        buffer, schema = pack_columns({"x": x_arr, "y": y_arr})

        json_columns: dict[str, list] = {}
        label = _column(data, "label")
        if label is not None:
            json_columns["label"] = [str(v) for v in label]

        options: dict[str, Any] = {
            "fcThreshold": fc_threshold,
            "pThreshold": p_threshold,
            "pointSize": point_size,
            "opacity": opacity,
            "xLabel": x_label,
            "yLabel": y_label,
            "labelTopN": label_top_n,
            "showThresholdLines": show_threshold_lines,
        }
        if colors is not None:
            options["colors"] = dict(colors)
        if theme is not None:
            options["theme"] = theme

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": {}},
            options=options,
            _height=height,
            **kwargs,
        )
