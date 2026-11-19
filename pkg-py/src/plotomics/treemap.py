"""Gene / pathway treemap widget."""

from __future__ import annotations

from collections import Counter
from typing import Any, Literal

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _check_choice,
    _column,
    _text_or_none,
    _to_float32,
    pack_columns,
)

_COLORMAPS = ("viridis", "rdbu", "ltc", "ltcdiv")


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
        numeric ``value`` column supplies leaf weights. A group's size is the
        sum of its leaves; a value given on an internal node is ignored.
        Without a ``value`` column every leaf weighs 1, so tiles show leaf
        counts. An optional ``label`` column supplies display names. Top-level
        groups are named in a header strip when their tile has room.
    tile:
        Tiling algorithm, ``"squarify"`` (golden-ratio rectangles) or
        ``"binary"`` (balanced binary partition).
    padding_inner:
        Padding between sibling tiles, in pixels.
    color_by:
        Color leaves by ``"parent"`` (top-level ancestor, categorical) or by
        ``"value"`` (a ramp).
    colormap:
        Ramp used when ``color_by="value"``: ``"viridis"``, ``"rdbu"``,
        ``"ltc"`` (an earthy teal to sand to rust sequential ramp) or
        ``"ltcdiv"`` (its diverging counterpart, neutral cream at the
        midpoint). The ramp runs from the smallest leaf value in view to
        the largest, so a diverging ramp has its midpoint halfway between
        the two.
    label_min_size:
        Minimum tile side (px) before a label is drawn, at the default font
        size. It grows with ``theme["fontSize"]``.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
        A colour given as a CSS custom property, such as
        ``"background": "var(--bg)"``, takes the value the page gives it when
        the plot draws. After the page changes the property, what the plot
        drew on a canvas keeps the old colour until it draws again: resize
        the widget or display it again.
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
        colormap: Literal["viridis", "rdbu", "ltc", "ltcdiv"] = "viridis",
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
        _check_choice(colormap, "colormap", _COLORMAPS)

        # String columns travel as JSON. Missing / NaN parents mark the root and
        # are normalized to empty strings (the JS side treats "" / "NA" as root).
        id_list = [_id_str(v) for v in ids]
        id_set_all = set(id_list)
        parent_list = [_parent_str(v, id_set_all) for v in parents]
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
        # Without a value column the browser weighs every leaf as 1.
        value = _column(data, "value")
        if value is not None:
            value_arr = _to_float32(value, "value")
            if value_arr.size != n:
                raise ValueError(
                    f"`value` has {value_arr.size} entries; expected {n}."
                )
            buffer, schema = pack_columns({"value": value_arr})
        else:
            buffer, schema = b"", {"columns": []}

        meta: dict[str, Any] = {}
        label = _column(data, "label")
        if label is not None:
            # A missing label crosses as null, as R sends an NA, and the
            # browser shows the id in its place.
            meta["labels"] = _text_or_none(label)

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


def _id_str(v: Any) -> str:
    """Text of an id. A whole-number float prints as an integer.

    A parent column that holds None is stored by pandas as float64, so parent
    1 arrives as 1.0 while the id column still says 1. Both must read "1".
    """
    if isinstance(v, (float, np.floating)) and np.isfinite(v) and float(v).is_integer():
        return str(int(v))
    return str(v)


def _parent_str(v: Any, ids: set[str]) -> str:
    """Coerce a parent cell to a string, mapping None/NaN to the root marker.

    A whole-number float parent matches an id written either way: "1" for an
    integer id column, or "1.0" for ids that were cast to text from floats.
    """
    if v is None:
        return ""
    # NaN (float) is not equal to itself; also catch pandas' NA-like values.
    if isinstance(v, (float, np.floating)) and np.isnan(v):
        return ""
    s = _id_str(v)
    if s not in ids and str(v) in ids:
        s = str(v)
    return "" if s in ("nan", "NA", "None", "<NA>") else s
