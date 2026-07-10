import numpy as np
import pytest

from plotomics import Heatmap


def test_heatmap_packs_row_major_float32():
    m = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], dtype=np.float64)
    w = Heatmap(m, colormap="rdbu", z_score=True, show_colorbar=False)

    assert w.data["meta"]["nrows"] == 2
    assert w.data["meta"]["ncols"] == 3
    assert w.options["colormap"] == "rdbu"
    assert w.options["zScore"] is True
    assert w.options["showColorbar"] is False

    # One float32 column named "values" of length nrows * ncols, row-major.
    specs = {c["name"]: c for c in w.schema["columns"]}
    assert specs["values"]["dtype"] == "float32"
    assert specs["values"]["length"] == 6
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed.tolist() == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]


def test_heatmap_reads_dataframe_labels():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame(
        [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]],
        index=["g1", "g2", "g3"],
        columns=["s1", "s2"],
    )
    w = Heatmap(df)
    assert w.data["meta"]["rowLabels"] == ["g1", "g2", "g3"]
    assert w.data["meta"]["colLabels"] == ["s1", "s2"]
    assert w.data["meta"]["nrows"] == 3
    assert w.data["meta"]["ncols"] == 2
    packed = np.frombuffer(w.buffer, dtype=np.float32)
    assert packed.tolist() == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]


def test_heatmap_explicit_labels_override_and_validate():
    m = np.zeros((2, 2), dtype=np.float32)
    w = Heatmap(m, row_labels=["a", "b"], col_labels=["x", "y"])
    assert w.data["meta"]["rowLabels"] == ["a", "b"]
    assert w.data["meta"]["colLabels"] == ["x", "y"]

    with pytest.raises(ValueError, match="row_labels"):
        Heatmap(m, row_labels=["only-one"])
    with pytest.raises(ValueError, match="col_labels"):
        Heatmap(m, col_labels=["x", "y", "z"])


def test_heatmap_vmin_vmax_passthrough():
    m = np.zeros((3, 3), dtype=np.float32)
    w = Heatmap(m, vmin=-2.0, vmax=2.0)
    assert w.options["vmin"] == -2.0
    assert w.options["vmax"] == 2.0
    # Auto-scale by default (None).
    w2 = Heatmap(m)
    assert w2.options["vmin"] is None
    assert w2.options["vmax"] is None


def test_heatmap_rejects_non_2d_and_bad_colormap():
    with pytest.raises(ValueError, match="2-D"):
        Heatmap(np.arange(5, dtype=np.float32))
    with pytest.raises(ValueError, match="colormap"):
        Heatmap(np.zeros((2, 2), dtype=np.float32), colormap="plasma")


def test_heatmap_omits_labels_when_absent():
    w = Heatmap(np.zeros((2, 2), dtype=np.float32))
    assert "rowLabels" not in w.data["meta"]
    assert "colLabels" not in w.data["meta"]


def test_heatmap_theme_in_options():
    w = Heatmap(np.zeros((2, 2), dtype=np.float32), theme={"background": "#000"})
    assert w.options["theme"] == {"background": "#000"}


def test_heatmap_rejects_empty_matrix():
    with pytest.raises(ValueError, match="at least one row"):
        Heatmap(np.zeros((0, 5), dtype=np.float32))
