import math

import numpy as np
import pytest

from plotomics import HiC


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


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"i": [0, None], "j": [1, 1], "v": [1.0, 2.0]}, "`i` has 1 missing"),
        ({"i": [0.0, math.nan], "j": [1, 1], "v": [1.0, 2.0], "n": 3},
         "`i` has 1 missing"),
        ({"i": [0, 1, 2], "j": [math.nan, math.inf, 1], "v": [1.0, 2.0, 3.0],
          "n": 3}, "`j` has 2 missing"),
    ],
)
def test_hic_names_a_sparse_index_column_with_a_missing_value_as_r_does(
    kwargs, message
):
    # Before the fix None stopped as "`i` must be numeric" and NaN became
    # -2147483648, out of range.
    with pytest.raises(ValueError) as err:
        HiC(**kwargs)
    assert str(err.value).startswith(message)
    assert str(err.value).endswith(
        "missing or infinite value(s); every contact needs an `i` and a "
        "`j` index."
    )


def test_hic_names_a_missing_index_in_a_data_frame():
    pd = pytest.importorskip("pandas")
    d = pd.DataFrame({"i": [0, np.nan], "j": [1, 1], "v": [1.0, 2.0]})
    with pytest.raises(ValueError, match="`i` has 1 missing or infinite"):
        HiC(d)


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


def test_hic_reads_a_3x3_nested_list_as_dense():
    w = HiC([[1, 2, 3], [4, 5, 6], [7, 8, 9]])

    assert w.data["meta"]["n"] == 3
    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"values"}
    vals = np.frombuffer(w.buffer, dtype=np.float32)
    assert vals.tolist() == [1, 2, 3, 4, 5, 6, 7, 8, 9]


def test_hic_reads_a_list_of_three_sequences_as_a_triplet():
    w = HiC([[0, 1], [1, 2], [5.0, 3.0]], n=3)

    names = {c["name"] for c in w.schema["columns"]}
    assert names == {"i", "j", "v"}


def test_hic_accepts_rdbu_and_rejects_unknown_colormaps():
    m = np.eye(4)
    assert HiC(m, colormap="rdbu").options["colormap"] == "rdbu"
    with pytest.raises(ValueError, match="colormap"):
        HiC(m, colormap="magma")


@pytest.mark.parametrize("colormap", ["viridis", "rdbu", "ltc", "ltcdiv"])
def test_hic_accepts_every_colormap_the_browser_draws(colormap):
    assert HiC(np.eye(4), colormap=colormap).options["colormap"] == colormap


NUMBER = "must be a single finite number"


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"vmin": "a"}, f"`vmin` {NUMBER}"),
        ({"vmin": float("nan")}, f"`vmin` {NUMBER}"),
        ({"vmin": -math.inf}, f"`vmin` {NUMBER}"),
        ({"vmax": [1, 2]}, f"`vmax` {NUMBER}"),
        ({"vmax": float("nan")}, f"`vmax` {NUMBER}"),
        ({"vmax": math.inf}, f"`vmax` {NUMBER}"),
        ({"vmax": "3"}, f"`vmax` {NUMBER}"),
        ({"vmax": True}, f"`vmax` {NUMBER}"),
        ({"vmax": -5}, "`vmax` must be greater than `vmin`"),
        (
            {"vmin": 2, "vmax": 2, "transform": "linear"},
            "`vmax` must be greater than `vmin`",
        ),
        ({"vmin": -3, "vmax": -1}, "`vmax` must be greater than 0 with the log"),
        ({"vmax_percentile": 99}, r"`vmax_percentile` must be in \(0, 1\]"),
        ({"vmax_percentile": -1}, r"`vmax_percentile` must be in \(0, 1\]"),
        ({"vmax_percentile": 0}, r"`vmax_percentile` must be in \(0, 1\]"),
        (
            {"vmax_percentile": float("nan")},
            r"`vmax_percentile` must be in \(0, 1\]",
        ),
        ({"vmax_percentile": "0.9"}, r"`vmax_percentile` must be in \(0, 1\]"),
        ({"bin_size": -5}, "`bin_size` must be a single positive number"),
        ({"bin_size": 0}, "`bin_size` must be a single positive number"),
        ({"bin_size": float("nan")}, "`bin_size` must be a single positive number"),
        ({"bin_size": "a"}, "`bin_size` must be a single positive number"),
        ({"symmetric": "no"}, "`symmetric` must be a single true or false value"),
        ({"symmetric": None}, "`symmetric` must be a single true or false value"),
        ({"symmetric": 1}, "`symmetric` must be a single true or false value"),
    ],
)
def test_hic_checks_its_numeric_arguments(kwargs, message):
    m = np.random.rand(2, 2)
    with pytest.raises(ValueError, match=message):
        HiC(m, **kwargs)


def test_hic_keeps_the_numeric_arguments_it_is_given():
    m = np.random.rand(2, 2)
    w = HiC(
        m,
        bin_size=np.int64(5000),
        vmin=-2,
        vmax=np.float32(3),
        vmax_percentile=1,
        transform="linear",
        symmetric=np.bool_(False),
    )
    assert w.data["meta"]["binSize"] == 5000.0
    assert w.options["vmin"] == -2.0
    assert w.options["vmax"] == 3.0
    assert w.options["vmaxPercentile"] == 1.0
    assert w.options["symmetric"] is False
    # Below 0 with the log transform, vmin acts as 0.
    assert HiC(m, vmin=-3, vmax=1).options["vmax"] == 1.0


def test_hic_reads_none_as_an_unset_numeric_argument():
    w = HiC(
        np.random.rand(2, 2),
        bin_size=None,
        vmin=None,
        vmax=None,
        vmax_percentile=None,
    )
    assert "binSize" not in w.data["meta"]
    for key in ("vmin", "vmax", "vmaxPercentile"):
        assert key not in w.options


def test_hic_takes_a_0d_array_as_one_value():
    m = np.random.rand(2, 2)
    w = HiC(
        m,
        bin_size=np.array(5000),
        vmin=np.array(1.0),
        vmax=np.array(2.0),
        vmax_percentile=np.array(0.9),
        transform="linear",
        symmetric=np.array(False),
    )
    assert w.data["meta"]["binSize"] == 5000.0
    assert w.options["vmin"] == 1.0
    assert w.options["vmax"] == 2.0
    assert w.options["vmaxPercentile"] == 0.9
    assert w.options["symmetric"] is False
    with pytest.raises(ValueError, match="`vmax` must be a single finite number"):
        HiC(m, vmax=np.array([2.0]))
