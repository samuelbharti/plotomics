import pytest

from bioviz import Embedding


def test_embedding_builds_traits_from_dict():
    data = {
        "x": [-2.0, 0.0, 2.0],
        "y": [3.0, 0.1, 4.0],
        "color": ["A", "B", "A"],
        "label": ["c1", "c2", "c3"],
    }
    w = Embedding(data, point_size=5, color_mode="categorical", show_axes=True)

    assert w.options["pointSize"] == 5
    assert w.options["colorMode"] == "categorical"
    assert w.options["showAxes"] is True
    assert w.options["showLegend"] is True
    # Categorical color + label travel as JSON string columns.
    assert w.data["columns"]["color"] == ["A", "B", "A"]
    assert w.data["columns"]["label"] == ["c1", "c2", "c3"]
    # x + y packed as two float32 columns of length 3.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"x", "y"}
    assert len(w.buffer) == 3 * 4 * 2


def test_embedding_packs_numeric_color_as_continuous():
    data = {"x": [1.0, 2.0, 3.0], "y": [1.0, 2.0, 3.0], "color": [0.1, 0.5, 0.9]}
    w = Embedding(data)

    # A numeric color column is packed into the binary buffer, not JSON columns.
    assert "color" not in w.data["columns"]
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"x", "y", "color"}
    assert w.options["colorMode"] == "auto"


def test_embedding_requires_x_and_y():
    with pytest.raises(ValueError, match="x` and `y`"):
        Embedding({"x": [1, 2, 3]})


def test_embedding_omits_optional_columns_when_absent():
    w = Embedding({"x": [1, 2], "y": [1, 2]})
    assert "color" not in w.data["columns"]
    assert "label" not in w.data["columns"]
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"x", "y"}


def test_embedding_mouse_mode_defaults_and_override():
    assert Embedding({"x": [1, 2], "y": [1, 2]}).options["mouseMode"] == "panZoom"
    w = Embedding({"x": [1, 2], "y": [1, 2]}, mouse_mode="lasso")
    assert w.options["mouseMode"] == "lasso"


def test_embedding_rejects_invalid_mouse_mode():
    with pytest.raises(ValueError, match="mouse_mode"):
        Embedding({"x": [1, 2], "y": [1, 2]}, mouse_mode="spin")


def test_embedding_theme_in_options():
    w = Embedding({"x": [1, 2], "y": [1, 2]}, theme={"background": "#111"})
    assert w.options["theme"] == {"background": "#111"}


def test_embedding_rejects_empty_data():
    with pytest.raises(ValueError, match="at least one row"):
        Embedding({"x": [], "y": []})


def test_embedding_selection_trait_and_export():
    w = Embedding({"x": [1, 2], "y": [1, 2]}, mouse_mode="lasso")
    # JS -> Python selection channel (front-end writes it on lasso select).
    assert "selected" in w.traits()
    assert w.selected == []
    # Front-end-triggered figure download.
    assert callable(w.export)
