"""Protein domain lollipop widget."""

from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Lollipop(PlotomicsWidget):
    """Variants along a protein, drawn over its domain architecture.

    A backbone spanning the sequence with domain rectangles on it, mutation
    stems whose head area is proportional to recurrence, and an optional
    post-translational modification track below. Hotspots inside a functional
    domain read very differently from truncating variants scattered across one,
    which is what this figure exists to show.

    Stems and domains are canvas-drawn so a protein with thousands of variants
    stays responsive; labels, axis and legend are a vector overlay.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays with ``position``
        (amino-acid position, 1-based) and ``count`` (recurrence). Optional
        ``class`` and ``label`` columns drive the colour and the text labels.
    length:
        Protein length in residues.
    gene, uniprot:
        Identifiers shown on the axis title.
    domains:
        Optional sequence of mappings with ``name``, ``start`` and ``end``.
    ptms:
        Optional sequence of mappings with ``position`` and ``type``.
    classes:
        Fixes the legend order and colour assignment. Defaults to the classes
        present, most frequent first.
    class_colors, domain_colors:
        Hex colours. ``None`` uses the component's categorical palette.
    label_top_n:
        Label the n most recurrent variants. Which stems get a label is
        resolved here and sent to the browser, so a redraw, an export and any
        static counterpart all label the same ones.
    show_ptms, show_domains, show_legend:
        Toggle the surrounding tracks.
    theme:
        Optional theme overrides forwarded to the JS renderer.
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
        domains: list[dict[str, Any]] | None = None,
        ptms: list[dict[str, Any]] | None = None,
        classes: list[str] | None = None,
        class_colors: list[str] | None = None,
        domain_colors: list[str] | None = None,
        label_top_n: int = 12,
        show_ptms: bool = True,
        show_domains: bool = True,
        show_legend: bool = True,
        theme: dict | None = None,
        height: int = 440,
        **kwargs: Any,
    ) -> None:
        pos = _column(data, "position")
        cnt = _column(data, "count")
        if pos is None or cnt is None:
            raise ValueError("`data` must provide `position` and `count` columns.")
        if not isinstance(length, (int, float)) or length < 1:
            raise ValueError("`length` must be a positive protein length.")

        position = _to_float32(pos, "position")
        count = _to_float32(cnt, "count")
        if position.size == 0:
            raise ValueError("`data` must contain at least one row.")
        if position.size != count.size:
            raise ValueError("`position` and `count` must be the same length.")
        if np.any(position < 1) or np.any(position > length):
            raise ValueError("`position` must fall within 1..length.")

        cls_col = _column(data, "class")
        lab_col = _column(data, "label")
        cls = [str(v) for v in cls_col] if cls_col is not None else None
        lab = [str(v) for v in lab_col] if lab_col is not None else None

        if classes is None and cls is not None:
            classes = [c for c, _ in Counter(cls).most_common()]
        if classes is not None:
            classes = [str(c) for c in classes]
            unknown = sorted(set(cls or []) - set(classes))
            if unknown:
                raise ValueError(
                    "class(es) not present in `classes`: " + ", ".join(unknown)
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
        if domains:
            meta["domains"] = [
                {
                    "name": str(d["name"]),
                    "start": float(d["start"]),
                    "end": float(d["end"]),
                }
                for d in domains
            ]
            if domain_colors is not None:
                meta["domainColors"] = [str(c) for c in domain_colors]
        if ptms:
            meta["ptms"] = [
                {"position": float(p["position"]), "type": str(p["type"])}
                for p in ptms
            ]

        # Resolve the labelled stems once, here, rather than letting the
        # renderer pick independently.
        if lab is not None and label_top_n > 0:
            top = np.argsort(-count, kind="stable")[:label_top_n]
            meta["labelIndex"] = sorted(int(i) for i in top)

        options: dict[str, Any] = {
            "showPtms": show_ptms,
            "showDomains": show_domains,
            "showLegend": show_legend,
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
