"""Shared base widget and binary column packing for bioviz components.

Large datasets are packed into a single contiguous ``bytes`` buffer plus a tiny
JSON schema (mirroring ``@bioviz/core``'s ``BufferSchema``) instead of being
serialized as JSON. anywidget delivers the buffer to the browser as a
``DataView`` which the JS core decodes zero-copy into typed arrays.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import anywidget
import numpy as np
import traitlets

STATIC = Path(__file__).parent / "static"

# numpy dtype -> transport dtype string understood by @bioviz/core.
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


def _to_transport(arr: np.ndarray) -> tuple[np.ndarray, str]:
    """Return a contiguous array + transport dtype, casting unsupported types."""
    arr = np.ascontiguousarray(arr)
    name = arr.dtype.name
    if name in _DTYPE_MAP:
        return arr, _DTYPE_MAP[name]
    # 64-bit ints and exotic float types are downcast to a safe supported type.
    if np.issubdtype(arr.dtype, np.integer):
        return arr.astype(np.int32, copy=False), "int32"
    return arr.astype(np.float32, copy=False), "float32"


def pack_columns(numeric: Mapping[str, Any]) -> tuple[bytes, dict]:
    """Pack named numeric columns into one buffer + a ``BufferSchema`` dict."""
    buf = bytearray()
    specs: list[dict] = []
    offset = 0
    for name, values in numeric.items():
        arr, dtype = _to_transport(np.asarray(values))
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
    """Fetch a column from a DataFrame-like or mapping; None if absent."""
    try:
        return data[name]
    except (KeyError, TypeError, IndexError):
        return None


class BiovizWidget(anywidget.AnyWidget):
    """Base class for all bioviz widgets.

    Trait names mirror the JS adapter contract in
    ``@bioviz/components`` (``lib/anywidget.ts``).
    """

    # JSON side-channel: string columns + non-columnar metadata.
    data = traitlets.Dict({"columns": {}, "meta": {}}).tag(sync=True)
    # Binary numeric columns + their schema.
    buffer = traitlets.Bytes(b"").tag(sync=True)
    schema = traitlets.Dict({"columns": []}).tag(sync=True)
    # Component options (camelCase keys, matching the TS options interface).
    options = traitlets.Dict({}).tag(sync=True)
    _height = traitlets.Int(480).tag(sync=True)
