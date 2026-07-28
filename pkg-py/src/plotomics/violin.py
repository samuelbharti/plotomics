"""Stacked violin widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Violin(PlotomicsWidget):
    """One row per feature, one violin per group.

    A box plot hides bimodality, which in single-cell data is usually the whole
    story: a gene expressed in half a cluster and silent in the other half has
    the same median as one expressed weakly everywhere. The violin shows the
    shape, and stacking rows on a shared x lets a marker panel be read down the
    page.

    The widget draws densities, it does not estimate them. Each violin arrives
    as a vector of density values on a shared grid, because kernel bandwidth
    choice changes what the figure claims and belongs with the data. It also
    keeps the payload proportional to the grid rather than to the cell count.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping with ``feature`` and ``group`` key
        columns, one row per violin, in the order to draw them.
    grid:
        The shared evaluation grid, ascending.
    grids:
        Optional array shaped (features, len(grid)) giving each feature its own
        y range. Without it every row shares ``grid``, which lets one highly
        expressed feature compress the rest into flat lines.
    density:
        Array shaped (violins, len(grid)) of density values.
    median:
        Optional per-violin median, drawn as a tick.
    features, groups:
        Fix the row and column order. A pandas Categorical supplies it from its
        categories.
    group_colors:
        One hex colour per group. ``None`` uses the categorical palette.
    violin_width:
        Fraction of a cell's width the widest violin fills.
    scale_per_violin:
        Scale each violin to its own maximum rather than the row's. Per-row is
        the default so groups stay comparable within a feature.
    show_median, show_feature_labels:
        Toggle the median tick and the row labels.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.
    """

    _esm = STATIC / "violin.js"

    def __init__(
        self,
        data: Any,
        *,
        grid: Any,
        density: Any,
        grids: Any = None,
        median: Any = None,
        features: list[str] | None = None,
        groups: list[str] | None = None,
        group_colors: list[str] | None = None,
        violin_width: float = 0.85,
        scale_per_violin: bool = False,
        show_median: bool = True,
        show_feature_labels: bool = True,
        theme: dict | None = None,
        height: int = 560,
        **kwargs: Any,
    ) -> None:
        feature = _column(data, "feature")
        group = _column(data, "group")
        missing = [
            name for name, col in (("feature", feature), ("group", group))
            if col is None
        ]
        if missing:
            raise ValueError("`data` is missing column(s): " + ", ".join(missing))
        if not 0 < violin_width <= 1:
            raise ValueError("`violin_width` must be in (0, 1].")

        g = _to_float32(grid, "grid")
        if g.size == 0:
            raise ValueError("`grid` must contain at least one value.")
        if np.any(np.diff(g) < 0):
            raise ValueError("`grid` must be ascending.")

        dm = np.atleast_2d(np.asarray(density, dtype=np.float32))
        n_violins = len(list(feature))
        if dm.shape[0] != n_violins:
            raise ValueError("`density` must have one row per violin.")
        if dm.shape[1] != g.size:
            raise ValueError("`density` must have one column per `grid` entry.")

        buffer, schema = pack_columns({"grid": g})
        json_columns: dict[str, list] = {
            "feature": [str(v) for v in feature],
            "group": [str(v) for v in group],
        }

        def categories_of(col: Any) -> list[str] | None:
            cats = getattr(getattr(col, "dtype", None), "categories", None)
            return None if cats is None else [str(v) for v in cats]

        if features is None:
            features = categories_of(feature)
        if groups is None:
            groups = categories_of(group)

        meta: dict[str, Any] = {
            "grid": [float(v) for v in g],
            # Row-major: the component indexes it as violin * gridLen + k.
            "density": [float(v) for v in dm.reshape(-1)],
        }
        for key, order, col in (
            ("features", features, json_columns["feature"]),
            ("groups", groups, json_columns["group"]),
        ):
            if order is None:
                continue
            order = [str(v) for v in order]
            unknown = sorted(set(col) - set(order))
            if unknown:
                raise ValueError(
                    f"value(s) not present in `{key}`: " + ", ".join(unknown[:5])
                )
            meta[key] = order
        if group_colors is not None:
            if groups is None or len(group_colors) != len(groups):
                raise ValueError("`group_colors` must have one entry per group.")
            meta["groupColors"] = [str(c) for c in group_colors]
        if grids is not None:
            gm = np.atleast_2d(np.asarray(grids, dtype=np.float32))
            if gm.shape[1] != g.size:
                raise ValueError("`grids` must have one column per `grid` entry.")
            n_feat = len(features) if features is not None else len(set(json_columns["feature"]))
            if gm.shape[0] != n_feat:
                raise ValueError("`grids` must have one row per feature.")
            meta["grids"] = [float(v) for v in gm.reshape(-1)]
        if median is not None:
            med = np.asarray(median).reshape(-1)
            if med.size != n_violins:
                raise ValueError("`median` must have one entry per violin.")
            meta["median"] = [float(v) for v in med]

        options: dict[str, Any] = {
            "violinWidth": violin_width,
            "scalePerViolin": scale_per_violin,
            "showMedian": show_median,
            "showFeatureLabels": show_feature_labels,
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
