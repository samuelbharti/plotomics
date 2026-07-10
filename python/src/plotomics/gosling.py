"""Gosling declarative genomics widget."""

from __future__ import annotations

from typing import Any, Mapping

from ._base import STATIC, PlotomicsWidget

# Top-level keys that mark a mapping as a plausible Gosling specification.
_SPEC_KEYS = ("tracks", "views", "arrangement", "alignment", "template")


class Gosling(PlotomicsWidget):
    """Declarative genomics figures powered by Gosling.js.

    Gosling (grammar of scalable, linked, interactive nucleotide graphics) is
    fully config-driven: you pass a Gosling *specification* as a ``dict`` and
    data flows through the spec's own ``data`` blocks (tileset URLs, indexed
    BAM/BED/VCF/BigWig, or CSV/JSON URLs and inline values). Gosling streams and
    tiles large genomic datasets on the GPU via HiGlass, so there is no separate
    ``data`` argument.

    Parameters
    ----------
    spec:
        A Gosling specification as a (nested) ``dict``. It is passed through
        verbatim to Gosling.js, so keys use Gosling's own camelCase names (e.g.
        ``tracks``, ``xDomain``, ``alignment``). Must contain at least one of
        ``tracks``, ``views``, ``arrangement``, ``alignment`` or ``template``.
    padding:
        Optional outer padding (pixels) forwarded to Gosling's embed options.
    theme:
        Optional Gosling theme: a built-in name (e.g. ``"dark"``) or a theme
        dict.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> spec = {
    ...     "tracks": [
    ...         {
    ...             "data": {
    ...                 "url": "https://server.gosling-lang.org/api/v1/"
    ...                 "tileset_info/?d=cistrome-multivec",
    ...                 "type": "multivec",
    ...                 "row": "sample",
    ...                 "column": "position",
    ...                 "value": "peak",
    ...                 "categories": ["sample 1"],
    ...             },
    ...             "mark": "bar",
    ...             "x": {"field": "start", "type": "genomic"},
    ...             "xe": {"field": "end", "type": "genomic"},
    ...             "y": {"field": "peak", "type": "quantitative"},
    ...             "width": 700,
    ...             "height": 200,
    ...         }
    ...     ]
    ... }
    >>> Gosling(spec)  # doctest: +SKIP
    """

    _esm = STATIC / "gosling.js"

    def __init__(
        self,
        spec: Mapping[str, Any],
        *,
        padding: float | None = None,
        theme: Any | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        if not isinstance(spec, Mapping):
            raise ValueError("`spec` must be a mapping (a Gosling specification).")
        if not any(k in spec for k in _SPEC_KEYS):
            raise ValueError(
                "`spec` must contain at least one of: " + ", ".join(_SPEC_KEYS) + "."
            )

        options: dict[str, Any] = {"spec": dict(spec)}
        if padding is not None:
            options["padding"] = padding
        if theme is not None:
            options["theme"] = theme

        # Gosling is spec-driven; the shared runtime still expects a `data`
        # payload, so empty columns/meta are supplied.
        super().__init__(
            data={"columns": {}, "meta": {}},
            options=options,
            _height=height,
            **kwargs,
        )
