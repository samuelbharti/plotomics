import numpy as np
import pytest

from bioviz import Volcano, pack_columns


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
