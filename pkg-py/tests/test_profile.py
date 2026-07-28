import numpy as np
import pytest

from plotomics import Profile


def make_data():
    return {
        "value": [3, 5, 2, 8],
        "group": ["C>A", "C>A", "C>T", "C>T"],
        "label": ["ACA", "ACC", "TCA", "TCT"],
    }


def test_profile_packs_values_in_order():
    w = Profile(make_data())
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["value"]["dtype"] == "float32"
    assert specs["value"]["length"] == 4
    # Bar order is part of the SBS96 convention, so nothing here sorts.
    assert np.frombuffer(w.buffer, dtype=np.float32).tolist() == [3, 5, 2, 8]


def test_profile_carries_group_and_label_columns():
    w = Profile(make_data())
    assert w.data["columns"]["group"] == ["C>A", "C>A", "C>T", "C>T"]
    assert w.data["columns"]["label"] == ["ACA", "ACC", "TCA", "TCT"]


def test_profile_group_order_defaults_to_appearance():
    w = Profile(make_data())
    assert w.data["meta"]["groups"] == ["C>A", "C>T"]


def test_profile_explicit_group_order_is_kept():
    w = Profile(make_data(), groups=["C>T", "C>A"],
                group_colors=["#f00", "#00f"])
    assert w.data["meta"]["groups"] == ["C>T", "C>A"]
    assert w.data["meta"]["groupColors"] == ["#f00", "#00f"]


def test_profile_works_without_groups_or_labels():
    w = Profile({"value": [1, 2, 3]})
    assert "group" not in w.data["columns"]
    assert "label" not in w.data["columns"]
    assert "groups" not in w.data["meta"]


def test_profile_title_and_options():
    w = Profile(make_data(), title="SBS13", bar_width=0.4, as_fraction=True,
                show_header=False, show_bar_labels=False, y_label="share",
                theme={"background": "#000"})
    assert w.data["meta"]["title"] == "SBS13"
    assert w.options["barWidth"] == 0.4
    assert w.options["asFraction"] is True
    assert w.options["showHeader"] is False
    assert w.options["showBarLabels"] is False
    assert w.options["yLabel"] == "share"
    assert w.options["theme"] == {"background": "#000"}


def test_profile_defaults():
    w = Profile(make_data())
    assert w.options["barWidth"] == 0.62
    assert w.options["asFraction"] is False
    assert w.options["showHeader"] is True
    assert w.options["yLabel"] == "mutations"
    assert "title" not in w.data["meta"]


def test_profile_validates_its_input():
    d = make_data()

    with pytest.raises(ValueError, match="`value` column"):
        Profile({"group": ["C>A"]})
    with pytest.raises(ValueError, match="at least one row"):
        Profile({"value": []})
    with pytest.raises(ValueError, match=r"must be in \(0, 1\]"):
        Profile(d, bar_width=0)
    with pytest.raises(ValueError, match=r"must be in \(0, 1\]"):
        Profile(d, bar_width=1.5)
    with pytest.raises(ValueError, match="not present in `groups`"):
        Profile(d, groups=["C>A"])
    with pytest.raises(ValueError, match="one entry per group"):
        Profile(d, groups=["C>A", "C>T"], group_colors=["#f00"])
