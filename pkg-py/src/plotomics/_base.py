"""Shared base widget and binary column packing for plotomics components.

Large datasets are packed into a single contiguous ``bytes`` buffer plus a tiny
JSON schema (mirroring ``plotomics/core``'s ``BufferSchema``) instead of being
serialized as JSON. anywidget delivers the buffer to the browser as a
``DataView`` which the JS core decodes zero-copy into typed arrays.
"""

from __future__ import annotations

import math
import warnings
from pathlib import Path
from typing import Any, Mapping

import anywidget
import numpy as np
import traitlets

STATIC = Path(__file__).parent / "static"

# numpy dtype -> transport dtype string understood by plotomics/core.
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


def _little_endian(arr: np.ndarray) -> np.ndarray:
    """``arr`` with its bytes in little-endian order, the order JS reads.

    A typed array in the browser reads the bytes in the order of the machine,
    which is little-endian on every platform a notebook runs on. A big-endian
    array, as h5py or FITS files give, keeps its own order in ``tobytes()``,
    so it is converted first. An array already in that order is not copied.
    """
    little = arr.dtype.newbyteorder("<")
    return arr if arr.dtype == little else arr.astype(little)


def _to_transport(arr: np.ndarray, name: str) -> tuple[np.ndarray, str]:
    """Return a contiguous array + transport dtype for a single named column.

    Raises ``ValueError`` (naming the column) on a non-numeric dtype or on 64-bit
    integer values that would overflow ``int32``; warns once on NaN/Inf. Keeps
    the float32/float64 and small-int fast paths untouched. The array comes
    back in little-endian byte order, whatever order it came in.
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
        return _little_endian(arr), _DTYPE_MAP[tname]

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
        return _little_endian(arr.astype(np.int32, copy=False)), "int32"

    # Any other numeric dtype (e.g. float16) is transported as float32.
    arr = arr.astype(np.float32, copy=False)
    _warn_nonfinite(arr, name)
    return _little_endian(arr), "float32"


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
    _reject_lazy(data)
    # Ask for the name only when the frame or mapping has it: polars raises
    # its own ColumnNotFoundError for a missing column, which is none of the
    # errors a pandas frame or a dict raises. A pyarrow Table keeps the names
    # in `column_names`, and its `columns` holds the arrays.
    columns = getattr(data, "column_names", None)
    if columns is None:
        columns = getattr(data, "columns", None)
    if columns is not None and not isinstance(data, Mapping):
        try:
            if name not in list(columns):
                return None
        except (TypeError, ValueError):
            pass
    elif isinstance(data, Mapping) and name not in data:
        return None
    try:
        return data[name]
    except (KeyError, TypeError, IndexError, LookupError):
        return None


def _reject_lazy(data: Any) -> None:
    """Stop with a clear message for a polars LazyFrame.

    A LazyFrame holds a query, not its rows, so it has no column to read:
    indexing it fails, and reading its column names runs part of the query.
    Collecting it here would run the whole query once for every column, so
    the caller is asked to collect it once.
    """
    kind = type(data)
    if kind.__name__ == "LazyFrame" and kind.__module__.startswith("polars"):
        raise ValueError(
            "got a polars LazyFrame, which holds a query, not its rows; "
            "call `.collect()` on it and pass the DataFrame."
        )


_PADDING_SIDES = ("top", "right", "bottom", "left")
_PADDING_ERROR = (
    "theme['padding'] must be a number of 0 or more, or a dict of them "
    "with keys from top, right, bottom and left."
)


def _padding_number(value: Any) -> float | None:
    """``value`` as a float when it is a finite number of 0 or more, else None."""
    if isinstance(value, (bool, np.bool_)):
        return None
    if not isinstance(value, (int, float, np.integer, np.floating)):
        return None
    number = float(value)
    return number if math.isfinite(number) and number >= 0 else None


def _check_theme_padding(options: Mapping[str, Any]) -> dict[str, Any]:
    """Check ``options["theme"]["padding"]`` and shape it for the browser.

    The padding is the space in px between the edge of the widget and the
    plot. A number of 0 or more sets all four sides and is sent as a number.
    A dict with keys from top, right, bottom and left sets those sides and is
    sent as an object. ``None`` sends no padding. Anything else (a negative
    number, NaN, infinity, text, another key) raises the ValueError that R
    raises too.
    """
    theme = options.get("theme")
    if not isinstance(theme, Mapping) or "padding" not in theme:
        return dict(options)
    padding = theme["padding"]
    theme = dict(theme)
    if padding is None:
        del theme["padding"]
        return {**options, "theme": theme}
    if isinstance(padding, Mapping):
        sides = {k: _padding_number(v) for k, v in padding.items()}
        if (
            not sides
            or any(k not in _PADDING_SIDES for k in sides)
            or any(v is None for v in sides.values())
        ):
            raise ValueError(_PADDING_ERROR)
        theme["padding"] = sides
    else:
        number = _padding_number(padding)
        if number is None:
            raise ValueError(_PADDING_ERROR)
        theme["padding"] = number
    return {**options, "theme": theme}


class PlotomicsWidget(anywidget.AnyWidget):
    """Base class for all plotomics widgets.

    Trait names mirror the JS adapter contract in
    ``plotomics`` (``lib/anywidget.ts``).
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
    # Whether ``options["theme"]`` is a plotomics theme, whose padding is
    # checked. Gosling takes a Gosling theme there.
    _plotomics_theme = True

    @traitlets.validate("options")
    def _validate_options(self, proposal: Any) -> dict[str, Any]:
        options = proposal["value"]
        if not self._plotomics_theme:
            return options
        return _check_theme_padding(options)

    def export(self, fmt: str = "png") -> None:
        """Download the current on-screen view as ``"png"`` or ``"svg"``.

        The figure is rendered in the browser, so this posts a message to the
        front-end which performs the download; nothing is returned to Python.
        """
        if fmt not in ("png", "svg"):
            raise ValueError(f"fmt must be 'png' or 'svg', got {fmt!r}")
        self.send({"plotomics": "export", "format": fmt})


def _text_or_none(values: Any) -> list[str | None]:
    """Text of each value, with a missing value (None, NaN, pandas NA) as None.

    ``str(v)`` turns a missing value into the text "None", "nan" or "<NA>",
    which the browser would show as a real label or category. None crosses as
    JSON null, which the components read as missing.
    """
    out: list[str | None] = []
    for v in values:
        # A pyarrow value, null included, as the Python value it holds.
        if hasattr(v, "as_py"):
            v = v.as_py()
        missing = (
            v is None
            or type(v).__name__ in ("NAType", "NaTType")
            or (isinstance(v, (float, np.floating)) and bool(np.isnan(v)))
        )
        out.append(None if missing else str(v))
    return out


def _na_text(values: Any) -> str:
    """Values joined for an error message, a missing one written NA as in R."""
    return ", ".join("NA" if v is None else str(v) for v in values)


def _not_in(values: Any, allowed: Any) -> list[str | None]:
    """The distinct values not in ``allowed``, in order of first appearance.

    As R's ``setdiff(unique(values), allowed)``: a missing value (None) is
    listed too when ``allowed`` has no None.
    """
    allowed = set(allowed)
    return [v for v in dict.fromkeys(values) if v not in allowed]


def _category_levels(values: Any) -> list[str] | None:
    """The level order a categorical column states, or None when it states none.

    A pandas Categorical states its levels, unused ones included, as an R
    factor does. A polars Categorical states none: its ``categories`` list
    every string any Categorical in the session has seen, so its values are
    read as text, in order of appearance. A polars Enum states its own.
    """
    dtype = getattr(values, "dtype", None)
    cats = getattr(dtype, "categories", None)
    if cats is None:
        return None
    if type(dtype).__name__ == "Categorical" and type(dtype).__module__.startswith(
        "polars"
    ):
        return None
    return [str(v) for v in cats]


def _numeric_values(values: Any, dtype: Any = np.float32) -> np.ndarray | None:
    """A colour column as float32 when it holds numbers, else None.

    A missing value (None, NaN, pandas NA) does not decide the type, so a
    numeric column that starts with None stays numeric, with NaN for each
    missing value. Text, or a Categorical, gives None.
    """
    if getattr(getattr(values, "dtype", None), "categories", None) is not None:
        return None
    arr = np.asarray(values)
    if arr.dtype.kind == "b":
        return None
    if np.issubdtype(arr.dtype, np.number):
        return arr.astype(dtype)
    present = [v for v in _text_or_none(arr.tolist()) if v is not None]
    if not present:
        return None
    out = []
    for v in arr.tolist():
        if _text_or_none([v])[0] is None:
            out.append(np.nan)
        elif isinstance(v, (int, float, np.number)) and not isinstance(v, bool):
            out.append(float(v))
        else:
            return None
    return np.asarray(out, dtype=dtype)


def _as_matrix(matrix: Any) -> tuple[np.ndarray, list | None, list | None]:
    """Coerce a matrix to a 2-D float32 array, with labels from a DataFrame.

    Returns ``(array, row_labels_or_None, col_labels_or_None)``. A DataFrame
    is read through ``to_numpy`` with NA as NaN, so nullable ``Int64`` and
    ``Float64`` columns with a missing value work. Anything else, a nested
    list included, goes through ``np.asarray``.
    """
    _reject_lazy(matrix)
    # A list has an ``index`` method too, so a frame needs ``columns`` as well.
    is_frame = hasattr(matrix, "index") and hasattr(matrix, "columns")
    if is_frame:
        # Dates and durations convert to large numbers without complaint;
        # R rejects them, so Python does too.
        kinds = {getattr(dt, "kind", "") for dt in getattr(matrix, "dtypes", [])}
        if kinds & {"m", "M"}:
            raise ValueError("`matrix` must be numeric; it has a date column.")
    try:
        if is_frame:
            try:
                arr = matrix.to_numpy(dtype=np.float32, na_value=np.nan)
            except (AttributeError, TypeError):
                # A frame-like object without pandas' to_numpy keywords.
                arr = np.asarray(getattr(matrix, "values", matrix), dtype=np.float32)
            return arr, list(matrix.index), list(matrix.columns)
        return np.asarray(matrix, dtype=np.float32), None, None
    except (TypeError, ValueError) as err:
        if "inhomogeneous" in str(err):
            raise ValueError(
                "`matrix` rows must all have the same length."
            ) from None
        raise ValueError("`matrix` must be numeric.") from None


def _check_labels(labels: Any, n: int, name: str) -> list[str | None] | None:
    """Labels as text, checked to have one entry per row or column.

    A missing label (None, NaN, pandas NA) is None, which crosses as null, as
    R sends an NA row or column name; the browser draws no text for it.
    """
    if labels is None:
        return None
    out = _text_or_none(labels)
    if len(out) != n:
        raise ValueError(f"`{name}` has {len(out)} entries; expected {n}.")
    return out


def _check_choice(value: Any, name: str, choices: tuple[str, ...]) -> str:
    """Stop with a clear message when ``value`` is not one of ``choices``.

    The browser cannot draw an unknown colormap or mode and would leave the
    widget blank, so the wrappers check every choice the way R's
    ``match.arg`` does.
    """
    if value not in choices:
        listed = ", ".join(repr(c) for c in choices)
        raise ValueError(f"`{name}` must be one of {listed}; got {value!r}.")
    return value
