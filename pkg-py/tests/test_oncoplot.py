import re

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


def test_series_indexed_by_row_number_is_read_by_position():
    pd = pytest.importorskip("pandas")
    clin = pd.DataFrame({"sample": ["S0", "S3", "S1", "S2"],
                         "subtype": ["X", "Her2", "LumA", "Basal"]})
    # Filtering leaves the row numbers 1, 2, 3, which name no sample.
    keep = clin[clin["sample"] != "S0"]
    w = Oncoplot(make_data(), samples=list(keep["sample"]),
                 annotations=[{"name": "subtype", "values": keep["subtype"]}])
    ann = w.data["meta"]["annotations"][0]
    assert [ann["levels"][c] for c in ann["codes"]] == ["Her2", "LumA", "Basal"]


def test_annotation_with_two_values_for_a_sample_fails():
    pd = pytest.importorskip("pandas")
    values = pd.Series(["a", "b", "c"], index=["S1", "S2", "S1"])
    with pytest.raises(ValueError, match="more than one value"):
        Oncoplot(make_data(),
                 annotations=[{"name": "subtype", "values": values}])


def test_multi_hit_without_given_colours_sends_no_colours():
    d = make_data()
    d = {k: [*v, extra] for (k, v), extra in
         zip(d.items(), ["TP53", "S1", "Truncating"])}
    w = Oncoplot(d)
    # The browser draws Multi-hit in dark grey when no colours are sent.
    assert w.data["meta"]["classes"][-1] == "Multi-hit"
    assert "classColors" not in w.data["meta"]


def test_oncoplot_breaks_ties_as_r_does():
    # Every class appears twice, and four genes are altered in one sample
    # each. R's oncoplot() gives the same order for this table.
    alt = {
        "gene": ["TP53", "tp53", "KRAS", "KRAS", "_X", "EGFR"],
        "sample": ["b", "B", "a", "_s", "a", "c"],
        "class": ["missense", "Missense", "missense", "Missense", "_amp",
                  "_amp"],
    }
    sex = {"b": "f", "B": "F", "a": "_x", "_s": "f", "c": None}
    meta = Oncoplot(alt, annotations=[{"name": "sex", "values": sex}]).data[
        "meta"
    ]
    assert meta["classes"] == ["Missense", "_amp", "missense"]
    assert meta["genes"] == ["KRAS", "EGFR", "TP53", "_X", "tp53"]
    assert meta["samples"] == ["a", "_s", "c", "b", "B"]
    assert meta["annotations"][0]["levels"] == ["F", "_x", "f"]
    assert meta["annotations"][0]["codes"] == [1, 2, -1, 2, 0]


def test_oncoplot_leaves_out_a_row_with_no_gene_or_sample_as_r_does():
    na = {
        "gene": ["A", None, "B", "C", "C", "A"],
        "sample": ["s1", "s2", "s2", float("nan"), "s3", "s4"],
        "class": ["m", "n", "m", "m", "n", "m"],
    }
    w = Oncoplot(na)
    meta = w.data["meta"]
    # R: genes A B C, samples s1 s4 s2 s3; no gene or sample named "nan".
    # The row (C, nan) is left out before C is counted, so C is altered in
    # one sample, as B is, and follows it by name.
    assert meta["genes"] == ["A", "B", "C"]
    assert meta["samples"] == ["s1", "s4", "s2", "s3"]
    codes = np.frombuffer(w.buffer, dtype=np.float32, count=12)
    assert codes.tolist() == [1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2]
    # Two classes for a sample with no gene make no Multi-hit, and no class.
    nm = {"gene": ["A", None, None], "sample": ["s1", "s2", "s2"],
          "class": ["m", "m", "n"]}
    assert Oncoplot(nm).data["meta"]["classes"] == ["m"]


def test_oncoplot_row_with_no_gene_or_sample_adds_no_column_or_row():
    d = {
        "gene": ["TP53", None, "KRAS", "TP53"],
        "sample": ["S1", "S2", None, "S3"],
        "class": ["Missense", "Missense", "Nonsense", "Missense"],
    }
    w = Oncoplot(d)
    meta = w.data["meta"]
    # Before the fix S2 was a column and KRAS an empty row, and TP53, altered
    # in both real samples, read 66.7%.
    assert meta["genes"] == ["TP53"]
    assert meta["samples"] == ["S1", "S3"]
    assert meta["classes"] == ["Missense"]
    freq = next(c for c in w.schema["columns"] if c["name"] == "freq")
    got = np.frombuffer(w.buffer, dtype=np.float32, count=1,
                        offset=freq["byteOffset"])
    assert got.tolist() == [100.0]
    # memo_sort leaves such a pair out of its counts too: B is altered in
    # one sample, as A is, so the tie goes by name.
    genes, _ = memo_sort(["A", "B"], ["s1", "s2"], ["A", "B", "B"],
                         ["s1", None, "s2"])
    assert genes == ["A", "B"]
    with pytest.raises(ValueError, match="at least one row"):
        Oncoplot({"gene": [None], "sample": ["S1"], "class": ["m"]})


def test_annotation_colours_follow_categories_and_colour_names():
    pd = pytest.importorskip("pandas")
    alt = {"gene": ["TP53", "TP53", "KRAS"], "sample": ["S1", "S2", "S3"],
           "class": ["Missense"] * 3}
    risk = pd.Series(
        pd.Categorical(["Low", "High", "Medium"],
                       categories=["Low", "Medium", "High"]),
        index=["S1", "S2", "S3"],
    )
    cols = {"High": "#FF0000", "Low": "#00AA00", "Medium": "#FFA500"}

    def strip(values, colors=None):
        w = Oncoplot(alt, samples=["S1", "S2", "S3"], annotations=[
            {"name": "Risk", "values": values, "colors": colors}
        ])
        return w.data["meta"]["annotations"][0]

    # Before the fix the levels were High, Low, Medium and a dict sent its
    # keys as the colours.
    a = strip(risk, cols)
    assert a["levels"] == ["Low", "Medium", "High"]
    assert a["codes"] == [0, 2, 1]
    assert a["colors"] == ["#00AA00", "#FFA500", "#FF0000"]
    # Text values take code point order; a dict still finds each level.
    a = strip({"S1": "Low", "S2": "High", "S3": "Medium"}, cols)
    assert a["levels"] == ["High", "Low", "Medium"]
    assert a["colors"] == ["#FF0000", "#00AA00", "#FFA500"]
    # An unused category keeps its place in the legend, as in R.
    a = strip(risk.cat.add_categories("Unknown"))
    assert a["levels"] == ["Low", "Medium", "High", "Unknown"]
    # A list of colours goes to the levels in order.
    a = strip(risk, ["#111111", "#222222", "#333333"])
    assert a["colors"] == ["#111111", "#222222", "#333333"]
    msg = "annotation 'Risk' has no colour for level(s): Medium, High"
    with pytest.raises(ValueError, match=re.escape(msg)):
        strip(risk, {"Low": "#00AA00"})


def test_oncoplot_stops_on_a_missing_class_as_r_does():
    d = make_data()
    d["class"] = ["Missense", None, "Missense", "Amplification", "Missense"]
    with pytest.raises(ValueError, match="not present in `classes`: NA"):
        Oncoplot(d)


def test_oncoplot_keeps_a_missing_class_given_in_classes_as_r_does():
    # R: oncoplot(data.frame(gene = c("A", "B"), sample = c("s1", "s2"),
    # class = c("m", NA)), classes = c("m", NA)) sends classes ["m", null]
    # and codes [1, 0, 0, 2].
    w = Oncoplot({"gene": ["A", "B"], "sample": ["s1", "s2"],
                  "class": ["m", None]}, classes=["m", None])
    assert w.data["meta"]["classes"] == ["m", None]
    codes = np.frombuffer(w.buffer, dtype=np.float32, count=4)
    assert codes.tolist() == [1, 0, 0, 2]
