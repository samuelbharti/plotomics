"""Oncoplot (OncoPrint) widget."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
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


def memo_sort(
    genes: list[str],
    samples: list[str],
    alt_gene: list[str],
    alt_sample: list[str],
    sort_genes: bool = True,
) -> tuple[list[str], list[str]]:
    """Return the conventional oncoplot row and column order.

    Genes are ordered by the number of samples they are altered in (several
    mutations in one sample count once), then samples are ordered so the top
    gene's carriers come first, ties broken by the next gene down. This is the
    "memo sort" cBioPortal popularised; it is what makes mutual exclusivity
    between drivers read as a staircase. With ``sort_genes=False`` the given
    gene order is kept and the samples are sorted by it.

    Remaining ties go by name in code point order, which is the order R's
    ``oncoplot_memo_sort()`` uses, so both give the same rows and columns.

    Exposed separately so a caller can compute the order once and reuse it for
    both an interactive widget and a static rendering, so two implementations
    cannot tie-break differently.
    """
    if sort_genes:
        counts = Counter(g for g, _ in set(zip(alt_gene, alt_sample)))
        genes = sorted(genes, key=lambda g: (-counts.get(g, 0), g))
    else:
        genes = list(genes)
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
        ``samples``. A row with a missing gene or sample is left out, as in
        R.
    genes, samples:
        Explicit row / column order. Defaults to the memo-sorted order of the
        genes and samples present in ``data``. Given ``genes`` keep their order
        and the samples are sorted by it. The frequency bars divide by the
        number of samples shown, so pass ``samples`` to count unaltered
        samples of the cohort too.
    classes:
        Alteration classes, fixing both legend order and colour assignment.
        Defaults to the classes present, most frequent first, equal counts by
        name, as in R. A missing class stops with an error, as in R, unless
        ``classes`` holds None too: then it is a class of its own, sent as
        null. A gene and sample with two or more different classes is drawn
        as ``"Multi-hit"``, in dark grey, which is added to the classes when
        it occurs.
    class_colors:
        One hex colour per entry of ``classes``. ``None`` uses the component's
        categorical palette.
    burden:
        One value per sample for the top barplot. Defaults to the number of
        altered genes per sample.
    annotations:
        Optional clinical strips, each a mapping with ``name``, ``values`` and
        optional ``colors``. ``values`` keyed by sample (a dict, or a pandas
        Series whose index names samples) are matched to the columns by name.
        A plain list, or a Series indexed by row number, is read in the order
        of ``samples``, so it needs ``samples``.
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
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
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
        # A missing gene, sample or class is None, never the text "nan".
        alt_gene = _text_or_none(g_col)
        alt_sample = _text_or_none(s_col)
        alt_class = _text_or_none(c_col)
        if not alt_gene:
            raise ValueError("`data` must contain at least one row.")

        if classes is None:
            # Most frequent first, equal counts by name in code point order,
            # as R orders them. A missing class is not counted; it stops
            # below, as in R, unless the given classes hold None.
            counted = Counter(c for c in alt_class if c is not None)
            classes = sorted(counted, key=lambda c: (-counted[c], c))
        # A missing class given in `classes` stays None, as R keeps NA.
        classes = _text_or_none(classes)
        unknown = _not_in(alt_class, classes)
        if unknown:
            raise ValueError(
                "class(es) not present in `classes`: " + _na_text(unknown)
            )
        if class_colors is not None and len(class_colors) != len(classes):
            raise ValueError("`class_colors` must have one entry per class.")

        # A gene and sample with two or more different classes is one cell,
        # drawn as "Multi-hit"; otherwise the last row would win silently.
        # A row with no gene or no sample names no cell, so R and Python
        # leave it out: it draws nothing and makes no Multi-hit.
        by_pair: dict[tuple[str, str], set[str]] = {}
        for g, s_, c in zip(alt_gene, alt_sample, alt_class):
            if g is not None and s_ is not None:
                by_pair.setdefault((g, s_), set()).add(c)
        multi = {k for k, v in by_pair.items() if len(v) > 1}
        if multi:
            if MULTI_HIT not in classes:
                classes = [*classes, MULTI_HIT]
                if class_colors is not None:
                    class_colors = [*class_colors, MULTI_HIT_COLOR]
            alt_class = [
                MULTI_HIT if (g, s_) in multi else c
                for g, s_, c in zip(alt_gene, alt_sample, alt_class)
            ]

        present_genes = sorted({g for g in alt_gene if g is not None})
        present_samples = sorted({s for s in alt_sample if s is not None})
        genes_in = list(genes) if genes is not None else present_genes
        samples_in = list(samples) if samples is not None else present_samples
        if genes is None or samples is None:
            # Given genes keep their order, and the samples follow it.
            sorted_genes, sorted_samples = memo_sort(
                genes_in, samples_in, alt_gene, alt_sample,
                sort_genes=genes is None,
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
                _annotation(a, samples_in, samples is not None)
                for a in annotations
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


def _annotation(
    a: dict[str, Any], samples: list[str], samples_given: bool
) -> dict[str, Any]:
    """Encode one clinical strip as levels plus 0-based codes.

    Values keyed by sample (a dict, or a pandas Series whose index names
    samples) are matched to the columns by name. A plain sequence, or a
    Series indexed by row number, is read in the order of ``samples``, so it
    needs ``samples`` to have been given.
    """
    name = a.get("name")
    values = a.get("values")
    if name is None or values is None:
        raise ValueError("each annotation needs `name` and `values`.")
    keyed = None
    if isinstance(values, Mapping):
        keyed = {str(k): v for k, v in values.items()}
    elif hasattr(values, "to_dict") and hasattr(values, "index"):
        # A pandas Series is keyed when its index names samples. A row-number
        # index, as left by filtering a table, is read by position.
        index = [str(k) for k in values.index]
        if set(index) & set(samples):
            dup = sorted({k for k in index if index.count(k) > 1})
            if dup:
                raise ValueError(
                    f"annotation '{name}' has more than one value for "
                    "sample(s): " + ", ".join(dup[:5])
                )
            keyed = dict(zip(index, values.tolist()))
    if keyed is not None:
        missing = [s for s in samples if s not in keyed]
        if missing:
            raise ValueError(
                f"annotation '{name}' has no value for sample(s): "
                + ", ".join(missing[:5])
            )
        raw = [keyed[s] for s in samples]
    elif not samples_given:
        raise ValueError(
            f"annotation '{name}' needs sample names: pass `values` as a dict "
            "or a pandas Series keyed by sample, or pass `samples` so a list "
            "can be read in that order."
        )
    else:
        raw = list(values)
    vals = _text_or_none(raw)
    if len(vals) != len(samples):
        raise ValueError(f"annotation '{name}' must have one value per sample.")
    # Code point order, as R's oncoplot() sorts the levels.
    levels = sorted({v for v in vals if v is not None})
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


# The class for a gene and sample altered in two or more different ways.
MULTI_HIT = "Multi-hit"
MULTI_HIT_COLOR = "#3A3A3A"
