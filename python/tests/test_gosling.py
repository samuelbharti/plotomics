import pytest

from bioviz import Gosling


def test_gosling_passes_spec_through_verbatim():
    spec = {
        "title": "t",
        "tracks": [{"mark": "bar", "x": {"field": "start", "type": "genomic"}}],
    }
    w = Gosling(spec, padding=30, theme="dark")

    assert w.options["spec"] == spec
    assert w.options["padding"] == 30
    assert w.options["theme"] == "dark"
    # Gosling is spec-driven, so no columns are packed.
    assert w.data["columns"] == {}
    assert len(w.buffer) == 0


def test_gosling_omits_padding_and_theme_when_absent():
    w = Gosling({"tracks": []})
    assert "padding" not in w.options
    assert "theme" not in w.options


def test_gosling_copies_the_spec():
    spec = {"tracks": []}
    w = Gosling(spec)
    spec["tracks"].append("mutated")
    # The widget holds its own copy of the top-level mapping.
    assert w.options["spec"] is not spec


def test_gosling_validates_input():
    with pytest.raises(ValueError, match="must be a mapping"):
        Gosling("not a spec")
    with pytest.raises(ValueError, match="at least one of"):
        Gosling({"foo": 1})
