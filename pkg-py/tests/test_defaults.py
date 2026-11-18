import inspect

import plotomics

# The same table is in the R tests (test-utils.R).
HEIGHTS = {
    "Clustermap": 560,
    "Dotplot": 560,
    "Embedding": 480,
    "Heatmap": 480,
    "HiC": 480,
    "Km": 520,
    "Lollipop": 440,
    "Network": 480,
    "Oncoplot": 560,
    "Profile": 380,
    "Spatial": 560,
    "Treemap": 480,
    "Upset": 520,
    "Violin": 560,
    "Volcano": 480,
}


def test_each_plot_has_the_default_height_r_uses():
    for name, height in HEIGHTS.items():
        init = getattr(plotomics, name).__init__
        assert inspect.signature(init).parameters["height"].default == height, name
