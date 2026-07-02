"""Expression heatmap widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, BiovizWidget, pack_columns


class Heatmap(BiovizWidget):
    """GPU-accelerated heatmap for large expression matrices (samples x genes).

    The matrix is packed as a single row-major ``float32`` column and uploaded
    to the GPU as one texture, colormapped in a fragment shader, so matrices
    with a million or more cells pan and zoom smoothly. The colorbar legend and
    row/column tick labels are drawn as vector overlays.

    Parameters
    ----------
    matrix:
        A 2-D ``numpy`` array or a ``pandas`` DataFrame of shape
        ``(nrows, ncols)``. For a DataFrame, the index becomes the row labels
        and the columns become the column labels.
    colormap:
        Color ramp: ``"viridis"`` (sequential) or ``"rdbu"`` (diverging).
    z_score:
        If ``True``, each row is z-score normalized before coloring.
    vmin, vmax:
        Lower/upper clamp of the color domain. ``None`` (the default)
        auto-scales from the data; for ``"rdbu"`` the auto domain is symmetric
        about zero.
    show_colorbar:
        Draw the colorbar legend.
    row_labels, col_labels:
        Optional explicit labels; override any inferred from a DataFrame.
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
        colormap: str = "viridis",
        z_score: bool = False,
        vmin: float | None = None,
        vmax: float | None = None,
        show_colorbar: bool = True,
        row_labels: list[str] | None = None,
        col_labels: list[str] | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if colormap not in ("viridis", "rdbu"):
            raise ValueError("`colormap` must be 'viridis' or 'rdbu'.")

        # Pull labels off a DataFrame before coercing to an array.
        if row_labels is None and hasattr(matrix, "index"):
            row_labels = [str(v) for v in matrix.index]
        if col_labels is None and hasattr(matrix, "columns"):
            col_labels = [str(v) for v in matrix.columns]

        arr = np.asarray(getattr(matrix, "values", matrix), dtype=np.float32)
        if arr.ndim != 2:
            raise ValueError("`matrix` must be a 2-D array or DataFrame.")
        nrows, ncols = int(arr.shape[0]), int(arr.shape[1])

        # Row-major flatten: element (r, c) at index r * ncols + c.
        values = np.ascontiguousarray(arr).reshape(-1)
        buffer, schema = pack_columns({"values": values})

        meta: dict[str, Any] = {"nrows": nrows, "ncols": ncols}
        if row_labels is not None:
            if len(row_labels) != nrows:
                raise ValueError(
                    f"`row_labels` has {len(row_labels)} entries; expected {nrows}."
                )
            meta["rowLabels"] = [str(v) for v in row_labels]
        if col_labels is not None:
            if len(col_labels) != ncols:
                raise ValueError(
                    f"`col_labels` has {len(col_labels)} entries; expected {ncols}."
                )
            meta["colLabels"] = [str(v) for v in col_labels]

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": {}, "meta": meta},
            options={
                "colormap": colormap,
                "zScore": z_score,
                "vmin": vmin,
                "vmax": vmax,
                "showColorbar": show_colorbar,
            },
            _height=height,
            **kwargs,
        )
