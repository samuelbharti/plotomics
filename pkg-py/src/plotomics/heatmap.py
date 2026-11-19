"""Expression heatmap widget."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _as_matrix,
    _check_choice,
    _check_labels,
    pack_columns,
)

_COLORMAPS = ("viridis", "rdbu", "ltc", "ltcdiv")


class Heatmap(PlotomicsWidget):
    """GPU-accelerated heatmap for large expression matrices (samples x genes).

    The matrix is packed as a single row-major ``float32`` column and uploaded
    to the GPU as one texture, colormapped in a fragment shader, so matrices
    with a million or more cells pan and zoom smoothly. The colorbar legend and
    row/column tick labels are drawn as vector overlays. A matrix with more
    rows or columns than the plot has pixels, or than the GPU's texture limit,
    is pooled for drawing: each pixel shows the mean of the cells under it, so
    a lone outlier row still shows, fainter the more rows share its pixel.

    Parameters
    ----------
    matrix:
        A 2-D ``numpy`` array, nested list or ``pandas`` DataFrame of shape
        ``(nrows, ncols)``. For a DataFrame, the index becomes the row labels
        and the columns become the column labels. A missing cell (NaN, or NA
        in a nullable column) is drawn grey and left out of the colour range
        and the z-score. Where several rows or columns share a pixel, the
        pixel shows the mean of their finite cells, so it is grey only when
        all of them are missing.
    colormap:
        Color ramp: sequential ``"viridis"`` or ``"ltc"`` (an earthy teal to
        sand to rust ramp), or diverging ``"rdbu"`` or ``"ltcdiv"`` (its
        counterpart, neutral cream at the midpoint). ``None`` (the default)
        uses ``"rdbu"`` when ``z_score`` is on, so values above and below the
        row mean get opposite colours, and ``"viridis"`` otherwise.
    z_score:
        If ``True``, each row is z-score normalized before coloring.
    vmin, vmax:
        Lower/upper clamp of the color domain. ``None`` (the default)
        auto-scales from the data. For a diverging colormap the auto domain is
        symmetric about zero, and a positive ``vmax`` or a negative ``vmin``
        given alone is mirrored about zero, so zero keeps the neutral colour.
    show_colorbar:
        Draw the colorbar legend.
    row_labels, col_labels:
        Optional explicit labels; override any inferred from a DataFrame.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np
    >>> m = np.random.randn(1000, 1000).astype(np.float32)
    >>> Heatmap(m, z_score=True)  # doctest: +SKIP
    """

    _esm = STATIC / "heatmap.js"

    def __init__(
        self,
        matrix: Any,
        *,
        colormap: Literal["viridis", "rdbu", "ltc", "ltcdiv"] | None = None,
        z_score: bool = False,
        vmin: float | None = None,
        vmax: float | None = None,
        show_colorbar: bool = True,
        row_labels: list[str] | None = None,
        col_labels: list[str] | None = None,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if colormap is not None:
            _check_choice(colormap, "colormap", _COLORMAPS)

        # A DataFrame gives its labels; a nested list or array gives none.
        arr, inferred_rows, inferred_cols = _as_matrix(matrix)
        if row_labels is None:
            row_labels = inferred_rows
        if col_labels is None:
            col_labels = inferred_cols
        if arr.ndim != 2:
            raise ValueError("`matrix` must be a 2-D array or DataFrame.")
        nrows, ncols = int(arr.shape[0]), int(arr.shape[1])
        if nrows == 0 or ncols == 0:
            raise ValueError("`matrix` must contain at least one row and one column.")

        # Row-major flatten: element (r, c) at index r * ncols + c.
        values = np.ascontiguousarray(arr).reshape(-1)
        buffer, schema = pack_columns({"values": values})

        meta: dict[str, Any] = {"nrows": nrows, "ncols": ncols}
        rlabels = _check_labels(row_labels, nrows, "row_labels")
        clabels = _check_labels(col_labels, ncols, "col_labels")
        if rlabels is not None:
            meta["rowLabels"] = rlabels
        if clabels is not None:
            meta["colLabels"] = clabels

        # A None colormap lets the browser pick: "rdbu" for z-scores and
        # "viridis" otherwise.
        options: dict[str, Any] = {
            "colormap": colormap,
            "zScore": z_score,
            "vmin": vmin,
            "vmax": vmax,
            "showColorbar": show_colorbar,
        }
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
