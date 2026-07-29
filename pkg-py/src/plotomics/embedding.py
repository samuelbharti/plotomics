"""Embedding scatter widget (UMAP / t-SNE / PCA)."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np

from ._base import STATIC, PlotomicsWidget, _column, _to_float32, pack_columns


class Embedding(PlotomicsWidget):
    """GPU-accelerated 2-D embedding scatter viewer (UMAP / t-SNE / PCA).

    Points render on the GPU via regl-scatterplot so hundreds of thousands to
    millions of cells stay interactive at 60fps. Lasso selection is enabled
    (drag from empty space to select points).

    Parameters
    ----------
    data:
        A pandas ``DataFrame`` or a mapping of arrays. Must provide numeric
        ``x`` and ``y`` embedding coordinates. An optional ``color`` column
        drives coloring: a string/categorical column becomes a discrete legend,
        a numeric column a continuous colormap. A pandas ``Categorical`` color
        column fixes the legend order and the color assignment to its
        categories, and keeps unused ones in the legend. An optional ``label``
        column supplies per-point tooltip text.
    point_scale_mode:
        How ``point_size`` responds to zoom. ``"asinh"`` and ``"linear"``
        shrink points as you zoom out, which keeps a dense embedding readable,
        but both floor at one pixel once the camera scale drops below
        ``1 / point_size``. ``"constant"`` sizes points in literal pixels.
    point_size, opacity:
        Point radius (px) and opacity in ``[0, 1]``.
    color_mode:
        ``"auto"`` detects categorical vs continuous from the ``color`` column
        type; force with ``"categorical"`` / ``"continuous"``.
    colormap:
        Sequential color ramp for continuous coloring (``"viridis"`` or
        ``"rdbu"``).
    x_label, y_label:
        Axis titles (shown when ``show_axes=True``).
    aspect:
        How the fitted view maps data units onto pixels. ``"fill"`` stretches
        each axis to fill the canvas, which suits a UMAP, whose axes carry no
        units. ``"equal"`` gives both axes the same units per pixel; use it
        when the axes share units and their relative spread is part of the
        claim, as in PCA scores.
    padding:
        Fraction of the data range to pad around the fitted view. Larger values
        zoom out, leaving more empty space at the edges, which stops the
        outermost points being clipped by the canvas border.
    show_axes:
        Draw the axis frame + ticks (embeddings usually hide axes).
    show_legend:
        Draw the legend (discrete swatches or a colorbar).
    mouse_mode:
        Primary drag gesture: ``"panZoom"`` (default) pans/zooms, ``"lasso"``
        makes a plain drag draw a selection.
    theme:
        Optional theme overrides forwarded to the JS renderer.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np, pandas as pd
    >>> n = 200_000
    >>> k = np.random.randint(0, 8, n)
    >>> df = pd.DataFrame({
    ...     "x": np.random.randn(n) + k * 4,
    ...     "y": np.random.randn(n) + (k % 2) * 4,
    ...     "color": [f"cluster {i + 1}" for i in k],
    ... })
    >>> Embedding(df)  # doctest: +SKIP
    """

    _esm = STATIC / "embedding.js"

    def __init__(
        self,
        data: Any,
        *,
        point_size: float = 3.0,
        point_scale_mode: str = "asinh",
        opacity: float = 0.8,
        color_mode: str = "auto",
        colormap: str = "viridis",
        x_label: str = "UMAP 1",
        y_label: str = "UMAP 2",
        aspect: str = "fill",
        padding: float = 0.04,
        show_axes: bool = False,
        show_legend: bool = True,
        mouse_mode: Literal["panZoom", "lasso"] = "panZoom",
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        x = _column(data, "x")
        y = _column(data, "y")
        if x is None or y is None:
            raise ValueError("`data` must provide `x` and `y` columns.")
        if mouse_mode not in ("panZoom", "lasso"):
            raise ValueError("`mouse_mode` must be 'panZoom' or 'lasso'.")

        x_arr = _to_float32(x, "x")
        y_arr = _to_float32(y, "y")
        if x_arr.size == 0:
            raise ValueError("`data` must contain at least one row.")

        numeric: dict[str, Any] = {"x": x_arr, "y": y_arr}
        json_columns: dict[str, list] = {}

        color = _column(data, "color")
        categories: list[str] | None = None
        if color is not None:
            # A pandas Categorical is the user stating the order they want, so
            # read it before np.asarray() flattens it to plain values.
            cat_dtype = getattr(getattr(color, "dtype", None), "categories", None)
            if cat_dtype is not None:
                categories = [str(v) for v in cat_dtype]
            arr = np.asarray(color)
            if categories is None and np.issubdtype(arr.dtype, np.number):
                # Continuous: transport as a packed numeric column.
                numeric["color"] = arr.astype(np.float32)
            else:
                # Categorical: transport as a JSON string column.
                json_columns["color"] = [str(v) for v in color]

        label = _column(data, "label")
        if label is not None:
            json_columns["label"] = [str(v) for v in label]

        buffer, schema = pack_columns(numeric)

        options: dict[str, Any] = {
            "pointSize": point_size,
            "pointScaleMode": point_scale_mode,
            "opacity": opacity,
            "colorMode": color_mode,
            "colormap": colormap,
            "xLabel": x_label,
            "yLabel": y_label,
            "aspect": aspect,
            "padding": padding,
            "showAxes": show_axes,
            "showLegend": show_legend,
            "mouseMode": mouse_mode,
        }
        if categories is not None:
            options["categories"] = categories
        if theme is not None:
            options["theme"] = theme

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": {}},
            options=options,
            _height=height,
            **kwargs,
        )
