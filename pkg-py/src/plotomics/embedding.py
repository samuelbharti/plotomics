"""Embedding scatter widget (UMAP / t-SNE / PCA)."""

from __future__ import annotations

from typing import Any, Literal

from ._base import (
    STATIC,
    PlotomicsWidget,
    _category_levels,
    _check_choice,
    _column,
    _numeric_values,
    _require_flag,
    _text_or_none,
    _to_float32,
    pack_columns,
)


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
        a numeric column a continuous colormap. Text categories are sorted in
        natural order ("cluster 2" before "cluster 10"); a pandas
        ``Categorical`` color column fixes the legend order and the color
        assignment to its categories, and keeps unused ones in the legend. A
        missing color is drawn grey and keyed "NA", and a row with a missing
        ``x`` or ``y`` is not drawn. An optional ``label``
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
        Color ramp for continuous coloring: ``"viridis"``, ``"rdbu"``,
        ``"ltc"`` (an earthy teal to sand to rust sequential ramp) or
        ``"ltcdiv"`` (its diverging counterpart, neutral cream at the midpoint).
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
    bounded_view:
        Keep pan and zoom inside the data: zooming out stops at the view
        that shows all of it, a pan stops at its edges, and zooming in stops
        at 1/10,000 of its range. ``False`` lets the view move freely.
        Either way a double-click, or the reset button in the top right
        corner of the plot, goes back to the view of all the data. A
        double-click also clears the lasso selection.
    theme:
        Optional theme overrides forwarded to the JS renderer. Its
        ``padding`` entry is the space in px between the edge of the widget
        and the plot: one number for every side, or a dict with any of the
        keys ``top``, ``right``, ``bottom`` and ``left``, a side left out
        keeping the default of 10.
        Its ``categorical`` entry is an ordered palette, a list of colours
        that go to the categories in order; colours are not matched by name.
        A colour given as a CSS custom property, such as
        ``"background": "var(--bg)"``, takes the value the page gives it when
        the plot draws. After the page changes the property, what the plot
        drew on a canvas keeps the old colour until it draws again: resize
        the widget or display it again.
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
        colormap: Literal["viridis", "rdbu", "ltc", "ltcdiv"] = "viridis",
        x_label: str = "UMAP 1",
        y_label: str = "UMAP 2",
        aspect: str = "fill",
        padding: float = 0.04,
        show_axes: bool = False,
        show_legend: bool = True,
        mouse_mode: Literal["panZoom", "lasso"] = "panZoom",
        bounded_view: bool = True,
        theme: dict | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        x = _column(data, "x")
        y = _column(data, "y")
        if x is None or y is None:
            raise ValueError("`data` must provide `x` and `y` columns.")
        _check_choice(mouse_mode, "mouse_mode", ("panZoom", "lasso"))
        _check_choice(
            point_scale_mode, "point_scale_mode", ("asinh", "linear", "constant")
        )
        _check_choice(color_mode, "color_mode", ("auto", "categorical", "continuous"))
        _check_choice(colormap, "colormap", ("viridis", "rdbu", "ltc", "ltcdiv"))
        _check_choice(aspect, "aspect", ("fill", "equal"))
        bounded_view = _require_flag(bounded_view, "bounded_view")

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
            categories = _category_levels(color)
            values = _numeric_values(color) if categories is None else None
            if values is not None:
                # Continuous: transport as a packed numeric column, NaN for
                # a missing value.
                numeric["color"] = values
            else:
                # Categorical: transport as a JSON string column. A missing
                # value crosses as null, which the browser keys as "NA".
                json_columns["color"] = _text_or_none(color)

        label = _column(data, "label")
        if label is not None:
            json_columns["label"] = _text_or_none(label)

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
            "boundedView": bounded_view,
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
