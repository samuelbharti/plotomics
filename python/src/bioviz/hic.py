"""Hi-C contact matrix widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, BiovizWidget, _column, pack_columns


class HiC(BiovizWidget):
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
    vmin:
        Lower clip of the intensity scale.
    symmetric:
        Mirror sparse ``i``/``j``/``v`` entries across the diagonal.
    label:
        Axis title (overrides ``chrom`` when set).
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
        vmin: float = 0.0,
        symmetric: bool = True,
        label: str | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        columns: dict[str, Any] = {}

        # Resolve the sparse triplet from any of the accepted shapes.
        if i is None and j is None and v is None and matrix is not None:
            i, j, v = _extract_triplet(matrix)

        if i is not None and j is not None and v is not None:
            i_arr = np.asarray(i, dtype=np.int32)
            j_arr = np.asarray(j, dtype=np.int32)
            v_arr = np.asarray(v, dtype=np.float32)
            if n is None:
                n = int(max(int(i_arr.max(initial=-1)), int(j_arr.max(initial=-1))) + 1)
            columns = {"i": i_arr, "j": j_arr, "v": v_arr}
        elif matrix is not None:
            arr = np.asarray(matrix, dtype=np.float32)
            if arr.ndim != 2 or arr.shape[0] != arr.shape[1]:
                raise ValueError("`matrix` must be a square 2-D array.")
            n = int(arr.shape[0])
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
        if label is not None:
            options["label"] = str(label)

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": {}, "meta": meta},
            options=options,
            _height=height,
            **kwargs,
        )


def _extract_triplet(matrix: Any) -> tuple[Any, Any, Any] | tuple[None, None, None]:
    """Pull (i, j, v) out of a mapping/DataFrame or a 3-tuple; else all None."""
    # tuple/list of three sequences
    if isinstance(matrix, (tuple, list)) and len(matrix) == 3:
        return matrix[0], matrix[1], matrix[2]
    # mapping / DataFrame with i/j/v columns
    i = _column(matrix, "i")
    j = _column(matrix, "j")
    v = _column(matrix, "v")
    if i is not None and j is not None and v is not None:
        return i, j, v
    return None, None, None
