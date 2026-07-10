import numpy as np
import pytest

from bioviz import HiC


def test_hic_dense_matrix_packs_row_major():
    m = np.array([[0, 1, 2], [1, 0, 3], [2, 3, 0]], dtype=np.float64)
    w = HiC(m, bin_size=10_000, chrom="chr1", transform="linear")

    assert w.data["meta"]["n"] == 3
    assert w.data["meta"]["binSize"] == 10_000
    assert w.data["meta"]["chrom"] == "chr1"
    assert w.options["transform"] == "linear"
    assert w.options["colormap"] == "viridis"
    assert w.options["symmetric"] is True
    # one float32 column "values" of length n*n, row-major.
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"values"}
    vals = np.frombuffer(w.buffer, dtype=np.float32)
    assert vals.tolist() == m.reshape(-1).tolist()


def test_hic_sparse_triplet_tuple():
    i = np.array([0, 0, 1])
    j = np.array([0, 1, 2])
    v = np.array([5.0, 7.0, 9.0])
    w = HiC((i, j, v), n=3)

    assert w.data["meta"]["n"] == 3
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"i", "j", "v"}
    # i/j packed as int32, v as float32.
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["i"]["dtype"] == "int32"
    assert specs["v"]["dtype"] == "float32"


def test_hic_sparse_mapping_and_kwargs():
    trip = {"i": [0, 2], "j": [1, 2], "v": [1.0, 2.0]}
    w = HiC(trip)
    assert w.data["meta"]["n"] == 3  # max index 2 -> n = 3

    w2 = HiC(i=[0, 4], j=[1, 1], v=[3.0, 4.0])
    assert w2.data["meta"]["n"] == 5  # max index 4 -> n = 5


def test_hic_only_sends_vmax_when_fixed():
    m = np.random.rand(4, 4).astype(np.float32)
    assert "vmax" not in HiC(m).options
    assert HiC(m, vmax=42).options["vmax"] == 42.0


def test_hic_requires_square_dense_matrix():
    with pytest.raises(ValueError, match="square"):
        HiC(np.zeros((2, 3)))


def test_hic_requires_some_input():
    with pytest.raises(ValueError, match="dense .* or a sparse"):
        HiC()


def test_hic_rejects_empty_triplet():
    with pytest.raises(ValueError, match="empty"):
        HiC(i=[], j=[], v=[], n=4)


def test_hic_rejects_mismatched_triplet_lengths():
    with pytest.raises(ValueError, match="same length"):
        HiC(i=[0, 1], j=[0], v=[1.0, 2.0], n=3)


def test_hic_rejects_out_of_range_index():
    # index 5 is outside [0, 3)
    with pytest.raises(ValueError, match=r"in \[0, 3\)"):
        HiC(i=[0, 5], j=[1, 2], v=[1.0, 2.0], n=3)


def test_hic_rejects_negative_index():
    with pytest.raises(ValueError, match=r"in \[0, 3\)"):
        HiC(i=[0, -1], j=[1, 2], v=[1.0, 2.0], n=3)


def test_hic_rejects_empty_dense_matrix():
    with pytest.raises(ValueError, match="at least one row"):
        HiC(np.zeros((0, 0)))


def test_hic_vmax_percentile_in_options():
    m = np.random.rand(4, 4).astype(np.float32)
    assert "vmaxPercentile" not in HiC(m).options
    assert HiC(m, vmax_percentile=0.95).options["vmaxPercentile"] == 0.95


def test_hic_theme_in_options():
    m = np.random.rand(3, 3).astype(np.float32)
    assert HiC(m, theme={"background": "#000"}).options["theme"] == {"background": "#000"}


def test_hic_rejects_non_numeric_triplet():
    with pytest.raises(ValueError, match="must be numeric"):
        HiC(i=[0, 1], j=[1, 2], v=["a", "b"], n=3)


def test_hic_rejects_non_numeric_matrix():
    with pytest.raises(ValueError, match="must be numeric"):
        HiC(np.array([["a", "b"], ["c", "d"]]))
