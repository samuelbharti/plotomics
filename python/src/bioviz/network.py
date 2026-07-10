"""Network graph widget."""

from __future__ import annotations

from collections import Counter
from typing import Any

from ._base import STATIC, BiovizWidget, _column, _to_float32, pack_columns


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
    theme:
        Optional theme overrides forwarded to the JS renderer.
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
        theme: dict | None = None,
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
        if layout not in ("forceatlas2", "precomputed"):
            raise ValueError("`layout` must be 'forceatlas2' or 'precomputed'.")

        # String columns go through the JSON side-channel.
        id_list = [str(v) for v in node_id]
        source_list = [str(v) for v in source]
        target_list = [str(v) for v in target]
        n_nodes = len(id_list)
        n_edges = len(source_list)

        # Structural integrity.
        if n_nodes == 0:
            raise ValueError("`nodes` must contain at least one row.")
        if len(target_list) != n_edges:
            raise ValueError(
                "`source` and `target` must have the same length; "
                f"got source={n_edges}, target={len(target_list)}"
            )
        dupes = sorted({i for i, c in Counter(id_list).items() if c > 1})
        if dupes:
            raise ValueError("duplicate node id(s): " + ", ".join(dupes))
        id_set = set(id_list)
        dangling = sorted({e for e in (*source_list, *target_list) if e not in id_set})
        if dangling:
            raise ValueError(
                "edge source/target not found among node ids: " + ", ".join(dangling)
            )

        json_columns: dict[str, list] = {
            "id": id_list,
            "source": source_list,
            "target": target_list,
        }

        # Numeric columns go through the packed binary buffer. Node columns
        # (x/y/size) and the per-edge weight legitimately differ in length, so
        # equal-length checking is done per group here, not across the buffer.
        numeric: dict[str, Any] = {}
        x = _column(nodes, "x")
        y = _column(nodes, "y")
        if layout == "precomputed" and (x is None or y is None):
            raise ValueError(
                "layout='precomputed' requires `x` and `y` columns in `nodes`."
            )
        if x is not None and y is not None:
            numeric["x"] = _validate_len(_to_float32(x, "x"), n_nodes, "x")
            numeric["y"] = _validate_len(_to_float32(y, "y"), n_nodes, "y")
        size = _column(nodes, "size")
        if size is not None:
            numeric["size"] = _validate_len(_to_float32(size, "size"), n_nodes, "size")
        weight = _column(edges, "weight")
        if weight is not None:
            numeric["weight"] = _validate_len(
                _to_float32(weight, "weight"), n_edges, "weight"
            )

        if numeric:
            buffer, schema = pack_columns(numeric, equal_length=False)
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


def _validate_len(arr: Any, expected: int, name: str) -> Any:
    """Raise if a packed column's length does not match its group size."""
    if int(arr.size) != expected:
        raise ValueError(f"`{name}` has {int(arr.size)} entries; expected {expected}.")
    return arr
