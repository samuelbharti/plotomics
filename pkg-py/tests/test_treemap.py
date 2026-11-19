import numpy as np
import pytest

from plotomics import Treemap


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

    # value packed as one float32 column of length 6 (consistent with all
    # other components' packed columns).
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"value"}
    assert w.schema["columns"][0]["dtype"] == "float32"
    assert len(w.buffer) == 6 * 4
    assert np.frombuffer(w.buffer, dtype=np.float32).tolist() == [0, 0, 0, 3, 5, 2]


def test_treemap_defaults():
    w = Treemap({"id": ["a", "b"], "parent": [None, "a"]})
    assert w.options["tile"] == "squarify"
    assert w.options["colorBy"] == "parent"
    assert w.options["colormap"] == "viridis"
    # No value column: the browser weighs every leaf as 1.
    assert w.schema["columns"] == []
    assert "labels" not in w.data["meta"]


def test_treemap_theme_in_options():
    w = Treemap({"id": ["a", "b"], "parent": [None, "a"]}, theme={"background": "#000"})
    assert w.options["theme"] == {"background": "#000"}


def test_treemap_rejects_duplicate_ids():
    with pytest.raises(ValueError, match="duplicate node id"):
        Treemap({"id": ["a", "a"], "parent": [None, "a"]})


def test_treemap_requires_exactly_one_root():
    # Two roots (two empty parents).
    with pytest.raises(ValueError, match="exactly one root"):
        Treemap({"id": ["a", "b"], "parent": [None, None]})
    # Zero roots (every node has a parent).
    with pytest.raises(ValueError, match="exactly one root"):
        Treemap({"id": ["a", "b"], "parent": ["b", "a"]})


def test_treemap_rejects_orphan_parent():
    with pytest.raises(ValueError, match="not found among ids"):
        Treemap({"id": ["root", "g1"], "parent": [None, "missing"]})


def test_treemap_rejects_empty_data():
    with pytest.raises(ValueError, match="at least one row"):
        Treemap({"id": [], "parent": []})


def test_treemap_rejects_cycle():
    # One valid root, but a and b point at each other: a cycle disjoint from the
    # root that passes the one-root / orphan checks yet crashes d3.stratify.
    with pytest.raises(ValueError, match="cycle"):
        Treemap({"id": ["root", "a", "b"], "parent": [None, "b", "a"]})


def test_treemap_rejects_self_parent():
    with pytest.raises(ValueError, match="cycle"):
        Treemap({"id": ["root", "a"], "parent": [None, "a"]})


def test_treemap_rejects_non_numeric_value():
    with pytest.raises(ValueError, match="must be numeric"):
        Treemap(
            {"id": ["root", "a"], "parent": [None, "root"], "value": ["x", "y"]}
        )


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


def test_treemap_matches_integer_ids_to_float_parents():
    pd = pytest.importorskip("pandas")
    # None in the parent column makes pandas store it as float64 (1.0, 2.0).
    df = pd.DataFrame({"id": [1, 2, 3, 4], "parent": [None, 1, 1, 2], "value": [0, 0, 5, 3]})
    w = Treemap(df)
    assert w.data["columns"]["parent"] == ["", "1", "1", "2"]
    assert w.data["columns"]["id"] == ["1", "2", "3", "4"]


def test_treemap_keeps_text_ids_written_as_floats():
    pd = pytest.importorskip("pandas")
    # Ids cast to text from floats keep their ".0"; parents must match them.
    df = pd.DataFrame({"id": ["1.0", "2.0", "3.0"], "parent": [np.nan, 1.0, 1.0]})
    w = Treemap(df)
    assert w.data["columns"]["parent"] == ["", "1.0", "1.0"]


def test_treemap_sends_a_missing_label_as_null():
    d = _sample()
    d["label"] = ["All", "Pathway 1", None, "Gene 1", float("nan"), "Gene 3"]
    w = Treemap(d)
    assert w.data["meta"]["labels"] == [
        "All", "Pathway 1", None, "Gene 1", None, "Gene 3",
    ]


@pytest.mark.parametrize("colormap", ["viridis", "rdbu", "ltc", "ltcdiv"])
def test_treemap_accepts_every_colormap_the_browser_draws(colormap):
    w = Treemap(_sample(), color_by="value", colormap=colormap)
    assert w.options["colormap"] == colormap


def test_treemap_rejects_an_unknown_colormap():
    with pytest.raises(ValueError, match="colormap"):
        Treemap(_sample(), colormap="plasma")
