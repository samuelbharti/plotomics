import numpy as np
import pytest

from bioviz import Clustermap


def test_clustermap_builds_traits_from_ndarray():
    mat = np.arange(6, dtype=float).reshape(2, 3)  # [[0,1,2],[3,4,5]]
    w = Clustermap(
        mat,
        metric="correlation",
        linkage="ward",
        colormap="rdbu",
        z_score=True,
        legend_title="expr",
    )

    assert w.data["meta"]["nrows"] == 2
    assert w.data["meta"]["ncols"] == 3
    assert w.options["metric"] == "correlation"
    assert w.options["linkage"] == "ward"
    assert w.options["colormap"] == "rdbu"
    assert w.options["zScore"] is True
    assert w.options["legendTitle"] == "expr"

    # values packed as one float32 column of length nrows*ncols, row-major.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"values"}
    assert len(w.buffer) == 6 * 4
    decoded = np.frombuffer(w.buffer, dtype=np.float32, count=6)
    assert decoded.tolist() == [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]


def test_clustermap_defaults_match_option_names():
    w = Clustermap(np.random.randn(4, 5))
    assert w.options["metric"] == "euclidean"
    assert w.options["linkage"] == "average"
    assert w.options["colormap"] == "viridis"
    assert w.options["zScore"] is False
    assert w.options["clusterRows"] is True
    assert w.options["clusterCols"] is True
    assert w.options["showRowDendrogram"] is True
    assert w.options["showColDendrogram"] is True


def test_clustermap_labels_from_dataframe_like():
    # A minimal DataFrame-like object (avoids a hard pandas dependency in tests).
    class FakeDF:
        def __init__(self, values, index, columns):
            self.values = values
            self.index = index
            self.columns = columns

    df = FakeDF(
        np.arange(6, dtype=float).reshape(2, 3),
        index=["r1", "r2"],
        columns=["c1", "c2", "c3"],
    )
    w = Clustermap(df)
    assert w.data["meta"]["rowLabels"] == ["r1", "r2"]
    assert w.data["meta"]["colLabels"] == ["c1", "c2", "c3"]


def test_clustermap_explicit_labels_override():
    w = Clustermap(
        np.random.randn(2, 2),
        row_labels=["a", "b"],
        col_labels=["x", "y"],
    )
    assert w.data["meta"]["rowLabels"] == ["a", "b"]
    assert w.data["meta"]["colLabels"] == ["x", "y"]


def test_clustermap_carries_precomputed_linkage():
    w = Clustermap(np.random.randn(3, 3), row_linkage=[2, 0, 1])
    assert w.data["meta"]["rowLinkage"] == [2, 0, 1]
    assert "colLinkage" not in w.data["meta"]


def test_clustermap_rejects_non_2d():
    with pytest.raises(ValueError, match="2-dimensional"):
        Clustermap(np.arange(5.0))


def test_clustermap_theme_in_options():
    w = Clustermap(np.random.randn(3, 3), theme={"background": "#000"})
    assert w.options["theme"] == {"background": "#000"}


def test_clustermap_rejects_invalid_metric():
    with pytest.raises(ValueError, match="metric"):
        Clustermap(np.random.randn(3, 3), metric="cosine")


def test_clustermap_rejects_invalid_linkage():
    with pytest.raises(ValueError, match="linkage"):
        Clustermap(np.random.randn(3, 3), linkage="single")


def test_clustermap_rejects_invalid_colormap():
    with pytest.raises(ValueError, match="colormap"):
        Clustermap(np.random.randn(3, 3), colormap="plasma")


def test_clustermap_rejects_bad_precomputed_linkage_length():
    with pytest.raises(ValueError, match="row_linkage"):
        Clustermap(np.random.randn(3, 3), row_linkage=[0, 1])


def test_clustermap_rejects_non_permutation_linkage():
    with pytest.raises(ValueError, match="permutation"):
        Clustermap(np.random.randn(3, 3), col_linkage=[0, 0, 1])


def test_clustermap_accepts_dict_linkage_with_order():
    w = Clustermap(
        np.random.randn(3, 3),
        row_linkage={"order": [2, 1, 0], "merges": []},
    )
    assert w.data["meta"]["rowLinkage"]["order"] == [2, 1, 0]


def test_clustermap_rejects_empty_matrix():
    with pytest.raises(ValueError, match="at least one row"):
        Clustermap(np.zeros((0, 0)))
