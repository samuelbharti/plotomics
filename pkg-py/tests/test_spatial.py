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
    w = Spatial(make_data(), color_mode="continuous", colormap="ltc",
                spot_scale=1.5, spot_opacity=0.5, image_opacity=0.3,
                show_image=False, show_legend=False,
                theme={"background": "#000"}, **IMG)
    assert w.options["colorMode"] == "continuous"
    assert w.options["colormap"] == "ltc"
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


def test_spatial_sends_missing_colours_as_null_and_reads_categorical_levels():
    pd = pytest.importorskip("pandas")
    d = {"x": [1, 2, 3], "y": [1, 2, 3],
         "color": pd.Categorical(["b", None, "a"], categories=["b", "a"])}
    w = Spatial(d, image="img.png", img_width=10, img_height=10)
    assert w.data["columns"]["color"] == ["b", None, "a"]
    assert w.data["meta"]["levels"] == ["b", "a"]


def test_spatial_keeps_a_numeric_colour_with_a_missing_value_numeric():
    d = {"x": [1, 2, 3], "y": [1, 2, 3], "color": [None, 2.0, 3.0]}
    w = Spatial(d, image="img.png", img_width=10, img_height=10)
    assert "color" not in w.data["columns"]


def test_spatial_rejects_too_few_colours_for_the_levels():
    d = {"x": [1, 2, 3], "y": [1, 2, 3], "color": ["a", "b", "c"]}
    with pytest.raises(ValueError, match="one entry per level"):
        Spatial(d, image="img.png", img_width=10, img_height=10,
                colors=["#ff0000"])


def test_spatial_checks_colours_against_categorical_levels():
    pd = pytest.importorskip("pandas")
    d = {"x": [1, 2, 3], "y": [1, 2, 3],
         "color": pd.Categorical(["a", "b", "a"])}
    w = Spatial(d, image="img.png", img_width=10, img_height=10,
                colors=["#ff0000", "#00ff00", "#0000ff"])
    assert w.data["meta"]["levels"] == ["a", "b"]
    with pytest.raises(ValueError, match="one entry per level"):
        Spatial(d, image="img.png", img_width=10, img_height=10,
                colors=["#ff0000"])


def test_spatial_sends_numbers_read_as_categories_at_full_precision():
    d = {"x": [1, 2], "y": [1, 2], "color": [0.1, 0.2]}
    w = Spatial(d, image="img.png", img_width=10, img_height=10,
                color_mode="categorical", levels=["0.1", "0.2"],
                colors=["#ff0000", "#0000ff"])
    assert w.data["columns"]["color"] == [0.1, 0.2]


def test_spatial_rejects_an_unknown_colormap():
    with pytest.raises(ValueError, match="must be one of"):
        Spatial(make_data(), colormap="magma", **IMG)


def test_spatial_leaves_the_spot_diameter_to_the_browser_unless_given():
    w = Spatial(make_data(), **IMG)
    # The browser takes the median distance between neighbouring spots.
    assert "spotDiameter" not in w.data["meta"]
    w = Spatial(make_data(), spot_diameter=np.float32(55), **IMG)
    assert w.data["meta"]["spotDiameter"] == 55.0
    for bad in (0, -1.0, float("nan"), float("inf"), "8", True, [4, 8]):
        with pytest.raises(ValueError, match="`spot_diameter` must be a positive"):
            Spatial(make_data(), spot_diameter=bad, **IMG)


def test_spatial_takes_any_real_spot_diameter():
    from decimal import Decimal
    from fractions import Fraction

    for good in (55, 55.0, np.float32(55), np.int64(55), np.array(55.0),
                 np.array(55), Decimal("55"), Fraction(55)):
        w = Spatial(make_data(), spot_diameter=good, **IMG)
        assert w.data["meta"]["spotDiameter"] == 55.0, repr(good)
        assert type(w.data["meta"]["spotDiameter"]) is float, repr(good)
    for bad in (np.nan, np.inf, -np.inf, 0, -2, Decimal("NaN"), Decimal("sNaN"),
                Decimal("-Infinity"), Fraction(-1, 2), np.bool_(True),
                np.array(True), np.array("55"), np.array([55.0]), (55,),
                complex(55, 0), np.complex64(55), b"55"):
        with pytest.raises(ValueError, match="`spot_diameter` must be a positive"):
            Spatial(make_data(), spot_diameter=bad, **IMG)
