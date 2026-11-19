"""Protein domain lollipop widget."""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Mapping
from numbers import Real
from typing import Any

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _column,
    _na_text,
    _not_in,
    _text_or_none,
    _to_float32,
    pack_columns,
)


def _rows(table: Any, fields: tuple[str, ...], name: str) -> list[dict[str, Any]]:
    """The rows of ``table`` as mappings of ``fields``.

    ``table`` is a list or tuple of mappings, or a table with one column per
    field: a pandas or polars DataFrame, a pyarrow Table or a dict of arrays.
    A DataFrame refuses to be read as true or false, so it is never asked.
    """
    wanted = ", ".join(f"`{f}`" for f in fields[:-1]) + f" and `{fields[-1]}`"
    message = f"`{name}` must contain columns {wanted}."
    if isinstance(table, (list, tuple)):
        if not all(
            isinstance(r, Mapping) and all(f in r for f in fields) for r in table
        ):
            raise ValueError(message)
        return [{f: r[f] for f in fields} for r in table]
    columns = {f: _column(table, f) for f in fields}
    if any(c is None for c in columns.values()):
        raise ValueError(message)
    # A pyarrow value, null included, as the Python value it holds.
    values = {
        f: [v.as_py() if hasattr(v, "as_py") else v for v in c]
        for f, c in columns.items()
    }
    n = len(values[fields[0]])
    if any(len(v) != n for v in values.values()):
        raise ValueError(f"the columns of `{name}` must be the same length.")
    return [{f: values[f][i] for f in fields} for i in range(n)]


class Lollipop(PlotomicsWidget):
    """Variants along a protein, drawn over its domain architecture.

    A backbone spanning the sequence with domain rectangles on it, mutation
    stems whose head area is proportional to recurrence, and an optional
    post-translational modification track below. Variants at one residue
    stack on one stem, most recurrent at the bottom, so the top of a stem is
    the residue's total. Hotspots inside a functional
    domain read very differently from truncating variants scattered across one,
    which is what this figure exists to show.

    Stems and domains are canvas-drawn so a protein with thousands of variants
    stays responsive; labels, axis and legend are a vector overlay.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays with ``position``
        (amino-acid position, 1-based) and ``count`` (recurrence, zero or
        more; a variant with a missing count is not drawn). Optional
        ``class`` and ``label`` columns drive the colour and the text labels.
    length:
        Protein length in residues.
    gene, uniprot:
        Identifiers shown on the axis title.
    domains:
        Optional domain rectangles with ``name``, ``start`` and ``end``: a
        pandas or polars ``DataFrame`` with those columns, as R takes a data
        frame, or a list of mappings with those keys. A domain whose name is
        missing (``None``, NaN or pandas NA) is drawn with no name.
    ptms:
        Optional modification sites with ``position`` and ``type``, as a
        ``DataFrame`` or a list of mappings, as for ``domains``.
    classes:
        Fixes the legend order and colour assignment. Defaults to the classes
        present, most frequent first.
    class_colors, domain_colors:
        Hex colours. ``None`` gives the classes the categorical palette of the
        theme. The domains never take that palette: ``None`` gives them a
        muted palette of their own that the default class colours do not
        use, ``#9F95C3``, ``#B2C28C``, ``#84B2C0``, ``#AD9967``,
        ``#B6BAD4``, ``#CE9B79``, ``#7EA3D4`` and ``#7DAB88``, repeated past
        the eighth domain. Each domain name is dark or light, whichever reads
        on its fill.
    label_top_n:
        Label the n most recurrent variants. Which stems get a label is
        resolved here and sent to the browser, so a redraw, an export and any
        static counterpart all label the same ones. ``0`` labels none and
        ``math.inf`` labels all, as ``Inf`` does in R.
    show_ptms, show_domains, show_legend:
        Toggle the surrounding tracks.
    min_head_radius, max_head_radius:
        Stem head radius range in pixels. Head *area* is proportional to
        recurrence, so these bound the mapping rather than setting a size:
        raise ``max_head_radius`` when one hotspot dwarfs the rest and you want
        the difference to read at a glance.
    y_label:
        Axis title for the recurrence axis. It also names the count in the
        tooltip: "12 samples" with the default, and "frequency: 0.3" for
        ``y_label="frequency"``.
    backbone_color, stem_color:
        Hex colors for the protein backbone rectangle and the mutation stems.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``categorical`` palette colours the variant classes only, not the
        domains; see ``domain_colors``. Its ``padding`` entry is the space in
        px between the edge of the widget and the plot: one number for every
        side, or a dict with any of the keys ``top``, ``right``, ``bottom`` and
        ``left``, a side left out keeping the default of 10.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> v = pd.DataFrame({
    ...     "position": [175, 248, 273],
    ...     "count": [21, 15, 13],
    ...     "class": ["Missense"] * 3,
    ...     "label": ["R175H", "R248Q", "R273H"],
    ... })
    >>> Lollipop(v, length=393, gene="TP53", uniprot="P04637")  # doctest: +SKIP
    """

    _esm = STATIC / "lollipop.js"

    def __init__(
        self,
        data: Any,
        *,
        length: int,
        gene: str | None = None,
        uniprot: str | None = None,
        domains: Any = None,
        ptms: Any = None,
        classes: list[str] | None = None,
        class_colors: list[str] | None = None,
        domain_colors: list[str] | None = None,
        label_top_n: int | float = 12,
        show_ptms: bool = True,
        show_domains: bool = True,
        show_legend: bool = True,
        min_head_radius: float = 3,
        max_head_radius: float = 11,
        y_label: str = "samples",
        backbone_color: str = "#E6DCC8",
        stem_color: str = "#93a1b8",
        theme: dict | None = None,
        height: int = 440,
        **kwargs: Any,
    ) -> None:
        pos = _column(data, "position")
        cnt = _column(data, "count")
        if pos is None or cnt is None:
            raise ValueError("`data` must provide `position` and `count` columns.")
        # numbers.Real covers numpy scalars, such as the np.int64 a pandas
        # lookup returns.
        if (
            isinstance(length, bool)
            or not isinstance(length, Real)
            or not math.isfinite(length)
            or length < 1
        ):
            raise ValueError("`length` must be a positive protein length.")

        position = _to_float32(pos, "position")
        count = _to_float32(cnt, "count")
        if position.size == 0:
            raise ValueError("`data` must contain at least one row.")
        if position.size != count.size:
            raise ValueError("`position` and `count` must be the same length.")
        if np.any(position < 1) or np.any(position > length):
            raise ValueError("`position` must fall within 1..length.")
        if np.any(count < 0):
            raise ValueError("`count` must be zero or more.")

        cls_col = _column(data, "class")
        lab_col = _column(data, "label")
        # A missing class is None. R leaves NA out of the classes it counts
        # and then stops on it, so Python does the same below.
        cls = _text_or_none(cls_col) if cls_col is not None else None
        # A missing label crosses as null, so the browser draws no text for it.
        lab = _text_or_none(lab_col) if lab_col is not None else None

        if classes is None and cls is not None:
            # Most frequent first, ties by name in code point order, as R
            # orders them.
            counted = Counter(c for c in cls if c is not None)
            classes = sorted(counted, key=lambda c: (-counted[c], c))
        if classes is not None:
            # A missing class given in `classes` stays None, as R keeps NA.
            classes = _text_or_none(classes)
            unknown = _not_in(cls or [], classes)
            if unknown:
                raise ValueError(
                    "class(es) not present in `classes`: " + _na_text(unknown)
                )
            if class_colors is not None and len(class_colors) != len(classes):
                raise ValueError("`class_colors` must have one entry per class.")

        buffer, schema = pack_columns({"position": position, "count": count})

        json_columns: dict[str, list] = {}
        if cls is not None:
            json_columns["class"] = cls
        if lab is not None:
            json_columns["label"] = lab

        meta: dict[str, Any] = {"length": float(length)}
        if gene is not None:
            meta["gene"] = str(gene)
        if uniprot is not None:
            meta["uniprot"] = str(uniprot)
        if classes is not None:
            meta["classes"] = classes
        if class_colors is not None:
            meta["classColors"] = [str(c) for c in class_colors]
        domain_rows = (
            []
            if domains is None
            else _rows(domains, ("name", "start", "end"), "domains")
        )
        if domain_rows:
            # A missing name crosses as null, as R sends NA, so the browser
            # draws no name for it, where str() would write "None".
            names = _text_or_none([d["name"] for d in domain_rows])
            meta["domains"] = [
                {
                    "name": names[i],
                    "start": float(d["start"]),
                    "end": float(d["end"]),
                }
                for i, d in enumerate(domain_rows)
            ]
            if domain_colors is not None:
                meta["domainColors"] = [str(c) for c in domain_colors]
        ptm_rows = [] if ptms is None else _rows(ptms, ("position", "type"), "ptms")
        if ptm_rows:
            types = _text_or_none([p["type"] for p in ptm_rows])
            meta["ptms"] = [
                {"position": float(p["position"]), "type": types[i]}
                for i, p in enumerate(ptm_rows)
            ]

        # Resolve the labelled stems once, here, so the renderer does not
        # pick on its own. With label_top_n = 0 the list is sent empty: the
        # browser labels the top 12 when it gets no list at all.
        if lab is not None:
            # min() takes math.inf down to the number of variants, and max()
            # takes -math.inf up to none, before int() sees either.
            n_top = int(max(0, min(label_top_n, count.size)))
            top = np.argsort(-count, kind="stable")[:n_top]
            meta["labelIndex"] = sorted(int(i) for i in top)

        options: dict[str, Any] = {
            "showPtms": show_ptms,
            "showDomains": show_domains,
            "showLegend": show_legend,
            "minHeadRadius": min_head_radius,
            "maxHeadRadius": max_head_radius,
            "yLabel": y_label,
            "backboneColor": backbone_color,
            "stemColor": stem_color,
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
