"""Genome viewer widget (igv.js)."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from ._base import STATIC, PlotomicsWidget


class IGV(PlotomicsWidget):
    """Embeddable interactive genome browser powered by igv.js.

    Unlike the other plotomics widgets this one is *config-driven*: igv.js streams
    and tiles remote indexed files (BAM/CRAM, bigWig, VCF, BED, ...) itself, so
    data flows through the browser configuration as URLs rather than as columns.

    Supply either a full igv.js ``config`` or the convenience arguments
    ``genome``, ``locus`` and ``tracks``, which are assembled into a config when
    ``config`` is ``None``. A later change to ``options["locus"]`` or
    ``options["tracks"]`` applies to the live browser in both cases.

    Parameters
    ----------
    genome:
        Genome identifier understood by igv.js (e.g. ``"hg38"``, ``"hg19"``,
        ``"mm10"``). Used when ``config`` is ``None``. ``None`` sends no
        genome, so igv.js starts with no reference loaded, as ``genome: null``
        does in JavaScript; pass a ``config`` with a ``reference`` for an
        assembly igv.js does not know.
    locus:
        Optional initial locus, e.g. ``"chr8:127,736,588-127,739,371"``, or a
        gene symbol.
    tracks:
        A sequence of igv.js track configuration dicts (each with at least a
        ``url``). Used when ``config`` is ``None``. Tracks are additive: a
        track already shown is not loaded again, a changed track loads as a
        new one, and a track left out stays shown.
    config:
        Optional full igv.js browser configuration dict. When supplied it is
        passed through as-is and ``genome``, ``locus`` and ``tracks`` are not
        sent.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> IGV(genome="hg38")  # doctest: +SKIP
    >>> IGV(  # doctest: +SKIP
    ...     genome="hg38",
    ...     locus="chr8:127,736,588-127,739,371",
    ...     tracks=[{
    ...         "name": "CTCF",
    ...         "url": "https://www.encodeproject.org/files/ENCFF356YES/@@download/ENCFF356YES.bigWig",
    ...         "format": "bigWig",
    ...     }],
    ... )
    """

    _esm = STATIC / "igv.js"

    def __init__(
        self,
        *,
        genome: str | None = "hg38",
        locus: str | None = None,
        tracks: Sequence[Mapping[str, Any]] | None = None,
        config: Mapping[str, Any] | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        options: dict[str, Any] = {}
        if config is not None:
            options["config"] = dict(config)
        else:
            # None crosses as null, so the browser's "hg38" default does not
            # take its place.
            options["genome"] = genome
            if locus is not None:
                options["locus"] = locus
            if tracks:
                options["tracks"] = [dict(t) for t in tracks]

        # igv streams via config URLs, so there are no data columns.
        super().__init__(
            data={"columns": {}, "meta": {}},
            options=options,
            _height=height,
            **kwargs,
        )
