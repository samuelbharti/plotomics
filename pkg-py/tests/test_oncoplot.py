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


def test_oncoplot_forwards_bar_colour_label_and_cell_gap_options():
    d = Oncoplot(make_data())
    assert d.options["burdenColor"] == "#0E7175"
    assert d.options["frequencyColor"] == "#ED773C"
    assert d.options["xLabel"] == "samples"
    assert d.options["burdenLabel"] == "alterations"
    assert d.options["cellGapX"] == 0.12
    assert d.options["cellGapY"] == 0.16

    w = Oncoplot(make_data(), burden_color="#111111",
                 frequency_color="#222222", x_label="patients",
                 burden_label="mutations", cell_gap_x=0, cell_gap_y=0)
    assert w.options["burdenColor"] == "#111111"
    assert w.options["frequencyColor"] == "#222222"
    assert w.options["xLabel"] == "patients"
    assert w.options["burdenLabel"] == "mutations"
    # A zero gap draws a solid block, so it must survive the payload.
    assert w.options["cellGapX"] == 0
    assert w.options["cellGapY"] == 0


def test_memo_sort_counts_a_gene_once_per_sample():
    # A is hit three times in S1 alone; B once in each of S1 and S2.
    genes, _ = memo_sort(["A", "B"], ["S1", "S2"],
                         ["A", "A", "A", "B", "B"],
                         ["S1", "S1", "S1", "S1", "S2"])
    assert genes == ["B", "A"]


def test_given_genes_keep_their_order_and_sort_the_samples():
    genes, samples = memo_sort(["GATA3", "TP53", "PIK3CA"], ["S1", "S2", "S3"],
                               make_data()["gene"], make_data()["sample"],
                               sort_genes=False)
    assert genes == ["GATA3", "TP53", "PIK3CA"]
    # S1 carries GATA3, the top row, so it comes first.
    assert samples[0] == "S1"
    w = Oncoplot(make_data(), genes=["GATA3", "TP53", "PIK3CA"])
    assert w.data["meta"]["genes"] == ["GATA3", "TP53", "PIK3CA"]
    assert w.data["meta"]["samples"] == samples


def test_two_classes_in_one_cell_are_drawn_as_multi_hit():
    d = make_data()
    d = {k: [*v, extra] for (k, v), extra in
         zip(d.items(), ["TP53", "S1", "Truncating"])}
    w = Oncoplot(d, class_colors=["#111111", "#222222", "#333333"],
                 classes=["Missense", "Truncating", "Amplification"])
    meta = w.data["meta"]
    assert meta["classes"][-1] == "Multi-hit"
    assert meta["classColors"][-1] == "#3A3A3A"
    ncols = meta["ncols"]
    codes = np.frombuffer(w.buffer, dtype=np.float32,
                          count=meta["nrows"] * ncols)
    cell = meta["genes"].index("TP53") * ncols + meta["samples"].index("S1")
    assert codes[cell] == len(meta["classes"])
    # The other cells keep their own class.
    cell = meta["genes"].index("TP53") * ncols + meta["samples"].index("S2")
    assert codes[cell] == meta["classes"].index("Truncating") + 1


def test_keyed_annotation_values_follow_their_samples():
    values = {"S1": "LumA", "S2": "Basal", "S3": "LumA"}
    w = Oncoplot(make_data(), annotations=[{"name": "subtype", "values": values}])
    samples = w.data["meta"]["samples"]
    # Memo sort moves S1 last, so reading the values by position would be wrong.
    assert samples != ["S1", "S2", "S3"]
    ann = w.data["meta"]["annotations"][0]
    shown = [ann["levels"][c] for c in ann["codes"]]
    assert shown == [values[s] for s in samples]


def test_series_annotation_values_follow_their_samples():
    pd = pytest.importorskip("pandas")
    values = pd.Series(["LumA", "Basal", "Her2"], index=["S1", "S2", "S3"])
    w = Oncoplot(make_data(), annotations=[{"name": "subtype", "values": values}])
    ann = w.data["meta"]["annotations"][0]
    shown = [ann["levels"][c] for c in ann["codes"]]
    assert shown == [values[s] for s in w.data["meta"]["samples"]]
    # A Series with a default index is read in the order of `samples`.
    w = Oncoplot(make_data(), samples=["S3", "S1", "S2"],
                 annotations=[{"name": "subtype",
                               "values": pd.Series(["Her2", "LumA", "Basal"])}])
    ann = w.data["meta"]["annotations"][0]
    assert [ann["levels"][c] for c in ann["codes"]] == ["Her2", "LumA", "Basal"]


def test_annotation_needs_sample_names():
    with pytest.raises(ValueError, match="needs sample names"):
        Oncoplot(make_data(),
                 annotations=[{"name": "stage", "values": ["I", "II", "I"]}])
    with pytest.raises(ValueError, match="no value for sample"):
        Oncoplot(make_data(),
                 annotations=[{"name": "stage", "values": {"S1": "I"}}])
