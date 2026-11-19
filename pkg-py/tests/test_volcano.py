import math
import re
import warnings

import numpy as np
import pytest

from plotomics import Volcano, pack_columns


def test_pack_columns_roundtrip_layout():
    x = np.array([1.0, 2.0, 3.0], dtype=np.float32)
    cat = np.array([0, 1, 0], dtype=np.int32)
    buf, schema = pack_columns({"x": x, "cat": cat})

    assert len(buf) == x.nbytes + cat.nbytes
    specs = {c["name"]: c for c in schema["columns"]}
    assert specs["x"]["dtype"] == "float32"
    assert specs["x"]["byteOffset"] == 0
    assert specs["cat"]["dtype"] == "int32"
    assert specs["cat"]["byteOffset"] == x.nbytes
    # Bytes decode back to the original values.
    assert np.frombuffer(buf, dtype=np.float32, count=3).tolist() == [1.0, 2.0, 3.0]


def test_pack_columns_downcasts_int64():
    buf, schema = pack_columns({"i": np.array([1, 2, 3], dtype=np.int64)})
    assert schema["columns"][0]["dtype"] == "int32"
    assert len(buf) == 3 * 4


def test_pack_columns_rejects_non_numeric():
    with pytest.raises(ValueError, match="'x' must be numeric"):
        pack_columns({"x": np.array(["a", "b", "c"], dtype=object)})


def test_pack_columns_raises_on_int64_overflow():
    big = np.array([1, 2**40], dtype=np.int64)  # exceeds int32 range
    with pytest.raises(ValueError, match="int32 range"):
        pack_columns({"i": big})


def test_pack_columns_warns_on_nonfinite():
    arr = np.array([1.0, np.nan, np.inf], dtype=np.float32)
    with pytest.warns(UserWarning, match="non-finite"):
        pack_columns({"x": arr})


def test_pack_columns_requires_equal_length():
    with pytest.raises(ValueError, match="same length"):
        pack_columns({"x": np.array([1.0, 2.0, 3.0]), "y": np.array([1.0, 2.0])})


def test_pack_columns_allows_unequal_length_when_opted_out():
    buf, schema = pack_columns(
        {"x": np.array([1.0, 2.0, 3.0]), "w": np.array([1.0])},
        equal_length=False,
    )
    lengths = {c["name"]: c["length"] for c in schema["columns"]}
    assert lengths == {"x": 3, "w": 1}


def test_volcano_builds_traits_from_dict():
    data = {"x": [-2.0, 0.0, 2.0], "y": [3.0, 0.1, 4.0], "label": ["A", "B", "C"]}
    w = Volcano(data, fc_threshold=1.5, p_threshold=0.01, label_top_n=5)

    assert w.options["fcThreshold"] == 1.5
    assert w.options["pThreshold"] == 0.01
    assert w.options["labelTopN"] == 5
    assert w.data["columns"]["label"] == ["A", "B", "C"]
    # x + y packed as two float32 columns of length 3.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"x", "y"}
    assert len(w.buffer) == 3 * 4 * 2


def test_volcano_requires_x_and_y():
    with pytest.raises(ValueError, match="x` and `y`"):
        Volcano({"x": [1, 2, 3]})


def test_volcano_omits_label_when_absent():
    w = Volcano({"x": [1, 2], "y": [1, 2]})
    assert "label" not in w.data["columns"]


def test_volcano_colors_and_threshold_lines_in_options():
    w = Volcano(
        {"x": [1, 2], "y": [1, 2]},
        colors={"up": "#f00", "down": "#00f", "ns": "#ccc"},
        show_threshold_lines=False,
    )
    assert w.options["colors"] == {"up": "#f00", "down": "#00f", "ns": "#ccc"}
    assert w.options["showThresholdLines"] is False


def test_volcano_default_shows_threshold_lines_and_omits_colors():
    w = Volcano({"x": [1, 2], "y": [1, 2]})
    assert w.options["showThresholdLines"] is True
    assert "colors" not in w.options


def test_volcano_theme_in_options():
    w = Volcano({"x": [1, 2], "y": [1, 2]}, theme={"foreground": "#fff"})
    assert w.options["theme"] == {"foreground": "#fff"}


def test_volcano_rejects_string_columns():
    with pytest.raises(ValueError, match="'x' must be numeric"):
        Volcano({"x": ["a", "b"], "y": [1.0, 2.0]})


def test_volcano_rejects_plain_ndarray():
    with pytest.raises(ValueError, match="named columns"):
        Volcano(np.zeros((3, 2)))


def test_volcano_rejects_empty_data():
    with pytest.raises(ValueError, match="at least one row"):
        Volcano({"x": [], "y": []})


def test_volcano_sends_a_missing_symbol_as_null():
    d = {"x": [1.0, -2.0], "y": [3.0, 0.5], "label": ["TP53", float("nan")]}
    assert Volcano(d).data["columns"]["label"] == ["TP53", None]


def test_volcano_reads_a_frame_without_the_optional_columns():
    # A frame-like object whose lookup of a missing column raises its own
    # error, as polars does (ColumnNotFoundError).
    class ColumnNotFoundError(Exception):
        pass

    class Frame:
        columns = ["x", "y"]
        _cols = {"x": [1.0, -2.0], "y": [3.0, 0.5]}

        def __getitem__(self, name):
            if name not in self._cols:
                raise ColumnNotFoundError(name)
            return self._cols[name]

    w = Volcano(Frame())
    assert "label" not in w.data["columns"]


def test_wrappers_read_a_polars_frame_with_optional_columns_left_out():
    pl = pytest.importorskip("polars")
    from plotomics import Embedding, Km

    w = Volcano(pl.DataFrame({"x": [1.0, -2.0], "y": [3.0, 0.5]}))
    assert "label" not in w.data["columns"]
    w = Volcano(pl.DataFrame({"x": [1.0, -2.0], "y": [3.0, 0.5],
                              "label": ["TP53", None]}))
    assert w.data["columns"]["label"] == ["TP53", None]
    Km(pl.DataFrame({"time": [0.0, 5.0], "surv": [1.0, 0.8]}))
    w = Embedding(pl.DataFrame({"x": [0.0, 1.0], "y": [0.0, 1.0],
                                "color": ["a", None]}))
    assert w.data["columns"]["color"] == ["a", None]


def test_wrappers_read_a_table_that_names_its_columns_in_column_names():
    # A pyarrow Table keeps its arrays in `columns` and the names in
    # `column_names`, and each value is a scalar with as_py().
    class Scalar:
        def __init__(self, v):
            self.v = v

        def as_py(self):
            return self.v

    class Table:
        column_names = ["x", "y", "label"]
        _cols = {"x": [1.0, -2.0], "y": [3.0, 0.5],
                 "label": [Scalar("TP53"), Scalar(None)]}

        @property
        def columns(self):
            return list(self._cols.values())

        def __getitem__(self, name):
            return self._cols[name]

    w = Volcano(Table())
    assert w.data["columns"]["label"] == ["TP53", None]
    assert {c["name"] for c in w.schema["columns"]} == {"x", "y"}


def test_embedding_reads_a_polars_categorical_as_text():
    pl = pytest.importorskip("polars")
    from plotomics import Embedding

    other = pl.Series(["liver", "lung"], dtype=pl.Categorical)
    color = pl.Series(["b", "a", None], dtype=pl.Categorical)
    w = Embedding(pl.DataFrame({"x": [0.0, 1.0, 2.0], "y": [0.0, 1.0, 2.0],
                                "color": color}))
    assert "liver" not in w.options.get("categories", [])
    assert other.len() == 2
    assert w.data["columns"]["color"] == ["b", "a", None]


def test_volcano_counts_only_the_y_values_it_does_not_draw_as_r_does():
    d = {"x": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
         "y": [np.inf, np.inf, np.nan, None, -np.inf, 2.0]}
    # Before the fix the two p = 0 genes were counted with the missing ones:
    # "column 'y' contains 5 non-finite value(s) (NaN/Inf)".
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Volcano(d)
    assert [str(w.message) for w in caught] == [
        (
            "`y` has 3 value(s) that are missing (NA or NaN) or -Inf; those "
            "rows are not drawn."
        )
    ]
    # p = 0 alone is no warning.
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        Volcano({"x": [1.0, 2.0], "y": [np.inf, 2.0]})
    # x keeps its own warning.
    with pytest.warns(UserWarning, match=re.escape("'x' contains 1 non-finite")):
        Volcano({"x": [np.inf, 2.0], "y": [1.0, 2.0]})


def test_volcano_label_top_n_inf_labels_every_gene_as_lollipop_does():
    d = {"x": [-3.0, -2.0, 2.0, 3.0], "y": [5.0, 4.0, 4.0, 5.0],
         "label": ["a", "b", "c", "d"]}
    # JSON has no inf: it is sent as one label per gene.
    assert Volcano(d, label_top_n=math.inf).options["labelTopN"] == 4
    assert Volcano(d, label_top_n=float("inf")).options["labelTopN"] == 4
    assert Volcano(d, label_top_n=-math.inf).options["labelTopN"] == 0
    assert Volcano(d, label_top_n=2).options["labelTopN"] == 2
