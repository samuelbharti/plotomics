"""Hi-C contact matrix widget."""

from __future__ import annotations

import math
import numbers
from collections.abc import Callable
from typing import Any, Literal

import numpy as np

from ._base import STATIC, PlotomicsWidget, _check_choice, _column, pack_columns

_COLORMAPS = ("viridis", "rdbu", "ltc", "ltcdiv")


class HiC(PlotomicsWidget):
    """GPU-accelerated Hi-C chromatin contact map.

    The contact matrix is normalized to an 8-bit texture and drawn as one WebGL
    quad, with the colormap applied in the fragment shader, so pan/zoom stays
    smooth on very large matrices. A precomputed level-of-detail pyramid keeps
    interaction fast when zoomed out. Genomic coordinate ticks and the colorbar
    are crisp vector overlays. No tile server is required.

    Parameters
    ----------
    matrix:
        Either a 2-D square array of contact counts (dense), as a NumPy array
        or a nested list of rows, or a COO-like triplet of ``(i, j, v)`` for
        the sparse form. A triplet may be given as a tuple ``(i, j, v)``, a
        mapping with keys ``i``/``j``/``v`` (e.g. a DataFrame), or via the
        ``i``, ``j``, ``v`` keyword arguments. A list of three sequences is also
        read as a triplet, unless it is a 3x3 nested list, which is read as a
        dense matrix; pass a tuple or the keywords for a three-contact triplet.
    n:
        Number of bins per axis. Required for the sparse form when it cannot be
        inferred from ``max(i, j) + 1``; ignored for a dense matrix.
    bin_size:
        Genomic bin size in base pairs, a positive number, used to label axes
        in bp/kb/Mb. ``None`` labels axes by bin index.
    chrom:
        Optional chromosome name shown as the axis title.
    colormap:
        Colormap for intensity: sequential ``"viridis"`` (default) or ``"ltc"``
        (an earthy teal to sand to rust ramp), or diverging ``"rdbu"`` or
        ``"ltcdiv"`` (its counterpart, neutral cream at the midpoint).
    transform:
        Intensity transform, ``"log"`` (default) or ``"linear"``.
    vmax:
        Upper clip of the intensity scale: a finite number greater than
        ``vmin``, and greater than 0 with the log transform. ``None``
        auto-picks a high percentile.
    vmax_percentile:
        Percentile in (0, 1] used for the auto ``vmax`` when ``vmax`` is
        ``None``. ``None`` uses the component default.
    vmin:
        Lower clip of the intensity scale, a finite number. ``None`` uses 0.
        With the log transform, or when ``vmin`` is 0 or more, values at or
        below it are drawn as background. With the linear transform and a
        negative ``vmin`` (for example observed/expected log2 ratios), values
        below it take the lowest color.
    symmetric:
        Mirror sparse ``i``/``j``/``v`` entries across the diagonal: ``True``
        or ``False``.
    label:
        Axis title (overrides ``chrom`` when set).
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
    >>> import numpy as np
    >>> n = 256
    >>> d = np.abs(np.subtract.outer(np.arange(n), np.arange(n)))
    >>> m = 1000 / (d + 1) ** 1.2 + np.random.rand(n, n)
    >>> m = (m + m.T) / 2  # symmetrize
    >>> HiC(m, bin_size=10_000, chrom="chr1")  # doctest: +SKIP

    >>> # sparse COO form
    >>> HiC((np.array([0, 1]), np.array([1, 2]), np.array([5.0, 3.0])), n=3)  # doctest: +SKIP
    """

    _esm = STATIC / "hic.js"

    def __init__(
        self,
        matrix: Any = None,
        *,
        i: Any = None,
        j: Any = None,
        v: Any = None,
        n: int | None = None,
        bin_size: float | None = None,
        chrom: str | None = None,
        colormap: Literal["viridis", "rdbu", "ltc", "ltcdiv"] = "viridis",
        transform: str = "log",
        vmax: float | None = None,
        vmax_percentile: float | None = None,
        vmin: float | None = 0.0,
        symmetric: bool = True,
        label: str | None = None,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if transform not in ("log", "linear"):
            raise ValueError("`transform` must be 'log' or 'linear'.")
        _check_choice(colormap, "colormap", _COLORMAPS)
        bin_size = _number(
            bin_size, "bin_size", "a single positive number", lambda v: v > 0
        )
        vmin = _number(vmin, "vmin")
        vmax = _number(vmax, "vmax")
        vmax_percentile = _number(
            vmax_percentile, "vmax_percentile", "in (0, 1]", lambda v: 0 < v <= 1
        )
        # A vmax at or below the bottom of the scale leaves every cell
        # background.
        if vmax is not None:
            if vmax <= (0.0 if vmin is None else vmin):
                raise ValueError("`vmax` must be greater than `vmin`.")
            if transform == "log" and vmax <= 0:
                raise ValueError(
                    "`vmax` must be greater than 0 with the log transform."
                )
        if not isinstance(symmetric, (bool, np.bool_)):
            raise ValueError("`symmetric` must be a single true or false value.")

        columns: dict[str, Any] = {}

        # Resolve the sparse triplet from any of the accepted shapes.
        if i is None and j is None and v is None and matrix is not None:
            i, j, v = _extract_triplet(matrix)

        if i is not None and j is not None and v is not None:
            i_arr = _numeric(i, "i", np.int32)
            j_arr = _numeric(j, "j", np.int32)
            v_arr = _numeric(v, "v", np.float32)
            # Empty triplet: fail clearly instead of building an n=0 matrix.
            if i_arr.size == 0:
                raise ValueError(
                    "sparse `i`/`j`/`v` triplet is empty; provide at least one "
                    "contact."
                )
            if not (i_arr.size == j_arr.size == v_arr.size):
                raise ValueError(
                    "`i`, `j` and `v` must have the same length; "
                    f"got i={i_arr.size}, j={j_arr.size}, v={v_arr.size}"
                )
            if n is None:
                n = int(max(int(i_arr.max()), int(j_arr.max())) + 1)
            n = int(n)
            if n <= 0:
                raise ValueError("`n` must be a positive number of bins.")
            if int(i_arr.min()) < 0 or int(j_arr.min()) < 0 or \
                    int(i_arr.max()) >= n or int(j_arr.max()) >= n:
                raise ValueError(
                    f"sparse indices `i`/`j` must be in [0, {n}); got "
                    f"i in [{int(i_arr.min())}, {int(i_arr.max())}], "
                    f"j in [{int(j_arr.min())}, {int(j_arr.max())}]"
                )
            columns = {"i": i_arr, "j": j_arr, "v": v_arr}
        elif matrix is not None:
            arr = _numeric(matrix, "matrix", np.float32)
            if arr.ndim != 2 or arr.shape[0] != arr.shape[1]:
                raise ValueError("`matrix` must be a square 2-D array.")
            n = int(arr.shape[0])
            if n == 0:
                raise ValueError("`matrix` must contain at least one row and one column.")
            # Row-major (C order) flatten to match the JS `values` contract.
            columns = {"values": np.ascontiguousarray(arr).reshape(-1)}
        else:
            raise ValueError(
                "Provide a dense `matrix` or a sparse triplet (i, j, v)."
            )

        buffer, schema = pack_columns(columns)

        meta: dict[str, Any] = {"n": int(n)}
        if bin_size is not None:
            meta["binSize"] = bin_size
        if chrom is not None:
            meta["chrom"] = str(chrom)

        options: dict[str, Any] = {
            "colormap": colormap,
            "transform": transform,
            "symmetric": bool(symmetric),
        }
        if vmin is not None:
            options["vmin"] = vmin
        # `vmax=None` means auto; only send it when the user fixed it.
        if vmax is not None:
            options["vmax"] = vmax
        if vmax_percentile is not None:
            options["vmaxPercentile"] = vmax_percentile
        if label is not None:
            options["label"] = str(label)
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


def _number(
    value: Any,
    name: str,
    what: str = "a single finite number",
    ok: Callable[[float], bool] | None = None,
) -> float | None:
    """``value`` as a float, or None when it is None (the argument is unset).

    NaN, an infinite value, text, a bool, a sequence, or a value ``ok``
    refuses raises ``ValueError("`name` must be what.")``, as R does.
    """
    if value is None:
        return None
    number = math.nan
    if isinstance(value, numbers.Real) and not isinstance(value, (bool, np.bool_)):
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            number = math.nan
    if not math.isfinite(number) or (ok is not None and not ok(number)):
        raise ValueError(f"`{name}` must be {what}.")
    return number


def _numeric(values: Any, name: str, dtype: Any) -> np.ndarray:
    """Coerce to a numeric array, with a clear column-named error on bad data."""
    try:
        return np.asarray(values, dtype=dtype)
    except (ValueError, TypeError):
        raise ValueError(f"`{name}` must be numeric.") from None


def _extract_triplet(matrix: Any) -> tuple[Any, Any, Any] | tuple[None, None, None]:
    """Pull (i, j, v) out of a mapping/DataFrame or a 3-tuple; else all None."""
    # A tuple of three sequences is always a triplet.
    if isinstance(matrix, tuple) and len(matrix) == 3:
        return matrix[0], matrix[1], matrix[2]
    # A list of three sequences is a triplet too, except a 3x3 nested list,
    # which reads as a dense matrix of three rows.
    if isinstance(matrix, list) and len(matrix) == 3:
        if all(_is_row_of(row, 3) for row in matrix):
            return None, None, None
        return matrix[0], matrix[1], matrix[2]
    # A dense numpy matrix has no named columns; it is handled by the caller.
    if isinstance(matrix, np.ndarray):
        return None, None, None
    # mapping / DataFrame with i/j/v columns
    i = _column(matrix, "i")
    j = _column(matrix, "j")
    v = _column(matrix, "v")
    if i is not None and j is not None and v is not None:
        return i, j, v
    return None, None, None


def _is_row_of(row: Any, length: int) -> bool:
    """Whether ``row`` is a non-string sequence of exactly ``length`` items."""
    if isinstance(row, (str, bytes)):
        return False
    try:
        return len(row) == length
    except TypeError:
        return False
