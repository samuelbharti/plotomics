import warnings
from decimal import Decimal
from fractions import Fraction

import numpy as np
import pytest

from plotomics import Violin


def make_args():
    """Two features x two groups, each violin a distinct density row."""
    data = {
        "feature": ["CD3D", "CD3D", "MS4A1", "MS4A1"],
        "group": ["T", "B", "T", "B"],
    }
    grid = np.linspace(0.0, 3.0, 8)
    # Row i is filled with i + 1, so a mis-flattened row is obvious.
    density = np.array([[float(i + 1)] * 8 for i in range(4)], dtype=np.float32)
    return data, grid, density


def test_violin_flattens_density_row_major():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density)

    meta = w.data["meta"]
    assert len(meta["density"]) == 4 * 8
    # The component indexes density as violin * gridLen + k. Each violin must
    # read back exactly its own row: column-major flattening here would
    # interleave every violin with its neighbours, which looks plausible on
    # screen and is wrong.
    for i in range(4):
        assert meta["density"][i * 8:(i + 1) * 8] == [float(i + 1)] * 8


def test_violin_carries_key_columns_and_grid():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density)

    assert w.data["columns"]["feature"] == ["CD3D", "CD3D", "MS4A1", "MS4A1"]
    assert w.data["columns"]["group"] == ["T", "B", "T", "B"]
    assert len(w.data["meta"]["grid"]) == 8
    assert w.data["meta"]["grid"][0] == pytest.approx(0.0)
    assert w.data["meta"]["grid"][-1] == pytest.approx(3.0)


def test_violin_per_feature_grids_are_row_major():
    data, grid, density = make_args()
    # One row per feature, not per violin: CD3D spans 0-3, MS4A1 spans 0-9.
    grids = np.array([
        np.linspace(0.0, 3.0, 8),
        np.linspace(0.0, 9.0, 8),
    ], dtype=np.float32)
    w = Violin(data, grid=grid, density=density, grids=grids,
               features=["CD3D", "MS4A1"])

    flat = w.data["meta"]["grids"]
    assert len(flat) == 2 * 8
    # The second feature's range follows the first's.
    assert flat[8] == pytest.approx(0.0)
    assert flat[15] == pytest.approx(9.0)


def test_violin_grids_shape_is_validated():
    data, grid, density = make_args()
    good = np.zeros((2, 8), dtype=np.float32)

    with pytest.raises(ValueError, match="one column per `grid` entry"):
        Violin(data, grid=grid, density=density, grids=good[:, :4],
               features=["CD3D", "MS4A1"])
    with pytest.raises(ValueError, match="one row per feature"):
        Violin(data, grid=grid, density=density,
               grids=np.zeros((1, 8), dtype=np.float32),
               features=["CD3D", "MS4A1"])


def test_violin_takes_order_from_pandas_categorical():
    pd = pytest.importorskip("pandas")
    _, grid, density = make_args()
    df = pd.DataFrame({
        "feature": pd.Categorical(
            ["CD3D", "CD3D", "MS4A1", "MS4A1"], categories=["MS4A1", "CD3D"]
        ),
        "group": pd.Categorical(["T", "B", "T", "B"], categories=["B", "T"]),
    })
    w = Violin(df, grid=grid, density=density)
    assert w.data["meta"]["features"] == ["MS4A1", "CD3D"]
    assert w.data["meta"]["groups"] == ["B", "T"]


def test_violin_median_and_group_colors():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density, median=[1.0, 2.0, 3.0, 4.0],
               groups=["T", "B"], group_colors=["#f00", "#00f"])
    assert w.data["meta"]["median"] == [1.0, 2.0, 3.0, 4.0]
    assert w.data["meta"]["groupColors"] == ["#f00", "#00f"]


def test_violin_options_passthrough():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density, violin_width=0.5,
               scale_per_violin=True, show_median=False,
               show_feature_labels=False, theme={"background": "#000"})
    assert w.options["violinWidth"] == 0.5
    assert w.options["scalePerViolin"] is True
    assert w.options["showMedian"] is False
    assert w.options["showFeatureLabels"] is False
    assert w.options["theme"] == {"background": "#000"}


def test_violin_defaults():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density)
    assert w.options["violinWidth"] == 0.85
    assert w.options["scalePerViolin"] is False
    assert w.options["showMedian"] is True
    assert "theme" not in w.options


def test_violin_validates_its_input():
    data, grid, density = make_args()

    with pytest.raises(ValueError, match="missing column"):
        Violin({"feature": ["a"]}, grid=grid, density=density)
    with pytest.raises(ValueError, match="must be ascending"):
        Violin(data, grid=grid[::-1], density=density)
    with pytest.raises(ValueError, match="one row per violin"):
        Violin(data, grid=grid, density=density[:2])
    with pytest.raises(ValueError, match="one column per `grid` entry"):
        Violin(data, grid=grid[:4], density=density)
    with pytest.raises(ValueError, match="one entry per violin"):
        Violin(data, grid=grid, density=density, median=[1.0])
    with pytest.raises(ValueError, match=r"must be in \(0, 1\]"):
        Violin(data, grid=grid, density=density, violin_width=0)
    with pytest.raises(ValueError, match="not present in `features`"):
        Violin(data, grid=grid, density=density, features=["CD3D"])


def test_violin_group_colors_without_groups():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density, group_colors=["#111", "#222"])
    # Colours follow the groups in order of first appearance, as in R.
    assert w.data["meta"]["groups"] == ["T", "B"]
    assert w.data["meta"]["groupColors"] == ["#111", "#222"]


def test_violin_sends_the_value_axis_option():
    data, grid, density = make_args()
    w = Violin(data, grid=grid, density=density)
    assert w.options["showValueAxis"] is True
    w = Violin(data, grid=grid, density=density, show_value_axis=False)
    assert w.options["showValueAxis"] is False


def test_violin_sends_the_grid_without_float32_rounding():
    data, _, density = make_args()
    grid = np.linspace(0.0, 99.95, 8)
    w = Violin(data, grid=grid, density=density)
    assert w.data["meta"]["grid"][-1] == 99.95


def test_violin_aspect_passthrough_and_off():
    data, grid, density = make_args()
    assert Violin(data, grid=grid, density=density).options["violinAspect"] == 0.8
    w = Violin(data, grid=grid, density=density, violin_aspect=1.2)
    assert w.options["violinAspect"] == 1.2
    # The browser reads null as no cap. JSON has no infinity, so inf is sent
    # as null too.
    for off in (None, float("inf"), np.inf):
        w = Violin(data, grid=grid, density=density, violin_aspect=off)
        assert "violinAspect" in w.options
        assert w.options["violinAspect"] is None


def test_violin_aspect_is_checked():
    data, grid, density = make_args()
    for bad in (0, -1, float("nan"), True, "1", [1.0]):
        with pytest.raises(
            ValueError, match=r"`violin_aspect` must be a single positive number\."
        ):
            Violin(data, grid=grid, density=density, violin_aspect=bad)


def test_violin_aspect_takes_any_real_number():
    data, grid, density = make_args()
    for value in (
        np.array(1.2),
        np.float32(1.5),
        np.int64(2),
        Fraction(6, 5),
        Decimal("1.2"),
    ):
        w = Violin(data, grid=grid, density=density, violin_aspect=value)
        assert w.options["violinAspect"] == pytest.approx(float(value))
        assert type(w.options["violinAspect"]) is float
    w = Violin(data, grid=grid, density=density, violin_aspect=np.array(np.inf))
    assert w.options["violinAspect"] is None


def test_violin_aspect_rejects_complex_numbers():
    data, grid, density = make_args()
    for bad in (1 + 0j, np.complex128(1), np.array(1 + 0j), np.array(True)):
        # Rejected before any conversion, so numpy warns about nothing.
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with pytest.raises(ValueError, match="must be a single positive number"):
                Violin(data, grid=grid, density=density, violin_aspect=bad)
