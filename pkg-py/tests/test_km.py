import warnings

import numpy as np
import pytest

from plotomics import Km


def make_data():
    return {
        "time": [0, 5, 12, 0, 7, 15],
        "surv": [1.0, 0.9, 0.7, 1.0, 0.8, 0.5],
        "group": ["treated"] * 3 + ["control"] * 3,
    }


def test_km_packs_time_and_surv():
    w = Km(make_data())
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["time"]["dtype"] == "float32"
    assert specs["surv"]["dtype"] == "float32"
    assert specs["time"]["length"] == 6
    assert w.data["columns"]["group"][0] == "treated"


def test_km_packs_confidence_band_when_present():
    data = make_data()
    data["lower"] = [1.0, 0.8, 0.5, 1.0, 0.7, 0.3]
    data["upper"] = [1.0, 1.0, 0.9, 1.0, 0.9, 0.7]
    w = Km(data)
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"time", "surv", "lower", "upper"}


def test_km_omits_band_columns_when_absent():
    w = Km(make_data())
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"time", "surv"}


def test_km_group_order_defaults_to_appearance():
    w = Km(make_data())
    # "treated" appears first in the data, so it leads.
    assert w.data["meta"]["groups"] == ["treated", "control"]


def test_km_group_order_from_pandas_categorical():
    pd = pytest.importorskip("pandas")
    data = make_data()
    df = pd.DataFrame({
        "time": data["time"],
        "surv": data["surv"],
        "group": pd.Categorical(data["group"], categories=["control", "treated"]),
    })
    w = Km(df)
    assert w.data["meta"]["groups"] == ["control", "treated"]


def test_km_risk_counts_are_row_major():
    w = Km(make_data(), groups=["treated", "control"], risk_times=[0, 5, 10],
           risk_counts=np.array([[30, 20, 10], [28, 15, 6]]))
    meta = w.data["meta"]
    assert meta["riskTimes"] == [0.0, 5.0, 10.0]
    # Indexed as group * ntimes + j, so the second stratum follows the first.
    assert meta["riskCounts"] == [30, 20, 10, 28, 15, 6]


def test_km_censor_ticks():
    w = Km(make_data(), censor={"time": [3, 9], "surv": [0.95, 0.75],
                                "group": ["treated", "control"]})
    meta = w.data["meta"]
    assert meta["censorTime"] == [3.0, 9.0]
    assert meta["censorSurv"] == [0.95, 0.75]
    assert meta["censorGroup"] == ["treated", "control"]


def test_km_p_label_and_group_colors():
    w = Km(make_data(), groups=["treated", "control"],
           group_colors=["#f00", "#00f"], p_label="log-rank p = 0.02")
    assert w.data["meta"]["pLabel"] == "log-rank p = 0.02"
    assert w.data["meta"]["groupColors"] == ["#f00", "#00f"]


def test_km_options_passthrough():
    w = Km(make_data(), show_ci=False, show_censors=False,
           show_risk_table=False, show_legend=False, y_from_zero=False,
           line_width=3.0, x_label="years", y_label="PFS",
           theme={"background": "#000"})
    assert w.options["showCI"] is False
    assert w.options["showCensors"] is False
    assert w.options["showRiskTable"] is False
    assert w.options["showLegend"] is False
    assert w.options["yFromZero"] is False
    assert w.options["lineWidth"] == 3.0
    assert w.options["xLabel"] == "years"
    assert w.options["yLabel"] == "PFS"
    assert w.options["theme"] == {"background": "#000"}


def test_km_defaults():
    w = Km(make_data())
    assert w.options["showCI"] is True
    assert w.options["showRiskTable"] is True
    assert w.options["yFromZero"] is True
    assert w.options["xLabel"] == "time"


def test_km_validates_its_input():
    data = make_data()

    with pytest.raises(ValueError, match="`time` and `surv`"):
        Km({"time": [1, 2]})
    with pytest.raises(ValueError, match="at least one row"):
        Km({"time": [], "surv": []})
    # A survival probability outside [0, 1] means the fit was misread.
    with pytest.raises(ValueError, match=r"probability in \[0, 1\]"):
        Km({"time": [0, 1], "surv": [1.0, 1.4]})
    with pytest.raises(ValueError, match="not present in `groups`"):
        Km(data, groups=["treated"])
    with pytest.raises(ValueError, match="one entry per stratum"):
        Km(data, groups=["treated", "control"], group_colors=["#f00"])
    with pytest.raises(ValueError, match="one column per `risk_times` entry"):
        Km(data, groups=["treated", "control"], risk_times=[0, 5],
           risk_counts=np.array([[30, 20, 10], [28, 15, 6]]))
    with pytest.raises(ValueError, match="one row per stratum"):
        Km(data, groups=["treated", "control"], risk_times=[0, 5],
           risk_counts=np.array([[30, 20]]))


def test_km_sends_the_colour_of_a_single_curve():
    w = Km({"time": [0, 5], "surv": [1.0, 0.8]}, group_colors=["#123456"])
    assert w.data["meta"]["groupColors"] == ["#123456"]
    with pytest.raises(ValueError, match="one entry per stratum"):
        Km({"time": [0, 5], "surv": [1.0, 0.8]}, group_colors=["#1", "#2"])


def test_km_risk_counts_follow_a_stratum_index():
    pd = pytest.importorskip("pandas")
    data = {"time": [0, 5, 0, 5], "surv": [1, 0.8, 1, 0.6],
            "group": ["a", "a", "b", "b"]}
    counts = pd.DataFrame([[10, 8], [20, 15]], index=["b", "a"])
    w = Km(data, risk_times=[0, 5], risk_counts=counts)
    assert w.data["meta"]["riskCounts"] == [20, 15, 10, 8]
    # A default index says nothing about the strata, so rows keep their order.
    w = Km(data, risk_times=[0, 5], risk_counts=pd.DataFrame([[10, 8], [20, 15]]))
    assert w.data["meta"]["riskCounts"] == [10, 8, 20, 15]


def test_km_leaves_a_missing_group_out_of_the_strata():
    d = {"time": [0.0, 5.0, 0.0, 5.0], "surv": [1.0, 0.8, 1.0, 0.6],
         "group": ["a", "a", float("nan"), float("nan")]}
    w = Km(d)
    assert w.data["meta"]["groups"] == ["a"]
    assert w.data["columns"]["group"] == ["a", "a", None, None]


def test_km_leaves_out_a_censor_tick_without_a_group():
    d = {"time": [0.0, 2.0, 0.0, 2.0], "surv": [1.0, 0.9, 1.0, 0.5],
         "group": ["a", "a", float("nan"), float("nan")]}
    w = Km(d, censor={"time": [4, 4], "surv": [0.9, 0.5],
                      "group": ["a", float("nan")]})
    assert w.data["meta"]["censorGroup"] == ["a", None]


def test_km_with_every_group_missing_has_no_strata():
    w = Km({"time": [0.0, 2.0], "surv": [1.0, 0.5],
            "group": [float("nan"), float("nan")]})
    assert w.data["meta"]["groups"] == []
    assert w.data["columns"]["group"] == [None, None]


def test_km_reads_a_polars_categorical_by_its_own_values():
    pl = pytest.importorskip("polars")
    # polars lists every string that a live Categorical holds, from any
    # column, in each Categorical's categories.
    other = pl.Series(["liver", "lung", "kidney"], dtype=pl.Categorical)
    group = pl.Series(["treated", "treated", "control", "control"],
                      dtype=pl.Categorical)
    d = pl.DataFrame({"time": [0.0, 5.0, 0.0, 5.0],
                      "surv": [1.0, 0.8, 1.0, 0.6], "group": group})
    assert Km(d).data["meta"]["groups"] == ["treated", "control"]
    assert other.len() == 3
    # An Enum states its own levels, in its order.
    enum = pl.Enum(["control", "treated"])
    d = d.with_columns(pl.col("group").cast(pl.String).cast(enum))
    assert Km(d).data["meta"]["groups"] == ["control", "treated"]


def test_km_stops_on_censor_without_time_and_surv():
    d = {"time": [0.0, 5.0], "surv": [1.0, 0.8]}
    with pytest.raises(ValueError, match="`censor` must provide"):
        Km(d, censor={"time": [3.0]})


def test_km_leaves_out_a_row_with_a_missing_time_or_surv_as_r_does():
    d = {
        "time": [0, 5, 9, 12, 0, None, 15],
        "surv": [1.0, 0.9, float("nan"), 0.7, 1.0, 0.8, 0.5],
        "lower": [1.0, 0.8, 0.7, 0.6, 1.0, 0.7, 0.4],
        "group": ["t", "t", "t", "t", "c", "c", "c"],
    }
    # Before the fix NaN went to the browser, which drew a slope across it.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        w = Km(d)
    assert [str(c.message) for c in caught] == [
        "Left out 2 row(s) with a missing `time` or `surv`."
    ]
    specs = {c["name"]: c for c in w.schema["columns"]}

    def column(name):
        s = specs[name]
        return np.frombuffer(w.buffer, dtype=s["dtype"], count=s["length"],
                             offset=s["byteOffset"]).tolist()

    assert column("time") == [0, 5, 12, 0, 15]
    assert column("surv") == pytest.approx([1, 0.9, 0.7, 1, 0.5])
    assert column("lower") == pytest.approx([1, 0.8, 0.6, 1, 0.4])
    assert w.data["columns"]["group"] == ["t", "t", "t", "c", "c"]
    assert w.data["meta"]["groups"] == ["t", "c"]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with pytest.raises(ValueError, match="at least one row"):
            Km({"time": [0.0, None], "surv": [float("nan"), 1.0]})


def test_km_checks_every_column_length_before_leaving_rows_out():
    nan = float("nan")
    # Before the fix the short lower column was paired with the rows kept,
    # 0.9 at t = 9, where it should have raised.
    with pytest.raises(ValueError, match="same length; got time=3, surv=3, "
                                         "lower=2"):
        Km({"time": [0, 5, 9], "surv": [1.0, nan, 0.5], "lower": [1.0, 0.9]})
    with pytest.raises(ValueError, match="same length; got time=3, surv=3, "
                                         "group=2"):
        Km({"time": [0, 5, 9], "surv": [1.0, 0.9, 0.5], "group": ["a", "a"]})


def test_km_warns_about_an_infinite_time_and_a_missing_bound_as_r_does():
    d = {
        "time": [0.0, 5.0, float("inf"), 12.0],
        "surv": [1.0, 0.9, 0.8, 0.7],
        "lower": [1.0, None, 0.7, 0.6],
        "upper": [1.0, 1.0, float("nan"), float("inf")],
    }
    # Before the fix each column warned in words of its own, unlike R.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Km(d)
    assert [str(c.message) for c in caught] == [
        "`time` has 1 infinite value(s); those rows are not drawn.",
        (
            "`lower` has 1 value(s) that are missing (NA or NaN) or "
            "infinite; the confidence band has a gap there."
        ),
        (
            "`upper` has 2 value(s) that are missing (NA or NaN) or "
            "infinite; the confidence band has a gap there."
        ),
    ]
