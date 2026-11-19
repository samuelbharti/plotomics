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


def test_profile_warns_on_values_that_are_not_finite_and_keeps_them():
    # NaN and Infinity reach the plot as they are. It draws no bar for them
    # and leaves them out of the total, as it does for R's NA, sent as null.
    with pytest.warns(UserWarning, match="'value' contains 2 non-finite"):
        w = Profile({"value": [3, np.nan, np.inf, 5]}, as_fraction=True)
    values = np.frombuffer(w.buffer, dtype=np.float32)
    assert values[0] == 3 and values[3] == 5
    assert np.isnan(values[1]) and np.isinf(values[2])
    assert w.options["asFraction"] is True


def test_profile_refuses_negative_values_as_shares():
    # Shares of a total with negative values are not defined. A value that
    # is not finite is left out of the count, as the plot leaves it out.
    with pytest.raises(ValueError) as err:
        Profile({"value": [2, -2, 1, -np.inf, np.nan]}, as_fraction=True)
    assert str(err.value) == (
        "`as_fraction` needs every `value` to be 0 or more; "
        "found 1 negative value(s)."
    )
    # The sign is read before the float32 rounding, which turns -1e-50 into
    # -0. Before the fix Python let it through, where R stops.
    with pytest.raises(ValueError, match=r"found 1 negative value\(s\)\."):
        Profile({"value": [-1e-50, 2]}, as_fraction=True)
    # Without as_fraction the bars of negative values go down from 0.
    w = Profile({"value": [2, -2, 1]})
    assert np.frombuffer(w.buffer, dtype=np.float32).tolist() == [2, -2, 1]
    assert w.options["asFraction"] is False


def test_profile_takes_as_fraction_as_one_true_or_false():
    # Before the fix as_fraction=1 passed as true, and R skipped the check
    # for negative values on it. Both now want one True or False.
    d = make_data()
    for bad in (1, 0, None, "yes", [True]):
        with pytest.raises(
            ValueError, match="`as_fraction` must be a single true or false value."
        ):
            Profile(d, as_fraction=bad)
    w = Profile(d, as_fraction=np.True_)
    assert w.options["asFraction"] is True


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
