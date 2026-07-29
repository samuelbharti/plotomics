"""Shared base widget and binary column packing for plotomics components.

Large datasets are packed into a single contiguous ``bytes`` buffer plus a tiny
JSON schema (mirroring ``@plotomics/core``'s ``BufferSchema``) instead of being
serialized as JSON. anywidget delivers the buffer to the browser as a
``DataView`` which the JS core decodes zero-copy into typed arrays.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any, Mapping

import anywidget
import numpy as np
import traitlets

STATIC = Path(__file__).parent / "static"

# numpy dtype -> transport dtype string understood by @plotomics/core.
_DTYPE_MAP: dict[str, str] = {
    "float32": "float32",
    "float64": "float64",
    "int8": "int8",
    "int16": "int16",
    "int32": "int32",
    "uint8": "uint8",
    "uint16": "uint16",
    "uint32": "uint32",
}

# numpy dtype kinds that cannot be packed into the binary transport at all:
# object, unicode string, bytes, datetime64, timedelta64 and void/structured.
_NON_NUMERIC_KINDS = frozenset("OUSMmV")


def _ensure_numeric(arr: np.ndarray, name: str) -> np.ndarray:
    """Raise a clear, column-named error if ``arr`` is not a numeric dtype."""
    if arr.dtype.kind in _NON_NUMERIC_KINDS:
        raise ValueError(
            f"column '{name}' must be numeric; got dtype {arr.dtype.name}"
        )
    return arr


def _to_float32(values: Any, name: str) -> np.ndarray:
    """Coerce ``values`` to a ``float32`` array, with a clear error on bad dtype.

    Components use this for coordinate/weight columns so that a string or object
    column raises a helpful, column-named message instead of numpy's raw
    ``could not convert string to float`` error.
    """
    arr = np.asarray(values)
    if arr.dtype.kind in _NON_NUMERIC_KINDS:
        # pandas nullable extension dtypes (Int64/Float64/boolean) and object
        # columns of python numbers surface as kind 'O' under ``np.asarray``.
        # Try an explicit float coercion first (a clean nullable column becomes
        # float; NA/None become NaN) so these keep working on the happy path;
        # only a genuinely non-numeric column falls through to the clear error.
        try:
            return np.asarray(values, dtype=np.float32)
        except (ValueError, TypeError):
            _ensure_numeric(arr, name)  # raises the friendly, column-named error
    return arr.astype(np.float32, copy=False)


def _warn_nonfinite(arr: np.ndarray, name: str) -> None:
    """Emit exactly one warning if a float column carries NaN/Inf values."""
    if arr.dtype.kind != "f":
        return
    count = int(np.count_nonzero(~np.isfinite(arr)))
    if count:
        warnings.warn(
            f"column '{name}' contains {count} non-finite value(s) (NaN/Inf)",
            stacklevel=3,
        )


def _to_transport(arr: np.ndarray, name: str) -> tuple[np.ndarray, str]:
    """Return a contiguous array + transport dtype for a single named column.

    Raises ``ValueError`` (naming the column) on a non-numeric dtype or on 64-bit
    integer values that would overflow ``int32``; warns once on NaN/Inf. Keeps
    the float32/float64 and small-int fast paths untouched.
    """
    arr = np.ascontiguousarray(arr)
    dtype = arr.dtype
    tname = dtype.name

    # Non-numeric (object/string/datetime/...) cannot be packed: fail clearly.
    if dtype.kind in _NON_NUMERIC_KINDS:
        raise ValueError(
            f"column '{name}' must be numeric; got dtype {tname}"
        )

    # Fast path: already a supported transport dtype.
    if tname in _DTYPE_MAP:
        _warn_nonfinite(arr, name)
        return arr, _DTYPE_MAP[tname]

    # 64-bit ints (and other unsupported integers) downcast to int32, but only
    # when every value fits -- silent truncation would corrupt the data.
    if np.issubdtype(dtype, np.integer):
        info = np.iinfo(np.int32)
        lo = int(arr.min()) if arr.size else 0
        hi = int(arr.max()) if arr.size else 0
        if lo < info.min or hi > info.max:
            raise ValueError(
                f"column '{name}' has integer values outside the int32 range "
                f"[{info.min}, {info.max}]; got [{lo}, {hi}]"
            )
        return arr.astype(np.int32, copy=False), "int32"

    # Any other numeric dtype (e.g. float16) is transported as float32.
    arr = arr.astype(np.float32, copy=False)
    _warn_nonfinite(arr, name)
    return arr, "float32"


def pack_columns(
    numeric: Mapping[str, Any], *, equal_length: bool = True
) -> tuple[bytes, dict]:
    """Pack named numeric columns into one buffer + a ``BufferSchema`` dict.

    Parameters
    ----------
    numeric:
        Mapping of column name to array-like numeric values.
    equal_length:
        When ``True`` (default) every column must have the same length; a
        mismatch raises ``ValueError`` naming the columns and their lengths.
        Pass ``False`` when intentionally packing columns of different lengths
        (e.g. per-node and per-edge columns share one buffer in ``network``).
    """
    converted: list[tuple[str, np.ndarray, str]] = []
    for name, values in numeric.items():
        arr, dtype = _to_transport(np.asarray(values), name)
        converted.append((name, arr, dtype))

    if equal_length and len(converted) > 1:
        sizes = {name: int(arr.size) for name, arr, _ in converted}
        if len(set(sizes.values())) > 1:
            detail = ", ".join(f"{n}={s}" for n, s in sizes.items())
            raise ValueError(
                f"columns must all have the same length; got {detail}"
            )

    buf = bytearray()
    specs: list[dict] = []
    offset = 0
    for name, arr, dtype in converted:
        raw = arr.tobytes()
        specs.append(
            {
                "name": name,
                "dtype": dtype,
                "length": int(arr.size),
                "byteOffset": offset,
            }
        )
        buf.extend(raw)
        offset += len(raw)
    return bytes(buf), {"columns": specs}


def _column(data: Any, name: str) -> Any | None:
    """Fetch a column from a DataFrame-like or mapping; ``None`` if absent.

    A plain numpy array has no named columns, so indexing it by a string key
    would silently yield ``None`` and later surface as a confusing "must provide
    x/y" error. Instead, reject it up front with an actionable message telling
    the caller to pass a DataFrame / dict of named columns.
    """
    if isinstance(data, np.ndarray):
        raise ValueError(
            "expected a pandas DataFrame or a dict of named columns, but got a "
            "plain numpy array; wrap your data with named columns "
            "(e.g. a pandas.DataFrame or a dict of arrays)."
        )
    try:
        return data[name]
    except (KeyError, TypeError, IndexError):
        return None


class PlotomicsWidget(anywidget.AnyWidget):
    """Base class for all plotomics widgets.

    Trait names mirror the JS adapter contract in
    ``@plotomics/components`` (``lib/anywidget.ts``).
    """

    # JSON side-channel: string columns + non-columnar metadata.
    data = traitlets.Dict({"columns": {}, "meta": {}}).tag(sync=True)
    # Binary numeric columns + their schema.
    buffer = traitlets.Bytes(b"").tag(sync=True)
    schema = traitlets.Dict({"columns": []}).tag(sync=True)
    # Component options (camelCase keys, matching the TS options interface).
    options = traitlets.Dict({}).tag(sync=True)
    _height = traitlets.Int(480).tag(sync=True)
    # JS -> Python: the latest selection from the component. Its shape depends on
    # the component: a list of point indices for a lasso selection (Embedding),
    # or a single clicked node id (a string) or None for a click selection
    # (Network). Observe it with ``widget.observe(fn, names="selected")``.
    selected = traitlets.Any(default_value=[]).tag(sync=True)

    def export(self, fmt: str = "png") -> None:
        """Download the current on-screen view as ``"png"`` or ``"svg"``.

        The figure is rendered in the browser, so this posts a message to the
        front-end which performs the download; nothing is returned to Python.
        """
        if fmt not in ("png", "svg"):
            raise ValueError(f"fmt must be 'png' or 'svg', got {fmt!r}")
        self.send({"plotomics": "export", "format": fmt})
