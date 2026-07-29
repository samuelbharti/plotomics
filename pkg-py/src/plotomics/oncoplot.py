"""Oncoplot (OncoPrint) widget."""

from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


def memo_sort(
    genes: list[str],
    samples: list[str],
    alt_gene: list[str],
    alt_sample: list[str],
) -> tuple[list[str], list[str]]:
    """Return the conventional oncoplot row and column order.

    Genes are ordered by descending alteration frequency, then samples are
    ordered so the most frequently altered gene's carriers come first, ties
    broken by the next gene down. This is the "memo sort" cBioPortal
    popularised; it is what makes mutual exclusivity between drivers read as a
    staircase.

    Exposed separately so a caller can compute the order once and reuse it for
    both an interactive widget and a static rendering, rather than letting two
    implementations tie-break differently.
    """
    counts = Counter(alt_gene)
    genes = sorted(genes, key=lambda g: (-counts.get(g, 0), g))
    gi = {g: i for i, g in enumerate(genes)}
    hits: dict[str, int] = {s: 0 for s in samples}
    # One bit per gene, most frequent gene in the highest bit, so ordinary
    # descending sort reproduces the staircase without a per-row pass.
    for g, s in zip(alt_gene, alt_sample):
        if g in gi and s in hits:
            hits[s] |= 1 << (len(genes) - 1 - gi[g])
    samples = sorted(samples, key=lambda s: (-hits[s], s))
    return genes, samples


class Oncoplot(PlotomicsWidget):
    """The cohort alteration landscape.

    A gene x sample grid of categorical alteration classes, with a per-sample
    burden barplot above, a per-gene frequency barplot to the right, and
    optional clinical annotation strips below. The grid renders on a canvas, so
    cohort-scale matrices (hundreds of genes by thousands of samples) stay
    interactive; labels and the legend are a crisp SVG overlay.

    The component renders rows and columns in exactly the order it is given.
    Ordering is the caller's decision, and re-deriving it in the browser would
    let two renderings of the same data disagree. Pass ``genes``/``samples`` to
    override the default :func:`memo_sort` order.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays of *altered pairs only*,
        with columns ``gene``, ``sample`` and ``class``. Unaltered pairs are
        simply absent; the full grid is reconstructed from ``genes`` and
        ``samples``.
    genes, samples:
        Explicit row / column order. Defaults to the memo-sorted order.
    classes:
        Alteration classes, fixing both legend order and colour assignment.
        Defaults to the classes present, most frequent first.
    class_colors:
        One hex colour per entry of ``classes``. ``None`` uses the component's
        categorical palette.
    burden:
        One value per sample for the top barplot. Defaults to the number of
        altered genes per sample.
    annotations:
        Optional clinical strips, each a mapping with ``name``, ``values`` (one
        per sample) and optional ``colors``.
    show_burden, show_frequency, show_annotations, show_legend:
        Toggle the surrounding panels.
    empty_color:
        Fill for a gene x sample cell with no alteration.
    burden_color, frequency_color:
        Hex fills for the per-sample burden bars above the grid and the per-gene
        frequency bars to its right.
    x_label, burden_label:
        Axis titles for the sample axis and the burden barplot.
    cell_gap_x, cell_gap_y:
        Gap between cells as a fraction of cell size. Set both to ``0`` for a
        solid block, which is what you want once a cohort is wide enough that
        the gaps eat more pixels than the cells.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> alt = pd.DataFrame({
    ...     "gene": ["TP53", "TP53", "PIK3CA", "PIK3CA", "GATA3"],
    ...     "sample": ["S1", "S2", "S2", "S3", "S1"],
    ...     "class": ["Missense", "Truncating", "Missense", "Amplification",
    ...               "Missense"],
    ... })
    >>> Oncoplot(alt)  # doctest: +SKIP
    """

    _esm = STATIC / "oncoplot.js"

    def __init__(
        self,
        data: Any,
        *,
        genes: list[str] | None = None,
        samples: list[str] | None = None,
        classes: list[str] | None = None,
        class_colors: list[str] | None = None,
        burden: Any = None,
        annotations: list[dict[str, Any]] | None = None,
        show_burden: bool = True,
        show_frequency: bool = True,
        show_annotations: bool = True,
        show_legend: bool = True,
        empty_color: str = "#EFE9DC",
        burden_color: str = "#0E7175",
        frequency_color: str = "#ED773C",
        x_label: str = "samples",
        burden_label: str = "alterations",
        cell_gap_x: float = 0.12,
        cell_gap_y: float = 0.16,
        theme: dict | None = None,
        height: int = 560,
        **kwargs: Any,
    ) -> None:
        g_col = _column(data, "gene")
        s_col = _column(data, "sample")
        c_col = _column(data, "class")
        if g_col is None or s_col is None or c_col is None:
            raise ValueError(
                "`data` must provide `gene`, `sample` and `class` columns."
            )
        alt_gene = [str(v) for v in g_col]
        alt_sample = [str(v) for v in s_col]
        alt_class = [str(v) for v in c_col]
        if not alt_gene:
            raise ValueError("`data` must contain at least one row.")

        if classes is None:
            classes = [c for c, _ in Counter(alt_class).most_common()]
        classes = [str(c) for c in classes]
        unknown = sorted(set(alt_class) - set(classes))
        if unknown:
            raise ValueError(
                "class(es) not present in `classes`: " + ", ".join(unknown)
            )
        if class_colors is not None and len(class_colors) != len(classes):
            raise ValueError("`class_colors` must have one entry per class.")

        genes_in = list(genes) if genes is not None else sorted(set(alt_gene))
        samples_in = list(samples) if samples is not None else sorted(set(alt_sample))
        if genes is None or samples is None:
            sorted_genes, sorted_samples = memo_sort(
                genes_in, samples_in, alt_gene, alt_sample
            )
            genes_in = list(genes) if genes is not None else sorted_genes
            samples_in = list(samples) if samples is not None else sorted_samples

        nrows, ncols = len(genes_in), len(samples_in)
        if nrows == 0 or ncols == 0:
            raise ValueError("`data` must contain at least one row.")

        gi = {g: i for i, g in enumerate(genes_in)}
        si = {s: i for i, s in enumerate(samples_in)}
        ci = {c: i + 1 for i, c in enumerate(classes)}

        # Row-major codes: 0 is unaltered, k is classes[k - 1].
        codes = np.zeros(nrows * ncols, dtype=np.float32)
        for g, s, c in zip(alt_gene, alt_sample, alt_class):
            r, col = gi.get(g), si.get(s)
            if r is None or col is None:
                continue
            codes[r * ncols + col] = ci[c]

        grid = codes.reshape(nrows, ncols) > 0
        freq = np.round(100.0 * grid.sum(axis=1) / ncols, 1).astype(np.float32)
        if burden is None:
            tmb = grid.sum(axis=0).astype(np.float32)
        else:
            tmb = _to_float32(burden, "burden")
            if tmb.size != ncols:
                raise ValueError("`burden` must have one value per sample.")

        # Three different lengths on purpose: the grid is nrows * ncols, the
        # burden is one per sample and the frequency one per gene. The schema
        # carries each column's own length and offset, so they share a buffer.
        buffer, schema = pack_columns(
            {"codes": codes, "tmb": tmb, "freq": freq}, equal_length=False
        )

        meta: dict[str, Any] = {
            "nrows": nrows,
            "ncols": ncols,
            "genes": genes_in,
            "samples": samples_in,
            "classes": classes,
        }
        if class_colors is not None:
            meta["classColors"] = [str(c) for c in class_colors]
        if annotations:
            meta["annotations"] = [
                _annotation(a, ncols) for a in annotations
            ]

        options: dict[str, Any] = {
            "showBurden": show_burden,
            "showFrequency": show_frequency,
            "showAnnotations": show_annotations,
            "showLegend": show_legend,
            "emptyColor": empty_color,
            "burdenColor": burden_color,
            "frequencyColor": frequency_color,
            "xLabel": x_label,
            "burdenLabel": burden_label,
            "cellGapX": cell_gap_x,
            "cellGapY": cell_gap_y,
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


def _annotation(a: dict[str, Any], ncols: int) -> dict[str, Any]:
    """Encode one clinical strip as levels plus 0-based codes."""
    name = a.get("name")
    values = a.get("values")
    if name is None or values is None:
        raise ValueError("each annotation needs `name` and `values`.")
    vals = [None if v is None else str(v) for v in values]
    if len(vals) != ncols:
        raise ValueError(f"annotation '{name}' must have one value per sample.")
    levels = sorted({v for v in vals if v is not None and v not in ("nan", "<NA>")})
    idx = {lv: i for i, lv in enumerate(levels)}
    out: dict[str, Any] = {
        "name": str(name),
        "levels": levels,
        # -1 renders as an empty cell rather than borrowing level 0's colour.
        "codes": [idx.get(v, -1) for v in vals],
    }
    colors = a.get("colors")
    if colors is not None:
        out["colors"] = [str(c) for c in colors]
    return out
