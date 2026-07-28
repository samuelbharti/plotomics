import numpy as np
import pytest

from plotomics import Oncoplot
from plotomics.oncoplot import memo_sort


def make_data():
    return {
        "gene": ["TP53", "TP53", "PIK3CA", "PIK3CA", "GATA3"],
        "sample": ["S1", "S2", "S2", "S3", "S1"],
        "class": ["Missense", "Truncating", "Missense", "Amplification",
                  "Missense"],
    }


def test_memo_sort_orders_genes_by_frequency():
    d = make_data()
    genes, _ = memo_sort(sorted(set(d["gene"])), sorted(set(d["sample"])),
                         d["gene"], d["sample"])
    # TP53 and PIK3CA are altered twice, GATA3 once; the tie breaks by name.
    assert genes == ["PIK3CA", "TP53", "GATA3"]


def test_memo_sort_produces_the_staircase():
    d = make_data()
    genes, samples = memo_sort(sorted(set(d["gene"])), sorted(set(d["sample"])),
                               d["gene"], d["sample"])
    # Samples are ranked by the highest-frequency gene they carry, which is
    # what makes mutual exclusivity read as a staircase rather than noise.
    assert samples == ["S2", "S3", "S1"]
    assert genes[0] == "PIK3CA"


def test_memo_sort_is_stable_for_an_untouched_sample():
    genes, samples = memo_sort(["A", "B"], ["S1", "S2", "S3"],
                               ["A", "B"], ["S1", "S1"])
    # S1 carries both, S2 and S3 carry nothing and fall to the end by name.
    assert samples == ["S1", "S2", "S3"]
    assert set(genes) == {"A", "B"}


def test_oncoplot_grid_is_row_major_with_zero_as_unaltered():
    d = make_data()
    w = Oncoplot(d)
    meta = w.data["meta"]
    nrows, ncols = meta["nrows"], meta["ncols"]
    assert (nrows, ncols) == (3, 3)

    codes = np.frombuffer(w.buffer, dtype=np.float32, count=nrows * ncols)
    gi = {g: i for i, g in enumerate(meta["genes"])}
    si = {s: i for i, s in enumerate(meta["samples"])}
    ci = {c: i + 1 for i, c in enumerate(meta["classes"])}

    # Every altered pair lands at its own row-major cell with its class code.
    for g, s, c in zip(d["gene"], d["sample"], d["class"]):
        assert codes[gi[g] * ncols + si[s]] == ci[c]
    # Exactly the five altered pairs are non-zero; the rest is unaltered.
    assert int((codes > 0).sum()) == 5


def test_oncoplot_classes_default_to_most_frequent_first():
    w = Oncoplot(make_data())
    assert w.data["meta"]["classes"][0] == "Missense"
    assert set(w.data["meta"]["classes"]) == {
        "Missense", "Truncating", "Amplification"
    }


def test_oncoplot_explicit_order_is_kept():
    w = Oncoplot(make_data(), genes=["TP53", "PIK3CA", "GATA3"],
                 samples=["S1", "S2", "S3"])
    assert w.data["meta"]["genes"] == ["TP53", "PIK3CA", "GATA3"]
    assert w.data["meta"]["samples"] == ["S1", "S2", "S3"]


def test_oncoplot_burden_and_frequency_are_derived():
    w = Oncoplot(make_data())
    meta = w.data["meta"]
    n = meta["nrows"] * meta["ncols"]
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    tmb = packed[n:n + meta["ncols"]]
    freq = packed[n + meta["ncols"]:]

    # Burden counts altered genes per sample; the five alterations spread over
    # three samples.
    assert tmb.sum() == 5
    assert len(freq) == meta["nrows"]
    assert all(0 <= f <= 100 for f in freq)


def test_oncoplot_explicit_burden_overrides():
    w = Oncoplot(make_data(), samples=["S1", "S2", "S3"], burden=[7, 8, 9])
    meta = w.data["meta"]
    n = meta["nrows"] * meta["ncols"]
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed[n:n + 3].tolist() == [7.0, 8.0, 9.0]


def test_oncoplot_annotation_encodes_levels_and_missing():
    w = Oncoplot(make_data(), samples=["S1", "S2", "S3"],
                 annotations=[{"name": "stage", "values": ["II", None, "I"]}])
    ann = w.data["meta"]["annotations"][0]
    assert ann["name"] == "stage"
    assert ann["levels"] == ["I", "II"]
    # -1 renders as an empty cell rather than borrowing level 0's colour.
    assert ann["codes"] == [1, -1, 0]


def test_oncoplot_options_passthrough():
    w = Oncoplot(make_data(), show_burden=False, show_frequency=False,
                 show_annotations=False, show_legend=False,
                 empty_color="#fff", theme={"background": "#000"})
    assert w.options["showBurden"] is False
    assert w.options["showFrequency"] is False
    assert w.options["showAnnotations"] is False
    assert w.options["showLegend"] is False
    assert w.options["emptyColor"] == "#fff"
    assert w.options["theme"] == {"background": "#000"}


def test_oncoplot_validates_its_input():
    d = make_data()

    with pytest.raises(ValueError, match="`gene`, `sample` and `class`"):
        Oncoplot({"gene": ["TP53"]})
    with pytest.raises(ValueError, match="at least one row"):
        Oncoplot({"gene": [], "sample": [], "class": []})
    with pytest.raises(ValueError, match="not present in `classes`"):
        Oncoplot(d, classes=["Missense"])
    with pytest.raises(ValueError, match="one entry per class"):
        Oncoplot(d, classes=["Missense", "Truncating", "Amplification"],
                 class_colors=["#f00"])
    with pytest.raises(ValueError, match="one value per sample"):
        Oncoplot(d, samples=["S1", "S2", "S3"], burden=[1, 2])
    with pytest.raises(ValueError, match="one value per sample"):
        Oncoplot(d, samples=["S1", "S2", "S3"],
                 annotations=[{"name": "stage", "values": ["II"]}])
    with pytest.raises(ValueError, match="`name` and `values`"):
        Oncoplot(d, annotations=[{"name": "stage"}])
