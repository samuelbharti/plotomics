"""Hi-C contact matrix widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, pack_columns


class HiC(PlotomicsWidget):
    """GPU-accelerated Hi-C chromatin contact map.

    The contact matrix is uploaded once as a single-channel float texture and
    drawn as one WebGL quad; the colormap and the log/linear transform run in
    the fragment shader, so pan/zoom stays smooth on very large matrices. A
    precomputed level-of-detail pyramid keeps interaction fast when zoomed out.
    Genomic coordinate ticks and the colorbar are crisp vector overlays. No
    tile server is required.

    Parameters
    ----------
    matrix:
        Either a 2-D square NumPy array of contact counts (dense), or a
        COO-like triplet of ``(i, j, v)`` for the sparse form. A triplet may be
        given as a tuple/list ``(i, j, v)``, a mapping with keys ``i``/``j``/``v``
        (e.g. a DataFrame), or via the ``i``, ``j``, ``v`` keyword arguments.
    n:
        Number of bins per axis. Required for the sparse form when it cannot be
        inferred from ``max(i, j) + 1``; ignored for a dense matrix.
    bin_size:
        Genomic bin size in base pairs, used to label axes in bp/kb/Mb. ``None``
        labels axes by bin index.
    chrom:
        Optional chromosome name shown as the axis title.
    colormap:
        Sequential colormap for intensity (currently ``"viridis"``).
    transform:
        Intensity transform, ``"log"`` (default) or ``"linear"``.
    vmax:
        Upper clip of the intensity scale; ``None`` auto-picks a high percentile.
    vmax_percentile:
        Percentile (0-1) used for the auto ``vmax`` when ``vmax`` is ``None``.
    vmin:
        Lower clip of the intensity scale.
    symmetric:
        Mirror sparse ``i``/``j``/``v`` entries across the diagonal.
    label:
        Axis title (overrides ``chrom`` when set).
    theme:
        Optional theme overrides forwarded to the JS renderer.
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
        colormap: str = "viridis",
        transform: str = "log",
        vmax: float | None = None,
        vmax_percentile: float | None = None,
        vmin: float = 0.0,
        symmetric: bool = True,
        label: str | None = None,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if transform not in ("log", "linear"):
            raise ValueError("`transform` must be 'log' or 'linear'.")

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
            meta["binSize"] = float(bin_size)
        if chrom is not None:
            meta["chrom"] = str(chrom)

        options: dict[str, Any] = {
            "colormap": colormap,
            "transform": transform,
            "vmin": float(vmin),
            "symmetric": bool(symmetric),
        }
        # `vmax=None` means auto; only send it when the user fixed it.
        if vmax is not None:
            options["vmax"] = float(vmax)
        if vmax_percentile is not None:
            options["vmaxPercentile"] = float(vmax_percentile)
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


def _numeric(values: Any, name: str, dtype: Any) -> np.ndarray:
    """Coerce to a numeric array, with a clear column-named error on bad data."""
    try:
        return np.asarray(values, dtype=dtype)
    except (ValueError, TypeError):
        raise ValueError(f"`{name}` must be numeric.") from None


def _extract_triplet(matrix: Any) -> tuple[Any, Any, Any] | tuple[None, None, None]:
    """Pull (i, j, v) out of a mapping/DataFrame or a 3-tuple; else all None."""
    # tuple/list of three sequences
    if isinstance(matrix, (tuple, list)) and len(matrix) == 3:
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
