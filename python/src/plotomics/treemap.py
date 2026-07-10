"""Gene / pathway treemap widget."""

from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Treemap(PlotomicsWidget):
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
    theme:
        Optional theme overrides forwarded to the JS renderer.
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
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        ids = _column(data, "id")
        parents = _column(data, "parent")
        if ids is None or parents is None:
            raise ValueError("`data` must provide `id` and `parent` columns.")
        if tile not in ("squarify", "binary"):
            raise ValueError("`tile` must be 'squarify' or 'binary'.")
        if color_by not in ("parent", "value"):
            raise ValueError("`color_by` must be 'parent' or 'value'.")
        if colormap not in ("viridis", "rdbu"):
            raise ValueError("`colormap` must be 'viridis' or 'rdbu'.")

        # String columns travel as JSON. Missing / NaN parents mark the root and
        # are normalized to empty strings (the JS side treats "" / "NA" as root).
        id_list = [str(v) for v in ids]
        parent_list = [_parent_str(v) for v in parents]
        n = len(id_list)

        # Structural integrity: exactly one root, unique ids, no orphan parents.
        if n == 0:
            raise ValueError("`data` must contain at least one row.")
        dupes = sorted({i for i, c in Counter(id_list).items() if c > 1})
        if dupes:
            raise ValueError("duplicate node id(s): " + ", ".join(dupes))
        roots = [i for i, p in zip(id_list, parent_list) if p == ""]
        if len(roots) != 1:
            raise ValueError("treemap requires exactly one root")
        id_set = set(id_list)
        missing = sorted({p for p in parent_list if p != "" and p not in id_set})
        if missing:
            raise ValueError("parent(s) not found among ids: " + ", ".join(missing))
        # Every node must reach the root by following parents; a self-parent or a
        # cycle disjoint from the root passes the checks above but crashes
        # d3.stratify in the browser.
        parent_of = dict(zip(id_list, parent_list))
        good: set[str] = set()
        for start in id_list:
            seen: set[str] = set()
            cur = start
            while cur != "" and cur not in good:
                if cur in seen:
                    raise ValueError(
                        f"treemap has a cycle in the parent chain (at '{cur}')"
                    )
                seen.add(cur)
                cur = parent_of.get(cur, "")
            good |= seen

        json_columns: dict[str, list] = {"id": id_list, "parent": parent_list}

        # Numeric leaf weights travel via the binary transport (float32 for
        # consistency with every other component's packed columns).
        value = _column(data, "value")
        if value is not None:
            value_arr = _to_float32(value, "value")
            if value_arr.size != n:
                raise ValueError(
                    f"`value` has {value_arr.size} entries; expected {n}."
                )
        else:
            value_arr = np.zeros(n, dtype=np.float32)
        buffer, schema = pack_columns({"value": value_arr})

        meta: dict[str, Any] = {}
        label = _column(data, "label")
        if label is not None:
            meta["labels"] = [str(v) for v in label]

        options: dict[str, Any] = {
            "tile": tile,
            "paddingInner": padding_inner,
            "colorBy": color_by,
            "colormap": colormap,
            "labelMinSize": label_min_size,
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


def _parent_str(v: Any) -> str:
    """Coerce a parent cell to a string, mapping None/NaN to the root marker."""
    if v is None:
        return ""
    # NaN (float) is not equal to itself; also catch pandas' NA-like values.
    if isinstance(v, float) and np.isnan(v):
        return ""
    s = str(v)
    return "" if s in ("nan", "NA", "None", "<NA>") else s
