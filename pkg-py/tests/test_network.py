import numpy as np
import pytest

from plotomics import Network


def test_network_builds_traits_from_dicts():
    nodes = {
        "id": ["a", "b", "c"],
        "x": [0.0, 1.0, 2.0],
        "y": [0.0, 1.0, 0.0],
        "size": [4.0, 8.0, 6.0],
        "group": ["G1", "G1", "G2"],
        "label": ["Alpha", "Beta", "Gamma"],
    }
    edges = {"source": ["a", "b"], "target": ["b", "c"], "weight": [1.5, 2.0]}
    w = Network(
        nodes, edges, layout="precomputed", iterations=100, label_threshold=5
    )

    assert w.data["columns"]["id"] == ["a", "b", "c"]
    assert w.data["columns"]["source"] == ["a", "b"]
    assert w.data["columns"]["target"] == ["b", "c"]
    assert w.data["meta"]["nodeGroup"] == ["G1", "G1", "G2"]
    assert w.data["meta"]["nodeLabels"] == ["Alpha", "Beta", "Gamma"]
    assert w.options["layout"] == "precomputed"
    assert w.options["iterations"] == 100
    assert w.options["labelThreshold"] == 5

    # x, y, size (nodes) + weight (edges) packed as float32 columns.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"x", "y", "size", "weight"}
    # 3 node coords/sizes (3 cols x 3) + 2 weights, all float32 (4 bytes).
    assert len(w.buffer) == (3 * 3 + 2) * 4


def test_network_omits_optional_columns():
    nodes = {"id": ["a", "b"]}
    edges = {"source": ["a"], "target": ["b"]}
    w = Network(nodes, edges)

    assert "nodeGroup" not in w.data["meta"]
    assert "nodeLabels" not in w.data["meta"]
    assert w.schema["columns"] == []
    assert w.buffer == b""
    assert w.options["layout"] == "forceatlas2"


def test_network_forwards_palette():
    w = Network(
        {"id": ["a", "b"]},
        {"source": ["a"], "target": ["b"]},
        palette=["#111111", "#222222"],
    )
    assert w.options["palette"] == ["#111111", "#222222"]


def test_network_requires_id():
    with pytest.raises(ValueError, match="`id`"):
        Network({"x": [1, 2]}, {"source": ["a"], "target": ["b"]})


def test_network_requires_source_and_target():
    with pytest.raises(ValueError, match="source` and `target`"):
        Network({"id": ["a", "b"]}, {"source": ["a"]})


def test_network_accepts_numpy_id_arrays():
    nodes = {"id": np.array(["a", "b"]), "size": np.array([3.0, 5.0])}
    edges = {"source": np.array(["a"]), "target": np.array(["b"])}
    w = Network(nodes, edges)
    assert w.data["columns"]["id"] == ["a", "b"]
    assert {c["name"] for c in w.schema["columns"]} == {"size"}


def test_network_rejects_duplicate_node_id():
    with pytest.raises(ValueError, match="duplicate node id"):
        Network({"id": ["a", "a"]}, {"source": ["a"], "target": ["a"]})


def test_network_rejects_dangling_edge():
    with pytest.raises(ValueError, match="not found among node ids"):
        Network({"id": ["a", "b"]}, {"source": ["a"], "target": ["z"]})


def test_network_precomputed_requires_xy():
    with pytest.raises(ValueError, match="precomputed"):
        Network(
            {"id": ["a", "b"]},
            {"source": ["a"], "target": ["b"]},
            layout="precomputed",
        )


def test_network_rejects_empty_nodes():
    with pytest.raises(ValueError, match="at least one row"):
        Network({"id": []}, {"source": [], "target": []})


def test_network_theme_in_options():
    w = Network(
        {"id": ["a", "b"]},
        {"source": ["a"], "target": ["b"]},
        theme={"background": "#222"},
    )
    assert w.options["theme"] == {"background": "#222"}


def test_network_forwards_directed():
    w = Network({"id": ["a", "b"]}, {"source": ["a"], "target": ["b"]})
    assert w.options["directed"] is False
    w2 = Network(
        {"id": ["a", "b"]}, {"source": ["a"], "target": ["b"]}, directed=True
    )
    assert w2.options["directed"] is True


def test_network_per_edge_color_column():
    w = Network(
        {"id": ["a", "b", "c"]},
        {"source": ["a", "b"], "target": ["b", "c"], "color": ["#f00", "#0f0"]},
    )
    assert w.data["columns"]["color"] == ["#f00", "#0f0"]

    w2 = Network({"id": ["a", "b"]}, {"source": ["a"], "target": ["b"]})
    assert "color" not in w2.data["columns"]


def test_network_rejects_mismatched_color_length():
    with pytest.raises(ValueError, match="`color` must match"):
        Network(
            {"id": ["a", "b", "c"]},
            {"source": ["a", "b"], "target": ["b", "c"], "color": ["#f00"]},
        )


def test_network_selected_trait_accepts_node_id_and_none():
    # The `selected` trait now holds a clicked node id (str) or None, not only a
    # list of point indices, so a network node click can populate it.
    w = Network({"id": ["a", "b"]}, {"source": ["a"], "target": ["b"]})
    w.selected = "a"
    assert w.selected == "a"
    w.selected = None
    assert w.selected is None
