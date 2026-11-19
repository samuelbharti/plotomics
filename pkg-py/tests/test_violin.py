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


def test_violin_sends_missing_text_and_a_missing_median_as_null():
    w = Violin({"feature": ["A", None], "group": [float("nan"), "g"]},
               grid=[0.0, 1.0], density=[[0.0, 1.0], [1.0, 0.0]],
               median=[0.5, float("nan")])
    assert w.data["columns"]["feature"] == ["A", None]
    assert w.data["columns"]["group"] == [None, "g"]
    assert w.data["meta"]["median"] == [0.5, None]


# R: violin_density(vals, n = 16) for the same values.
R_VALUES = {
    "CD3D|T": [2.1, 2.5, 1.9, 3.2, 2.8, 0.4, 2.2, float("nan"), 2.9, 3.5],
    "CD3D|B": [0.1, 0.0, 0.3, 0.2, 1.1, 0.0, 0.05],
    "MS4A1": [5, 5, 5],
    "MS4A1|T": [1.5, float("inf")],
    "GNLY|NK": [-1, 4.25, 3, 3.5, 2, 2.75, 3.1, 6],
}
R_GRID = [
    -1, -0.53333333333333333, -0.066666666666666652, 0.39999999999999991,
    0.8666666666666667, 1.3333333333333335, 1.7999999999999998,
    2.2666666666666666, 2.7333333333333334, 3.2000000000000002,
    3.666666666666667, 4.1333333333333337, 4.5999999999999996,
    5.0666666666666664, 5.5333333333333332, 6,
]
R_DENSITY = [
    [3.6468907220846255e-05, 0.0033953648053097508, 0.051646680974473419,
     0.127947741629062, 0.053438127771994706, 0.05410351440933537,
     0.29589540735034242, 0.48142861725618324, 0.47451205719778022,
     0.38910634534302641, 0.18273411658071728, 0.027743929731616719,
     0.00086490112327698015, 4.697975716866409e-06, 4.2294565662463708e-09,
     6.3155874470317164e-13],
    [0, 1.6253499295898878e-06, 1.3595030488487825, 0.43915158973532176,
     0.041857144575880287, 0.041873031161521947, 4.4405561112046843e-11,
     0, 0, 0, 8.8840635559093477e-18, 0, 0, 0, 0, 0],
    [0.0] * 16,
    [0.0] * 16,
    [0.099997595124752647, 0.064540982280875153, 0.017368327084068488,
     0.0025257851696315371, 0.0077460170227721383, 0.043258617376529279,
     0.11773142161217007, 0.21259815313910471, 0.32849745756782711,
     0.35673168076796141, 0.25721869738591507, 0.16342512448203608,
     0.0906567094179654, 0.044283180930164617, 0.068212403614040615,
     0.10020953088253004],
]


def test_violin_density_matches_r():
    from plotomics import violin_density

    d = violin_density(R_VALUES, n=16)
    np.testing.assert_allclose(d["grid"], R_GRID, rtol=1e-12)
    # The two FFTs round differently, by about 1e-17 in the tails.
    np.testing.assert_allclose(d["density"], R_DENSITY, rtol=1e-9, atol=1e-12)
    np.testing.assert_allclose(d["median"], [2.5, 0.1, 5, 1.5, 3.05])
    assert d["data"] == {
        "feature": ["CD3D", "CD3D", "MS4A1", "MS4A1", "GNLY"],
        "group": ["T", "B", "", "T", "NK"],
    }
    # R: violin_density(vals["GNLY|NK"], adjust = 0.5), points 1, 9, 17,
    # 33, 50 and 64 of the default 64.
    d = violin_density({"GNLY|NK": R_VALUES["GNLY|NK"]}, adjust=0.5)
    np.testing.assert_allclose(
        d["density"][0, [0, 8, 16, 32, 49, 63]],
        [0.19984022102693383, 0.00034987411797816041, 1.2228143011338844e-06,
         0.22378627516081198, 0.14772196255308317, 0.19984022103102256],
        rtol=1e-9, atol=1e-12,
    )


def test_violin_density_feeds_violin():
    from plotomics import violin_density

    d = violin_density({"A|x": [1.0, 2.0, 2.5], "A|y": [float("nan")]})
    w = Violin(d["data"], grid=d["grid"], density=d["density"],
               median=d["median"])
    assert w.data["meta"]["median"] == [2.0, None]
    assert len(w.data["meta"]["density"]) == 2 * 64


def test_violin_density_checks_its_input():
    from plotomics import violin_density

    with pytest.raises(ValueError, match="named list"):
        violin_density({})
    with pytest.raises(ValueError, match="no finite numbers"):
        violin_density({"A": [float("nan")]})
