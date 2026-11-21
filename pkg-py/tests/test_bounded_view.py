"""bounded_view on the plots that pan and zoom: Volcano, Embedding, Network."""

import numpy as np
import pytest

from plotomics import Embedding, Network, Volcano

POINTS = {"x": [-1.0, 0.0, 1.0], "y": [0.5, 1.0, 2.0]}
NODES = {"id": ["a", "b"]}
EDGES = {"source": ["a"], "target": ["b"]}

MAKERS = {
    "Volcano": lambda **kw: Volcano(POINTS, **kw),
    "Embedding": lambda **kw: Embedding(POINTS, **kw),
    "Network": lambda **kw: Network(NODES, EDGES, **kw),
}


@pytest.mark.parametrize("name", sorted(MAKERS))
def test_bounded_view_is_on_by_default_and_always_sent(name):
    # Always sent, so an options dict that drops it builds the plot again
    # with the default, as for every other option.
    w = MAKERS[name]()
    assert w.options["boundedView"] is True


@pytest.mark.parametrize("name", sorted(MAKERS))
@pytest.mark.parametrize(
    "value", [False, np.bool_(False), np.array(False)], ids=["bool", "np", "0d"]
)
def test_bounded_view_false_is_sent_as_a_plain_bool(name, value):
    w = MAKERS[name](bounded_view=value)
    assert w.options["boundedView"] is False


@pytest.mark.parametrize("name", sorted(MAKERS))
@pytest.mark.parametrize(
    "value",
    [None, 1, 0, "no", "TRUE", [True], np.array([True, False]), np.nan],
)
def test_bounded_view_rejects_anything_but_one_bool(name, value):
    with pytest.raises(
        ValueError, match="`bounded_view` must be a single true or false value"
    ):
        MAKERS[name](bounded_view=value)
