import numpy as np
import pytest

from plotomics import Upset


def make_args():
    """Three intersections over two sets: A only, B only, A and B."""
    data = {"size": [40, 25, 12]}
    membership = np.array([[1, 0], [0, 1], [1, 1]])
    return data, membership


def test_upset_flattens_membership_row_major():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership)

    meta = w.data["meta"]
    assert meta["sets"] == ["A", "B"]
    # The component indexes membership as intersection * nSets + set. Getting
    # this order wrong silently pairs each bar with the wrong dot column.
    assert meta["membership"] == [1, 0, 0, 1, 1, 1]
    for i in range(3):
        assert meta["membership"][i * 2:(i + 1) * 2] == membership[i].tolist()


def test_upset_packs_sizes_as_float32():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership)

    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["size"]["dtype"] == "float32"
    assert specs["size"]["length"] == 3
    assert np.frombuffer(w.buffer, dtype=np.float32).tolist() == [40.0, 25.0, 12.0]


def test_upset_accepts_boolean_membership():
    data, _ = make_args()
    m = np.array([[True, False], [False, True], [True, True]])
    w = Upset(data, sets=["A", "B"], membership=m)
    assert w.data["meta"]["membership"] == [1, 0, 0, 1, 1, 1]


def test_upset_set_sizes_and_total():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership,
              set_sizes=[52, 37], total=77)
    assert w.data["meta"]["setSizes"] == [52.0, 37.0]
    assert w.data["meta"]["total"] == 77.0


def test_upset_omits_optional_meta_when_absent():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership)
    assert "setSizes" not in w.data["meta"]
    assert "total" not in w.data["meta"]


def test_upset_options_passthrough():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership, bar_fraction=0.4,
              show_set_sizes=False, dot_radius=3.0, bar_color="#123456",
              empty_dot_color="#eee", y_label="shared drivers",
              theme={"foreground": "#fff"})
    assert w.options["barFraction"] == 0.4
    assert w.options["showSetSizes"] is False
    assert w.options["dotRadius"] == 3.0
    assert w.options["barColor"] == "#123456"
    assert w.options["emptyDotColor"] == "#eee"
    assert w.options["yLabel"] == "shared drivers"
    assert w.options["theme"] == {"foreground": "#fff"}


def test_upset_defaults():
    data, membership = make_args()
    w = Upset(data, sets=["A", "B"], membership=membership)
    assert w.options["barFraction"] == 0.55
    assert w.options["showSetSizes"] is True
    assert w.options["yLabel"] == "intersection size"
    assert "barColor" not in w.options


def test_upset_validates_its_input():
    data, membership = make_args()

    with pytest.raises(ValueError, match="`size` column"):
        Upset({"n": [1, 2, 3]}, sets=["A", "B"], membership=membership)
    with pytest.raises(ValueError, match="at least one row"):
        Upset({"size": []}, sets=["A", "B"], membership=np.zeros((0, 2)))
    with pytest.raises(ValueError, match="at least one set"):
        Upset(data, sets=[], membership=membership)
    with pytest.raises(ValueError, match="one row per intersection"):
        Upset(data, sets=["A", "B"], membership=membership[:2])
    with pytest.raises(ValueError, match="one column per set"):
        Upset(data, sets=["A", "B", "C"], membership=membership)
    with pytest.raises(ValueError, match="one entry per set"):
        Upset(data, sets=["A", "B"], membership=membership, set_sizes=[1])
