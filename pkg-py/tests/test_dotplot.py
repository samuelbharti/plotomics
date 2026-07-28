import numpy as np
import pytest

from plotomics import Dotplot


def make_data():
    return {
        "gene": ["CD3D", "MS4A1", "CD3D", "MS4A1"],
        "cluster": ["T", "T", "B", "B"],
        "pct": [88, 4, 6, 91],
        "value": [2.4, 0.1, 0.2, 2.7],
    }


def test_dotplot_packs_pct_and_value():
    w = Dotplot(make_data())
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["pct"]["dtype"] == "float32"
    assert specs["value"]["dtype"] == "float32"
    assert specs["pct"]["length"] == 4
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed[:4].tolist() == [88.0, 4.0, 6.0, 91.0]


def test_dotplot_carries_key_columns_and_labels():
    w = Dotplot(make_data())
    assert w.data["columns"]["gene"] == ["CD3D", "MS4A1", "CD3D", "MS4A1"]
    assert w.data["columns"]["cluster"] == ["T", "T", "B", "B"]
    assert w.data["meta"]["valueLabel"] == "mean expression"
    assert w.data["meta"]["sizeLabel"] == "% expressing"


def test_dotplot_explicit_order_is_kept():
    w = Dotplot(make_data(), genes=["MS4A1", "CD3D"], clusters=["B", "T"])
    assert w.data["meta"]["genes"] == ["MS4A1", "CD3D"]
    assert w.data["meta"]["clusters"] == ["B", "T"]


def test_dotplot_order_from_pandas_categorical():
    pd = pytest.importorskip("pandas")
    d = make_data()
    df = pd.DataFrame({
        "gene": pd.Categorical(d["gene"], categories=["MS4A1", "CD3D"]),
        "cluster": pd.Categorical(d["cluster"], categories=["B", "T"]),
        "pct": d["pct"],
        "value": d["value"],
    })
    w = Dotplot(df)
    # The diagonal a dot plot is read for only appears under a stated order,
    # so a Categorical is taken as the caller stating it.
    assert w.data["meta"]["genes"] == ["MS4A1", "CD3D"]
    assert w.data["meta"]["clusters"] == ["B", "T"]


def test_dotplot_omits_order_when_not_given():
    w = Dotplot(make_data())
    assert "genes" not in w.data["meta"]
    assert "clusters" not in w.data["meta"]


def test_dotplot_value_domain_and_options():
    w = Dotplot(make_data(), colormap="magma", max_radius=12.0,
                value_domain=(0.0, 3.0), show_grid=False, show_legend=False,
                theme={"background": "#000"})
    assert w.options["colormap"] == "magma"
    assert w.options["maxRadius"] == 12.0
    assert w.options["valueDomain"] == [0.0, 3.0]
    assert w.options["showGrid"] is False
    assert w.options["showLegend"] is False
    assert w.options["theme"] == {"background": "#000"}


def test_dotplot_defaults():
    w = Dotplot(make_data())
    assert w.options["colormap"] == "viridis"
    assert w.options["maxRadius"] == 9.0
    assert w.options["showGrid"] is True
    assert "valueDomain" not in w.options
    assert "theme" not in w.options


def test_dotplot_validates_its_input():
    d = make_data()

    with pytest.raises(ValueError, match="missing column"):
        Dotplot({"gene": ["A"], "cluster": ["T"]})
    with pytest.raises(ValueError, match="at least one row"):
        Dotplot({"gene": [], "cluster": [], "pct": [], "value": []})
    # pct is a percentage, not a fraction: 0.88 would silently draw a dot at
    # nearly zero area rather than at 88 percent.
    with pytest.raises(ValueError, match=r"percentage in \[0, 100\]"):
        Dotplot({**d, "pct": [88, 4, 6, 140]})
    with pytest.raises(ValueError, match="not present in `genes`"):
        Dotplot(d, genes=["CD3D"])
    with pytest.raises(ValueError, match="not present in `clusters`"):
        Dotplot(d, clusters=["T"])
    with pytest.raises(ValueError, match="length 2"):
        Dotplot(d, value_domain=(0.0, 1.0, 2.0))
