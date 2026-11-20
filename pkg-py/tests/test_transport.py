import warnings

import numpy as np
import pytest

from plotomics import (
    Clustermap,
    Heatmap,
    HiC,
    Oncoplot,
    Spatial,
    Volcano,
    pack_columns,
    upset_intersections,
)

# (numpy dtype, values, transport dtype, dtype the browser reads)
BIG_ENDIAN = [
    (">f8", [1.0, 2.5, -3.0], "float64", "<f8"),
    (">f4", [1.0, 2.5, -3.0], "float32", "<f4"),
    (">i4", [1, 2, -3], "int32", "<i4"),
    (">i2", [1, 2, -3], "int16", "<i2"),
    (">u2", [1, 2, 3], "uint16", "<u2"),
    (">i8", [1, 2, -3], "int32", "<i4"),
]


@pytest.mark.parametrize("dtype,values,sent,read_as", BIG_ENDIAN)
def test_pack_columns_sends_a_big_endian_array_little_endian(
    dtype, values, sent, read_as
):
    # h5py and FITS files give big-endian arrays; the browser reads the
    # bytes little-endian.
    buf, schema = pack_columns({"x": np.array(values, dtype=dtype)})
    assert schema["columns"][0]["dtype"] == sent
    assert np.frombuffer(buf, dtype=read_as).tolist() == values


def test_pack_columns_keeps_a_little_endian_array_as_is():
    arr = np.array([1.0, 2.0], dtype="<f8")
    buf, _ = pack_columns({"x": arr})
    assert buf == arr.tobytes()


def test_a_polars_lazyframe_asks_for_collect():
    pl = pytest.importorskip("polars")
    lazy = pl.DataFrame({"x": [1.0], "y": [2.0]}).lazy()
    # Reading a LazyFrame's columns warns in polars; nothing should.
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        with pytest.raises(ValueError, match=r"call `\.collect\(\)`"):
            Volcano(lazy)
        with pytest.raises(ValueError, match=r"call `\.collect\(\)`"):
            Heatmap(pl.DataFrame({"a": [1.0], "b": [2.0]}).lazy())
        with pytest.raises(ValueError, match=r"call `\.collect\(\)`"):
            upset_intersections(pl.DataFrame({"A": [True]}).lazy())
    # Collected, the same frame works.
    w = Volcano(lazy.collect())
    assert {c["name"] for c in w.schema["columns"]} == {"x", "y"}


def test_missing_or_infinite_values_are_counted_in_the_words_r_uses():
    # Before the fix this read "column 'x' contains 30 non-finite value(s)
    # (NaN/Inf)", and R said "`x` has 30 non-finite value(s) (NaN/Inf).".
    arr = np.array([np.nan] * 30 + [1.0, 2.0], dtype=np.float32)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        pack_columns({"x": arr})
    assert [str(w.message) for w in caught] == [
        "`x` has 30 value(s) that are missing (NA or NaN) or infinite "
        "(Inf or -Inf)."
    ]
    arr = np.array([np.nan, np.inf, -np.inf, 1.0], dtype=np.float32)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        pack_columns({"x": arr})
    assert [str(w.message) for w in caught] == [
        "`x` has 3 value(s) that are missing (NA or NaN) or infinite "
        "(Inf or -Inf)."
    ]


def test_the_warning_names_the_argument_the_user_passed():
    # Before the fix Heatmap, Clustermap and HiC named their `matrix` by the
    # packed column, `values`, and Oncoplot named `burden` `tmb`. R names
    # its own arguments: `mat` and `burden`.
    def warned(build):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            build()
        return [str(w.message) for w in caught if "missing" in str(w.message)]

    text = "value(s) that are missing (NA or NaN) or infinite (Inf or -Inf)."
    nan = np.nan
    assert warned(lambda: Heatmap(np.array([[1.0, nan], [2.0, 3.0]]))) == [
        f"`matrix` has 1 {text}"
    ]
    square = np.array([[1.0, nan, 2.0], [2.0, 3.0, 1.0], [4.0, 1.0, 0.5]])
    assert warned(lambda: Clustermap(square)) == [f"`matrix` has 1 {text}"]
    assert warned(lambda: HiC(np.array([[1.0, nan], [nan, 3.0]]))) == [
        f"`matrix` has 2 {text}"
    ]
    alterations = {
        "gene": ["TP53", "KRAS"],
        "sample": ["s1", "s2"],
        "class": ["Missense", "Missense"],
    }
    assert warned(lambda: Oncoplot(alterations, burden=[1.0, nan])) == [
        f"`burden` has 1 {text}"
    ]
    # A numeric spot colour on a ramp is warned about, as in R; numbers read
    # as categories key a missing one "NA".
    image = {"image": "tissue.png", "img_width": 600, "img_height": 600}
    spots = {"x": [1.0, 2.0], "y": [1.0, 2.0], "color": [1.0, nan]}
    assert warned(lambda: Spatial(spots, **image)) == [f"`color` has 1 {text}"]
    assert warned(lambda: Spatial(spots, color_mode="categorical", **image)) == []
