"""Spatial map over a tissue image."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Spatial(PlotomicsWidget):
    """Measurements plotted at their real coordinates, over the histology.

    This is the layout of a spatial transcriptomics experiment: capture spots
    on the slide, drawn on top of the H&E section they came from. For a spatial
    assay the tissue *is* the axis, and a cluster tracing the edge of an
    invasive front says something an embedding cannot.

    The image and the spots share one "contain" fit, computed once, so
    histology and overlay cannot drift apart on resize, full-screen, or a
    high-DPI display.

    ``color`` may be strings (categorical, discrete legend) or numbers
    (continuous, sequential ramp with a colourbar), which is what lets one view
    toggle between colouring by cluster and by a gene's expression.

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or mapping of arrays with numeric ``x`` and
        ``y`` columns giving spot centres **in image pixel coordinates**.
        Optional ``color`` and ``label`` columns.
    image:
        URL or path of the tissue image, as the browser will fetch it.
    img_width, img_height:
        Natural size of that image in pixels.
    spot_diameter:
        Spot diameter in image pixels.
    levels, colors:
        Fix the categorical order and colours. ``None`` derives them from the
        data and the theme palette.
    color_mode:
        ``"auto"``, ``"categorical"`` or ``"continuous"``.
    colormap:
        Sequential ramp for continuous colouring.
    spot_scale:
        Multiplier on ``spot_diameter``; 1 draws true size.
    spot_opacity, image_opacity:
        Opacities in ``[0, 1]``. Lower the spot opacity to read the histology
        underneath.
    show_image, show_legend:
        Toggle the underlay and the legend.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import pandas as pd
    >>> df = pd.DataFrame({
    ...     "x": [100, 150, 200], "y": [120, 160, 90],
    ...     "color": ["Cluster 1", "Cluster 2", "Cluster 1"],
    ... })
    >>> Spatial(df, image="tissue.png", img_width=600, img_height=600,
    ...         spot_diameter=8)  # doctest: +SKIP
    """

    _esm = STATIC / "spatial.js"

    def __init__(
        self,
        data: Any,
        *,
        image: str,
        img_width: float,
        img_height: float,
        spot_diameter: float = 4.0,
        levels: list[str] | None = None,
        colors: list[str] | None = None,
        color_mode: str = "auto",
        colormap: str = "viridis",
        spot_scale: float = 1.0,
        spot_opacity: float = 0.85,
        image_opacity: float = 1.0,
        show_image: bool = True,
        show_legend: bool = True,
        theme: dict | None = None,
        height: int = 560,
        **kwargs: Any,
    ) -> None:
        xc = _column(data, "x")
        yc = _column(data, "y")
        if xc is None or yc is None:
            raise ValueError("`data` must provide `x` and `y` columns.")
        if not image:
            raise ValueError("`image` must be a URL or path the browser can fetch.")
        if img_width <= 0 or img_height <= 0:
            raise ValueError("`img_width` and `img_height` must be positive.")
        if color_mode not in ("auto", "categorical", "continuous"):
            raise ValueError(
                "`color_mode` must be 'auto', 'categorical' or 'continuous'."
            )
        if levels is not None and colors is not None and len(levels) != len(colors):
            raise ValueError("`colors` must have one entry per level.")

        x = _to_float32(xc, "x")
        y = _to_float32(yc, "y")
        if x.size == 0:
            raise ValueError("`data` must contain at least one row.")
        if x.size != y.size:
            raise ValueError("`x` and `y` must be the same length.")

        packed: dict[str, np.ndarray] = {"x": x, "y": y}
        json_columns: dict[str, list] = {}

        col = _column(data, "color")
        if col is not None:
            arr = np.asarray(col)
            # Numeric colours ride the binary transport; categorical ones are
            # strings and travel as JSON.
            if np.issubdtype(arr.dtype, np.number):
                packed["color"] = _to_float32(col, "color")
            else:
                json_columns["color"] = [str(v) for v in col]
        lab = _column(data, "label")
        if lab is not None:
            json_columns["label"] = [str(v) for v in lab]

        buffer, schema = pack_columns(packed)

        meta: dict[str, Any] = {
            "image": str(image),
            "imgWidth": float(img_width),
            "imgHeight": float(img_height),
            "spotDiameter": float(spot_diameter),
        }
        if levels is not None:
            meta["levels"] = [str(v) for v in levels]
        if colors is not None:
            meta["colors"] = [str(c) for c in colors]

        options: dict[str, Any] = {
            "colorMode": color_mode,
            "colormap": colormap,
            "spotScale": spot_scale,
            "spotOpacity": spot_opacity,
            "imageOpacity": image_opacity,
            "showImage": show_image,
            "showLegend": show_legend,
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
