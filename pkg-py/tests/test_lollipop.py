import numpy as np
import pytest

from plotomics import Lollipop


def make_data():
    return {
        "position": [175, 248, 273, 282],
        "count": [21, 15, 13, 4],
        "class": ["Missense", "Missense", "Missense", "Truncating"],
        "label": ["R175H", "R248Q", "R273H", "R282W"],
    }


def test_lollipop_packs_position_and_count():
    w = Lollipop(make_data(), length=393)
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["position"]["dtype"] == "float32"
    assert specs["count"]["dtype"] == "float32"
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed[:4].tolist() == [175.0, 248.0, 273.0, 282.0]
    assert w.data["meta"]["length"] == 393.0


def test_lollipop_carries_identifiers_and_columns():
    w = Lollipop(make_data(), length=393, gene="TP53", uniprot="P04637")
    assert w.data["meta"]["gene"] == "TP53"
    assert w.data["meta"]["uniprot"] == "P04637"
    assert w.data["columns"]["label"][0] == "R175H"
    assert w.data["columns"]["class"][-1] == "Truncating"


def test_lollipop_resolves_labelled_stems_server_side():
    w = Lollipop(make_data(), length=393, label_top_n=2)
    # The two most recurrent variants are at indices 0 (21) and 1 (15).
    # Resolving this here rather than in the renderer is what keeps a redraw,
    # an export and any static counterpart labelling the same stems.
    assert w.data["meta"]["labelIndex"] == [0, 1]


def test_lollipop_label_index_is_sorted_not_rank_ordered():
    d = dict(make_data())
    d["count"] = [4, 21, 13, 15]  # most recurrent is now index 1
    w = Lollipop(d, length=393, label_top_n=2)
    # Indices come back ascending so the renderer can walk stems in order.
    assert w.data["meta"]["labelIndex"] == [1, 3]


def test_lollipop_omits_label_index_without_labels():
    d = make_data()
    del d["label"]
    w = Lollipop(d, length=393)
    assert "labelIndex" not in w.data["meta"]
    assert "label" not in w.data["columns"]


def test_lollipop_classes_default_to_most_frequent_first():
    w = Lollipop(make_data(), length=393)
    assert w.data["meta"]["classes"][0] == "Missense"


def test_lollipop_domains_and_ptms():
    w = Lollipop(
        make_data(), length=393,
        domains=[{"name": "P53 DNA-binding", "start": 100, "end": 288}],
        ptms=[{"position": 15, "type": "phosphorylation"}],
        domain_colors=["#abc"],
    )
    meta = w.data["meta"]
    assert meta["domains"] == [
        {"name": "P53 DNA-binding", "start": 100.0, "end": 288.0}
    ]
    assert meta["ptms"] == [{"position": 15.0, "type": "phosphorylation"}]
    assert meta["domainColors"] == ["#abc"]


def test_lollipop_options_passthrough():
    w = Lollipop(make_data(), length=393, show_ptms=False, show_domains=False,
                 show_legend=False, theme={"background": "#000"})
    assert w.options["showPtms"] is False
    assert w.options["showDomains"] is False
    assert w.options["showLegend"] is False
    assert w.options["theme"] == {"background": "#000"}


def test_lollipop_validates_its_input():
    d = make_data()

    with pytest.raises(ValueError, match="`position` and `count`"):
        Lollipop({"position": [1]}, length=393)
    with pytest.raises(ValueError, match="positive protein length"):
        Lollipop(d, length=0)
    with pytest.raises(ValueError, match="at least one row"):
        Lollipop({"position": [], "count": []}, length=393)
    # A position past the C-terminus means the protein or the variants are
    # from a different isoform.
    with pytest.raises(ValueError, match=r"within 1\.\.length"):
        Lollipop(d, length=200)
    with pytest.raises(ValueError, match="not present in `classes`"):
        Lollipop(d, length=393, classes=["Missense"])
    with pytest.raises(ValueError, match="one entry per class"):
        Lollipop(d, length=393, classes=["Missense", "Truncating"],
                 class_colors=["#f00"])


def test_lollipop_forwards_head_size_label_and_colour_options():
    d = Lollipop(make_data(), length=393)
    assert d.options["minHeadRadius"] == 3
    assert d.options["maxHeadRadius"] == 11
    assert d.options["yLabel"] == "samples"
    assert d.options["backboneColor"] == "#E6DCC8"
    assert d.options["stemColor"] == "#93a1b8"

    w = Lollipop(make_data(), length=393, min_head_radius=1, max_head_radius=30,
                 y_label="patients", backbone_color="#111111",
                 stem_color="#222222")
    assert w.options["minHeadRadius"] == 1
    assert w.options["maxHeadRadius"] == 30
    assert w.options["yLabel"] == "patients"
    assert w.options["backboneColor"] == "#111111"
    assert w.options["stemColor"] == "#222222"
