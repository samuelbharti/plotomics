"""Network graph widget."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._base import STATIC, BiovizWidget, _column, pack_columns


class Network(BiovizWidget):
    """GPU-accelerated node-link diagram for large interaction networks.

    Nodes and edges render with WebGL (sigma v3 over a graphology graph) so tens
    of thousands of elements stay interactive. If node coordinates are absent, a
    bounded ForceAtlas2 layout positions them in the browser; otherwise the
    supplied ``x``/``y`` are used. Categorical node groups are colored from a
    colorblind-safe palette. Hovering a node highlights it and its neighbors.

    Parameters
    ----------
    nodes:
        A pandas ``DataFrame`` or mapping of arrays describing nodes. Must
        provide an ``id`` column. Optional columns: ``x``, ``y`` (precomputed
        coordinates), ``size`` (node radius in px), ``group`` (categorical,
        mapped to a palette color) and ``label`` (display name; defaults to id).
    edges:
        A ``DataFrame`` or mapping with ``source`` and ``target`` columns of node
        ids and an optional numeric ``weight`` column.
    layout:
        ``"forceatlas2"`` (run a layout when coordinates are missing) or
        ``"precomputed"`` (require and use ``x``/``y`` from ``nodes``).
    iterations:
        Number of ForceAtlas2 iterations (bounded internally).
    default_node_color:
        Fallback node color for nodes without a group.
    default_edge_color:
        Edge color.
    label_threshold:
        Minimum node size (px) for its label to render.
    default_node_size:
        Node radius (px) used when ``size`` is absent.
    palette:
        Optional list of hex colors overriding the default categorical palette.
    height:
        Initial widget height in CSS pixels.

    Examples
    --------
    >>> import numpy as np, pandas as pd
    >>> nodes = pd.DataFrame({"id": [f"N{i}" for i in range(500)],
    ...                       "group": np.random.choice(list("ABCD"), 500)})
    >>> src = np.random.randint(0, 500, 1500)
    >>> tgt = np.random.randint(0, 500, 1500)
    >>> edges = pd.DataFrame({"source": [f"N{i}" for i in src],
    ...                       "target": [f"N{i}" for i in tgt]})
    >>> Network(nodes, edges)  # doctest: +SKIP
    """

    _esm = STATIC / "network.js"

    def __init__(
        self,
        nodes: Any,
        edges: Any,
        *,
        layout: str = "forceatlas2",
        iterations: int = 200,
        default_node_color: str = "#7c8598",
        default_edge_color: str = "#d6dae1",
        label_threshold: float = 8.0,
        default_node_size: float = 4.0,
        palette: list[str] | None = None,
        height: int = 480,
        **kwargs: Any,
    ) -> None:
        node_id = _column(nodes, "id")
        if node_id is None:
            raise ValueError("`nodes` must provide an `id` column.")
        source = _column(edges, "source")
        target = _column(edges, "target")
        if source is None or target is None:
            raise ValueError("`edges` must provide `source` and `target` columns.")

        # String columns go through the JSON side-channel.
        json_columns: dict[str, list] = {
            "id": [str(v) for v in node_id],
            "source": [str(v) for v in source],
            "target": [str(v) for v in target],
        }

        # Numeric columns go through the packed binary buffer.
        numeric: dict[str, np.ndarray] = {}
        x = _column(nodes, "x")
        y = _column(nodes, "y")
        if x is not None and y is not None:
            numeric["x"] = np.asarray(x, dtype=np.float32)
            numeric["y"] = np.asarray(y, dtype=np.float32)
        size = _column(nodes, "size")
        if size is not None:
            numeric["size"] = np.asarray(size, dtype=np.float32)
        weight = _column(edges, "weight")
        if weight is not None:
            numeric["weight"] = np.asarray(weight, dtype=np.float32)

        if numeric:
            buffer, schema = pack_columns(numeric)
        else:
            buffer, schema = b"", {"columns": []}

        meta: dict[str, Any] = {}
        label = _column(nodes, "label")
        if label is not None:
            meta["nodeLabels"] = [str(v) for v in label]
        group = _column(nodes, "group")
        if group is not None:
            meta["nodeGroup"] = [str(v) for v in group]

        options: dict[str, Any] = {
            "layout": layout,
            "iterations": iterations,
            "defaultNodeColor": default_node_color,
            "defaultEdgeColor": default_edge_color,
            "labelThreshold": label_threshold,
            "defaultNodeSize": default_node_size,
        }
        if palette is not None:
            options["palette"] = list(palette)

        super().__init__(
            buffer=buffer,
            schema=schema,
            data={"columns": json_columns, "meta": meta},
            options=options,
            _height=height,
            **kwargs,
        )
