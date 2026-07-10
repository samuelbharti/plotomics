"""Clustered heatmap widget with dendrograms."""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np

from ._base import STATIC, BiovizWidget, pack_columns

_METRICS = ("euclidean", "correlation")
_LINKAGES = ("average", "complete", "ward")
_COLORMAPS = ("viridis", "rdbu")


class Clustermap(BiovizWidget):
    """Hierarchically-clustered expression heatmap with dendrograms.

    In the spirit of ``seaborn.clustermap`` / Morpheus: the matrix is drawn on
    a GPU/canvas data layer so large matrices stay smooth, while dendrograms,
    tick labels and the colorbar are crisp vector overlays. Rows and columns
    are agglomeratively clustered and reordered so structure appears as blocks
    along the diagonal.

    Clustering is at least ``O(n^2)`` in the number of rows/columns (it builds a
    full distance matrix), so clustering runs automatically only when a
    dimension has at most 2000 leaves. For larger matrices, precompute a leaf
    order (or dendrogram) elsewhere and pass it via ``row_linkage`` /
    ``col_linkage`` to skip clustering; the heatmap rendering itself scales to
    much larger matrices.

    Parameters
    ----------
    matrix:
        A 2D NumPy array or a pandas ``DataFrame``. For a ``DataFrame``, the
        index becomes row labels and the columns become column labels. Values
        are packed as ``float32`` and transported row-major.
    metric:
        Distance metric for clustering: ``"euclidean"`` or ``"correlation"``
        (1 - Pearson correlation).
    linkage:
        Agglomeration method: ``"average"``, ``"complete"`` or ``"ward"``.
    colormap:
        Color ramp: ``"viridis"`` (sequential) or ``"rdbu"`` (diverging).
    z_score:
        Standardize each row to mean 0 / sd 1 before coloring.
    cluster_rows, cluster_cols:
        Cluster and reorder rows / columns. Ignored for an axis when a
        precomputed ``row_linkage`` / ``col_linkage`` is supplied.
    show_row_dendrogram, show_col_dendrogram:
        Draw the row / column dendrogram.
    show_labels:
        Draw row/column tick labels (auto-hidden when cells get too small).
    legend_title:
        Colorbar legend title.
    row_labels, col_labels:
        Explicit labels; override any inferred from a DataFrame.
    row_linkage, col_linkage:
        Optional precomputed leaf order or dendrogram to skip clustering that
        axis. Either a list of 0-based leaf indices, or a dict with ``order``
        (0-based) and ``merges`` (each ``{"left", "right", "height"}``; leaves
        are ``0..n-1`` and internal node ``k`` is ``n + k``).
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np
    >>> # Two blocks of correlated rows.
    >>> mat = np.vstack([
    ...     np.random.randn(20, 10) + 2,
    ...     np.random.randn(20, 10) - 2,
    ... ])
    >>> Clustermap(mat, colormap="rdbu", z_score=True)  # doctest: +SKIP
    """

    _esm = STATIC / "clustermap.js"

    def __init__(
        self,
        matrix: Any,
        *,
        metric: str = "euclidean",
        linkage: str = "average",
        colormap: str = "viridis",
        z_score: bool = False,
        cluster_rows: bool = True,
        cluster_cols: bool = True,
        show_row_dendrogram: bool = True,
        show_col_dendrogram: bool = True,
        show_labels: bool = True,
        legend_title: str = "value",
        row_labels: Any | None = None,
        col_labels: Any | None = None,
        row_linkage: Any | None = None,
        col_linkage: Any | None = None,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if metric not in _METRICS:
            raise ValueError(
                "`metric` must be 'euclidean' or 'correlation'."
            )
        if linkage not in _LINKAGES:
            raise ValueError(
                "`linkage` must be 'average', 'complete' or 'ward'."
            )
        if colormap not in _COLORMAPS:
            raise ValueError("`colormap` must be 'viridis' or 'rdbu'.")

        arr, inferred_rows, inferred_cols = _as_matrix(matrix)
        if arr.ndim != 2:
            raise ValueError("`matrix` must be 2-dimensional.")
        nrows, ncols = arr.shape
        if nrows == 0 or ncols == 0:
            raise ValueError("`matrix` must contain at least one row and one column.")

        if row_linkage is not None:
            _validate_linkage(row_linkage, int(nrows), "row_linkage")
        if col_linkage is not None:
            _validate_linkage(col_linkage, int(ncols), "col_linkage")

        # Row-major float32 buffer (C-contiguous flatten matches the JS layout).
        try:
            values = np.ascontiguousarray(arr, dtype=np.float32).reshape(-1)
        except (ValueError, TypeError):
            raise ValueError(
                f"`matrix` must be numeric; got dtype {arr.dtype.name}"
            ) from None
        buffer, schema = pack_columns({"values": values})

        meta: dict[str, Any] = {"nrows": int(nrows), "ncols": int(ncols)}
        rlabels = row_labels if row_labels is not None else inferred_rows
        clabels = col_labels if col_labels is not None else inferred_cols
        if rlabels is not None:
            meta["rowLabels"] = [str(v) for v in rlabels]
        if clabels is not None:
            meta["colLabels"] = [str(v) for v in clabels]
        if row_linkage is not None:
            meta["rowLinkage"] = row_linkage
        if col_linkage is not None:
            meta["colLinkage"] = col_linkage

        options: dict[str, Any] = {
            "metric": metric,
            "linkage": linkage,
            "colormap": colormap,
            "zScore": z_score,
            "clusterRows": cluster_rows,
            "clusterCols": cluster_cols,
            "showRowDendrogram": show_row_dendrogram,
            "showColDendrogram": show_col_dendrogram,
            "showLabels": show_labels,
            "legendTitle": legend_title,
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


def _validate_linkage(linkage: Any, n: int, name: str) -> None:
    """Validate a precomputed leaf order / dendrogram against the axis size.

    Accepts either a sequence of 0-based leaf indices, or a mapping with an
    ``order`` key (and an optional list-like ``merges``). The order must be a
    permutation of ``0..n-1``.
    """
    if isinstance(linkage, Mapping):
        if "order" not in linkage:
            raise ValueError(f"`{name}` dict must contain an 'order' key.")
        order = list(linkage["order"])
        merges = linkage.get("merges")
        if merges is not None:
            if not isinstance(merges, (list, tuple)):
                raise ValueError(f"`{name}` 'merges' must be a list.")
            for m in merges:
                if not (
                    isinstance(m, Mapping)
                    and all(k in m for k in ("left", "right", "height"))
                ):
                    raise ValueError(
                        f"`{name}` 'merges' must each supply 'left', 'right' "
                        "and 'height'."
                    )
    else:
        try:
            order = list(linkage)
        except TypeError:
            raise ValueError(
                f"`{name}` must be a sequence of leaf indices or a dict with an "
                "'order' key."
            ) from None

    if len(order) != n:
        raise ValueError(f"`{name}` order has {len(order)} entries; expected {n}.")
    # Integer leaf indices only: accept ints and whole-valued floats (e.g. 2.0),
    # reject fractional floats and strings — matching the R wrapper, so
    # "0","1" or 0.5 are not silently coerced by int().
    cleaned: list[int] = []
    for v in order:
        if isinstance(v, bool):
            raise ValueError(f"`{name}` order must contain integer leaf indices.")
        if isinstance(v, (int, np.integer)):
            cleaned.append(int(v))
        elif isinstance(v, (float, np.floating)) and float(v).is_integer():
            cleaned.append(int(v))
        else:
            raise ValueError(f"`{name}` order must contain integer leaf indices.")
    if sorted(cleaned) != list(range(n)):
        raise ValueError(f"`{name}` order must be a permutation of 0..{n - 1}.")


def _as_matrix(matrix: Any) -> tuple[np.ndarray, Any | None, Any | None]:
    """Coerce input to a 2D ndarray, extracting labels from a DataFrame.

    Returns ``(array, row_labels_or_None, col_labels_or_None)``.
    """
    # Duck-typed pandas DataFrame support without a hard dependency.
    if hasattr(matrix, "values") and hasattr(matrix, "index") and hasattr(matrix, "columns"):
        arr = np.asarray(matrix.values)
        return arr, list(matrix.index), list(matrix.columns)
    return np.asarray(matrix), None, None
