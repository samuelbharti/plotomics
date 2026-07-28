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
    assert w.options["xLabel"] == "months"


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
