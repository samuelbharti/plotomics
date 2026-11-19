"""Stacked violin widget."""

from __future__ import annotations

import math
import numbers
from collections.abc import Mapping
from decimal import Decimal
from typing import Any

import numpy as np

from ._base import (
    STATIC,
    PlotomicsWidget,
    _category_levels,
    _column,
    _na_text,
    _not_in,
    _text_or_none,
    _to_float32,
    pack_columns,
)


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
        :func:`violin_density` computes them from raw values the way R
        does.
    median:
        Optional per-violin median, drawn as a tick.
    features, groups:
        Fix the row and column order. A pandas Categorical supplies it from its
        categories.
    group_colors:
        One hex colour per group. ``None`` uses the categorical palette.
    violin_width:
        Fraction of a cell's width the widest violin fills, in (0, 1]. When
        rows are short next to the column width (many features, or a short
        or wide widget), ``violin_aspect`` can make it fill less.
    violin_aspect:
        The largest width of the widest violin, as a multiple of its row
        height. A violin much wider than its row is tall reads as a flat
        band. The cap never makes a violin narrower than four times the
        label text size (44 px at the default font size), so with many
        features the violins stay visible; nor wider than ``violin_width``
        of its cell. ``None`` turns the cap off.
    scale_per_violin:
        Scale each violin to its own maximum rather than the row's. Per-row is
        the default so groups stay comparable within a feature.
    show_median, show_feature_labels:
        Toggle the median tick and the row labels.
    show_value_axis:
        Draw each row's value axis on the right, with the highest value of
        its grid and, on rows tall enough for two labels, the lowest.
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
        violin_aspect: float | None = 0.8,
        scale_per_violin: bool = False,
        show_median: bool = True,
        show_feature_labels: bool = True,
        show_value_axis: bool = True,
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
        violin_aspect = _violin_aspect(violin_aspect)

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
        # A missing feature or group crosses as null, as R sends an NA.
        json_columns: dict[str, list] = {
            "feature": _text_or_none(feature),
            "group": _text_or_none(group),
        }

        if features is None:
            features = _category_levels(feature)
        if groups is None:
            groups = _category_levels(group)

        meta: dict[str, Any] = {
            # Sent as float64, as R sends it: the axis labels the grid ends,
            # and float32 would turn 99.95 into 99.9499969.
            "grid": [float(v) for v in np.asarray(grid, dtype=np.float64).reshape(-1)],
            # Row-major: the component indexes it as violin * gridLen + k.
            "density": [float(v) for v in dm.reshape(-1)],
        }
        for key, order, col in (
            ("features", features, json_columns["feature"]),
            ("groups", groups, json_columns["group"]),
        ):
            if order is None:
                continue
            order = _text_or_none(order)
            unknown = _not_in(col, order)
            if unknown:
                raise ValueError(
                    f"value(s) not present in `{key}`: " + _na_text(unknown[:5])
                )
            meta[key] = order
        if group_colors is not None:
            # Without `groups`, colours follow the groups in order of first
            # appearance, the order the browser uses; R does the same.
            if groups is None:
                order = list(dict.fromkeys(json_columns["group"]))
                meta["groups"] = order
            else:
                order = meta["groups"]
            if len(group_colors) != len(order):
                raise ValueError("`group_colors` must have one entry per group.")
            meta["groupColors"] = [str(c) for c in group_colors]
        if grids is not None:
            gm = np.atleast_2d(np.asarray(grids, dtype=np.float64))
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
            # A violin with no values has no median: null, as R sends NA.
            meta["median"] = [
                float(v) if v is not None and np.isfinite(float(v)) else None
                for v in med
            ]

        options: dict[str, Any] = {
            "violinWidth": violin_width,
            "violinAspect": violin_aspect,
            "scalePerViolin": scale_per_violin,
            "showMedian": show_median,
            "showFeatureLabels": show_feature_labels,
            "showValueAxis": show_value_axis,
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


def violin_density(
    values: Mapping[str, Any], n: int = 64, adjust: float = 1.0
) -> dict[str, Any]:
    """Kernel densities for :class:`Violin`, on one grid shared by all violins.

    The same computation as R's ``violin_density()``, so the same values give
    the same violins in R and Python: a Gaussian kernel with R's default
    bandwidth (``bw.nrd0``) times ``adjust``, evaluated the way R's
    ``density()`` evaluates it. Uses numpy only.

    Parameters
    ----------
    values:
        A mapping from a name to an array of numbers, one entry per violin, in
        the order to draw them. A name ``"feature|group"`` gives the feature
        and the group; a name with no ``|`` is a feature with the group ``""``.
        Values that are not finite are left out.
    n:
        Number of grid points.
    adjust:
        Bandwidth multiplier, as in R's ``density()``.

    Returns
    -------
    dict
        ``data`` (``feature`` and ``group`` lists), ``grid`` (``n`` points
        from the smallest to the largest value), ``density`` (violins x
        ``n``; a violin with fewer than two distinct values is all zeros)
        and ``median`` (NaN for a violin with no values), ready for
        :class:`Violin`.

    Examples
    --------
    >>> import numpy as np
    >>> rng = np.random.default_rng(1)
    >>> d = violin_density({"CD3D|T": rng.normal(2, 1, 200),
    ...                     "CD3D|B": rng.normal(0, 1, 200)})
    >>> d["density"].shape
    (2, 64)
    >>> Violin(d["data"], grid=d["grid"], density=d["density"],
    ...        median=d["median"])  # doctest: +SKIP
    """
    if not isinstance(values, Mapping) or len(values) == 0:
        raise ValueError("`values` must be a named list of numeric vectors.")
    n = int(n)
    if n < 2:
        raise ValueError("`n` must be at least 2.")
    names = [str(k) for k in values.keys()]
    vecs = []
    for v in values.values():
        arr = np.asarray(v, dtype=np.float64).reshape(-1)
        vecs.append(arr[np.isfinite(arr)])
    every = np.concatenate(vecs)
    if every.size == 0:
        raise ValueError("`values` contains no finite numbers.")
    lo = float(every.min())
    hi = float(every.max())
    if lo == hi:
        hi = lo + 1.0
    grid = np.linspace(lo, hi, n)

    density = np.zeros((len(vecs), n))
    median = np.full(len(vecs), np.nan)
    for i, v in enumerate(vecs):
        if v.size:
            median[i] = float(np.median(v))
        if v.size >= 2 and np.unique(v).size >= 2:
            density[i] = _r_density(v, lo, hi, n, adjust)

    parts = [name.split("|") for name in names]
    return {
        "data": {
            "feature": [p[0] for p in parts],
            "group": [p[1] if len(p) > 1 else "" for p in parts],
        },
        "grid": grid,
        "density": density,
        "median": median,
    }


def _r_density(
    x: np.ndarray, start: float, end: float, n_out: int, adjust: float
) -> np.ndarray:
    """R's ``density(x, from = start, to = end, n = n_out, adjust = adjust)$y``.

    Gaussian kernel, ``bw.nrd0`` bandwidth, and R's method: the values are
    binned linearly onto at least 512 points, convolved with the kernel by
    FFT, and read off at the ``n_out`` grid points by linear interpolation.
    """
    nx = x.size
    # bw.nrd0: 0.9 * min(sd, IQR / 1.34) * n^(-1/5), quantiles of type 7.
    sd = float(np.std(x, ddof=1))
    q75, q25 = np.percentile(x, [75, 25])
    spread = min(sd, float(q75 - q25) / 1.34)
    if not spread:
        spread = sd or abs(float(x[0])) or 1.0
    bw = adjust * 0.9 * spread * nx ** (-0.2)

    n = max(n_out, 512)
    if n > 512:
        n = 2 ** int(np.ceil(np.log2(n)))
    lo = start - 4 * bw
    up = end + 4 * bw

    # Linear binning (R's C_BinDist), each value weighing 1 / nx.
    y = np.zeros(2 * n)
    delta = (up - lo) / (n - 1)
    pos = (x - lo) / delta
    ix = np.floor(pos).astype(np.int64)
    fx = pos - ix
    w = 1.0 / nx
    inside = (ix >= 0) & (ix <= n - 2)
    np.add.at(y, ix[inside], w * (1 - fx[inside]))
    np.add.at(y, ix[inside] + 1, w * fx[inside])
    left = ix == -1
    np.add.at(y, np.zeros(int(left.sum()), dtype=np.int64), w * fx[left])
    right = ix == n - 1
    np.add.at(y, ix[right], w * (1 - fx[right]))

    kords = np.linspace(0.0, (2 * n - 1) / (n - 1) * (up - lo), 2 * n)
    kords[n + 1 :] = -kords[n - 1 : 0 : -1]
    kords = np.exp(-0.5 * (kords / bw) ** 2) / (bw * np.sqrt(2 * np.pi))
    conv = np.fft.ifft(np.fft.fft(y) * np.conj(np.fft.fft(kords)))
    dens = np.maximum(0.0, conv.real[:n])
    xords = np.linspace(lo, up, n)
    return np.interp(np.linspace(start, end, n_out), xords, dens)


def _violin_aspect(value: Any) -> float | None:
    """The violin_aspect option as the browser takes it.

    Any real number above zero that is not a bool is taken: int, float,
    Fraction, Decimal, a numpy scalar, or a numpy array of one value with no
    dimensions. None and infinity turn the cap off and are sent as None,
    since JSON has no infinity. NaN, zero, negative and complex numbers,
    strings, bools and sequences are not taken.
    """
    if value is None:
        return None
    if isinstance(value, np.ndarray) and value.ndim == 0:
        value = value.item()
    out = math.nan
    # numpy registers its integer and floating scalars as numbers.Real, and
    # leaves out its complex ones.
    if isinstance(value, (numbers.Real, Decimal)) and not isinstance(
        value, (bool, np.bool_)
    ):
        try:
            out = float(value)
        except (TypeError, ValueError, OverflowError):
            out = math.nan
    if not out > 0:
        raise ValueError("`violin_aspect` must be a single positive number.")
    return out if math.isfinite(out) else None
