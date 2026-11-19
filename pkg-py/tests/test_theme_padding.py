import re

import numpy as np
import pytest

from plotomics import Gosling, Heatmap, Volcano

# The theme padding: the space in px between the edge of the widget and the
# plot. R checks it with the same error (tests/testthat/test-utils.R).

ERROR = re.escape(
    "theme['padding'] must be a number of 0 or more, or a dict of them "
    "with keys from top, right, bottom and left."
)


def volcano(theme):
    return Volcano({"x": [1.0, 2.0], "y": [1.0, 2.0]}, theme=theme)


def test_a_number_sets_every_side():
    assert volcano({"padding": 16}).options["theme"]["padding"] == 16
    assert volcano({"padding": 0}).options["theme"]["padding"] == 0
    assert volcano({"padding": np.int64(12)}).options["theme"]["padding"] == 12
    w = Heatmap(np.eye(2), theme={"padding": 2.5, "fontSize": 14})
    assert w.options["theme"] == {"padding": 2.5, "fontSize": 14}


def test_a_dict_sets_each_side_it_names():
    sides = {"top": 4, "right": 16, "bottom": 4, "left": 16}
    assert volcano({"padding": sides}).options["theme"]["padding"] == sides
    one = volcano({"padding": {"left": np.float32(30)}})
    assert one.options["theme"]["padding"] == {"left": 30}


def test_none_sends_no_padding():
    assert volcano({"padding": None}).options["theme"] == {}
    assert "padding" not in volcano({"fontSize": 14}).options["theme"]


@pytest.mark.parametrize(
    "bad",
    [
        -1,
        float("nan"),
        float("inf"),
        "16",
        [4, 16],
        True,
        {},
        {"top": -1},
        {"top": float("nan")},
        {"top": "4"},
        {"middle": 4},
        {"top": None},
    ],
)
def test_a_bad_padding_raises_the_error_r_raises(bad):
    with pytest.raises(ValueError, match=ERROR):
        volcano({"padding": bad})


def test_new_options_are_checked_too():
    w = volcano({"padding": 8})
    w.options = {"theme": {"padding": {"left": 20}}}
    assert w.options["theme"]["padding"] == {"left": 20}
    with pytest.raises(ValueError, match=ERROR):
        w.options = {"theme": {"padding": -3}}


def test_a_gosling_theme_is_left_as_it_is():
    spec = {"tracks": [{"mark": "bar"}]}
    theme = {"base": "light", "padding": "not a plotomics padding"}
    assert Gosling(spec, theme=theme).options["theme"] == theme
