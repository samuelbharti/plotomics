"""Gene / pathway treemap widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, BiovizWidget, _column, pack_columns


class Treemap(BiovizWidget):
    """Hierarchical treemap of gene-set / pathway composition.

    The hierarchy is built from a flat edge list with ``d3-hierarchy``
    (``stratify`` + ``treemap``); tiles are rendered on a canvas so thousands of
    leaves stay interactive, while tile labels and a drill-down breadcrumb are
    drawn as a crisp SVG overlay.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or a mapping of arrays describing a tree as an
        edge list. Required columns: ``id`` (unique node id) and ``parent``
        (id of the parent; the root's parent is ``None``/``NaN``/``""``). A
        numeric ``value`` column supplies leaf weights (internal nodes are
        summed automatically); an optional ``label`` column supplies display
        names.
    tile:
        Tiling algorithm, ``"squarify"`` (golden-ratio rectangles) or
        ``"binary"`` (balanced binary partition).
    padding_inner:
        Padding between sibling tiles, in pixels.
    color_by:
        Color leaves by ``"parent"`` (top-level ancestor, categorical) or by
        ``"value"`` (a ramp).
    colormap:
        Ramp used when ``color_by="value"``: ``"viridis"`` or ``"rdbu"``.
    label_min_size:
        Minimum tile side (px) before a label is drawn.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> df = pd.DataFrame({
    ...     "id": ["root", "P1", "P2", "g1", "g2", "g3"],
    ...     "parent": [None, "root", "root", "P1", "P1", "P2"],
    ...     "value": [0, 0, 0, 3, 5, 2],
    ...     "label": ["All", "Pathway 1", "Pathway 2", "Gene 1", "Gene 2", "Gene 3"],
    ... })
    >>> Treemap(df)  # doctest: +SKIP
    """

    _esm = STATIC / "treemap.js"

    def __init__(
        self,
        data: Any,
        *,
        tile: str = "squarify",
        padding_inner: float = 1.0,
        color_by: str = "parent",
        colormap: str = "viridis",
        label_min_size: float = 32.0,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        ids = _column(data, "id")
        parents = _column(data, "parent")
        if ids is None or parents is None:
            raise ValueError("`data` must provide `id` and `parent` columns.")

        n = len(list(ids))

        # String columns travel as JSON. Missing / NaN parents mark the root and
        # are normalized to empty strings (the JS side treats "" / "NA" as root).
        json_columns: dict[str, list] = {
            "id": [str(v) for v in ids],
            "parent": [_parent_str(v) for v in parents],
        }

        # Numeric leaf weights travel via the binary transport (fast path).
        value = _column(data, "value")
        if value is not None:
            value_arr = np.asarray(value, dtype=np.float64)
        else:
            value_arr = np.zeros(n, dtype=np.float64)
        buffer, schema = pack_columns({"value": value_arr})

        meta: dict[str, Any] = {}
        label = _column(data, "label")
        if label is not None:
            meta["labels"] = [str(v) for v in label]

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": meta},
            options={
                "tile": tile,
                "paddingInner": padding_inner,
                "colorBy": color_by,
                "colormap": colormap,
                "labelMinSize": label_min_size,
            },
            _height=height,
            **kwargs,
        )


def _parent_str(v: Any) -> str:
    """Coerce a parent cell to a string, mapping None/NaN to the root marker."""
    if v is None:
        return ""
    # NaN (float) is not equal to itself; also catch pandas' NA-like values.
    if isinstance(v, float) and np.isnan(v):
        return ""
    s = str(v)
    return "" if s in ("nan", "NA", "None", "<NA>") else s
