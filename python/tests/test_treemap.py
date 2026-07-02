import numpy as np
import pytest

from bioviz import Treemap


def _sample():
    return {
        "id": ["root", "P1", "P2", "g1", "g2", "g3"],
        "parent": [None, "root", "root", "P1", "P1", "P2"],
        "value": [0, 0, 0, 3, 5, 2],
        "label": ["All", "Pathway 1", "Pathway 2", "Gene 1", "Gene 2", "Gene 3"],
    }


def test_treemap_builds_traits_from_dict():
    w = Treemap(
        _sample(),
        tile="binary",
        padding_inner=2,
        color_by="value",
        colormap="rdbu",
        label_min_size=40,
    )

    assert w.data["columns"]["id"] == _sample()["id"]
    # None parent (root) becomes an empty string.
    assert w.data["columns"]["parent"][0] == ""
    assert w.data["columns"]["parent"][3] == "P1"
    assert w.data["meta"]["labels"][1] == "Pathway 1"

    assert w.options["tile"] == "binary"
    assert w.options["paddingInner"] == 2
    assert w.options["colorBy"] == "value"
    assert w.options["colormap"] == "rdbu"
    assert w.options["labelMinSize"] == 40

    # value packed as one float64 column of length 6.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"value"}
    assert len(w.buffer) == 6 * 8
    assert np.frombuffer(w.buffer, dtype=np.float64).tolist() == [0, 0, 0, 3, 5, 2]


def test_treemap_defaults():
    w = Treemap({"id": ["a", "b"], "parent": [None, "a"]})
    assert w.options["tile"] == "squarify"
    assert w.options["colorBy"] == "parent"
    assert w.options["colormap"] == "viridis"
    # value defaults to zeros when absent.
    assert np.frombuffer(w.buffer, dtype=np.float64).tolist() == [0.0, 0.0]
    assert "labels" not in w.data["meta"]


def test_treemap_requires_id_and_parent():
    with pytest.raises(ValueError, match="id` and `parent`"):
        Treemap({"id": ["a", "b"]})


def test_treemap_accepts_pandas_dataframe():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame(_sample())
    w = Treemap(df)
    assert w.data["columns"]["id"] == _sample()["id"]
    # pandas turns None into NaN; both normalize to the empty-string root marker.
    assert w.data["columns"]["parent"][0] == ""
    assert w.data["meta"]["labels"] == _sample()["label"]
