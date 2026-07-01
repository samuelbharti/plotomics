"""Volcano plot widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, BiovizWidget, _column, pack_columns


class Volcano(BiovizWidget):
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
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        x = _column(data, "x")
        y = _column(data, "y")
        if x is None or y is None:
            raise ValueError("`data` must provide `x` and `y` columns.")

        buffer, schema = pack_columns(
            {
                "x": np.asarray(x, dtype=np.float32),
                "y": np.asarray(y, dtype=np.float32),
            }
        )

        json_columns: dict[str, list] = {}
        label = _column(data, "label")
        if label is not None:
            json_columns["label"] = [str(v) for v in label]

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": {}},
            options={
                "fcThreshold": fc_threshold,
                "pThreshold": p_threshold,
                "pointSize": point_size,
                "opacity": opacity,
                "xLabel": x_label,
                "yLabel": y_label,
                "labelTopN": label_top_n,
            },
            _height=height,
            **kwargs,
        )
