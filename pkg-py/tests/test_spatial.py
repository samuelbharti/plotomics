import numpy as np
import pytest

from plotomics import Spatial

IMG = {"image": "tissue.png", "img_width": 600, "img_height": 600}


def make_data():
    return {"x": [100, 150, 200], "y": [120, 160, 90]}


def test_spatial_packs_coordinates_and_image_meta():
    w = Spatial(make_data(), spot_diameter=8, **IMG)
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["x"]["dtype"] == "float32"
    assert specs["y"]["dtype"] == "float32"

    meta = w.data["meta"]
    assert meta["image"] == "tissue.png"
    assert meta["imgWidth"] == 600.0
    assert meta["imgHeight"] == 600.0
    assert meta["spotDiameter"] == 8.0


def test_spatial_categorical_color_travels_as_json():
    d = {**make_data(), "color": ["Cluster 1", "Cluster 2", "Cluster 1"]}
    w = Spatial(d, **IMG)
    # Strings cannot ride the binary transport, so they stay JSON columns.
    assert w.data["columns"]["color"] == ["Cluster 1", "Cluster 2", "Cluster 1"]
    assert {c["name"] for c in w.schema["columns"]} == {"x", "y"}


def test_spatial_numeric_color_rides_the_binary_transport():
    d = {**make_data(), "color": [0.5, 1.5, 2.5]}
    w = Spatial(d, **IMG)
    # A gene's expression is numeric and belongs in the buffer, which is what
    # lets one view toggle between cluster and expression colouring.
    assert "color" not in w.data["columns"]
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["color"]["dtype"] == "float32"
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed[6:9].tolist() == [0.5, 1.5, 2.5]


def test_spatial_levels_and_colors():
    d = {**make_data(), "color": ["A", "B", "A"]}
    w = Spatial(d, levels=["B", "A"], colors=["#f00", "#00f"], **IMG)
    assert w.data["meta"]["levels"] == ["B", "A"]
    assert w.data["meta"]["colors"] == ["#f00", "#00f"]


def test_spatial_label_column():
    d = {**make_data(), "label": ["s1", "s2", "s3"]}
    w = Spatial(d, **IMG)
    assert w.data["columns"]["label"] == ["s1", "s2", "s3"]


def test_spatial_options_passthrough():
    w = Spatial(make_data(), color_mode="continuous", colormap="magma",
                spot_scale=1.5, spot_opacity=0.5, image_opacity=0.3,
                show_image=False, show_legend=False,
                theme={"background": "#000"}, **IMG)
    assert w.options["colorMode"] == "continuous"
    assert w.options["colormap"] == "magma"
    assert w.options["spotScale"] == 1.5
    assert w.options["spotOpacity"] == 0.5
    assert w.options["imageOpacity"] == 0.3
    assert w.options["showImage"] is False
    assert w.options["showLegend"] is False
    assert w.options["theme"] == {"background": "#000"}


def test_spatial_defaults():
    w = Spatial(make_data(), **IMG)
    assert w.options["colorMode"] == "auto"
    assert w.options["colormap"] == "viridis"
    assert w.options["spotScale"] == 1.0
    assert w.options["showImage"] is True
    assert "levels" not in w.data["meta"]


def test_spatial_validates_its_input():
    d = make_data()

    with pytest.raises(ValueError, match="`x` and `y` columns"):
        Spatial({"x": [1, 2]}, **IMG)
    with pytest.raises(ValueError, match="at least one row"):
        Spatial({"x": [], "y": []}, **IMG)
    with pytest.raises(ValueError, match="URL or path"):
        Spatial(d, image="", img_width=600, img_height=600)
    with pytest.raises(ValueError, match="must be positive"):
        Spatial(d, image="t.png", img_width=0, img_height=600)
    with pytest.raises(ValueError, match="'auto', 'categorical' or 'continuous'"):
        Spatial(d, color_mode="rainbow", **IMG)
    with pytest.raises(ValueError, match="one entry per level"):
        Spatial(d, levels=["A", "B"], colors=["#f00"], **IMG)
    with pytest.raises(ValueError, match="same length"):
        Spatial({"x": [1, 2, 3], "y": [1, 2]}, **IMG)
