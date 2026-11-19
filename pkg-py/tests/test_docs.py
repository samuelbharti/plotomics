"""Checks on the docs: the README, the docstring examples and the reference."""

import ast
import doctest
import re
import sys
import types
from importlib.metadata import requires
from pathlib import Path

import pytest

import plotomics

README = Path(__file__).resolve().parents[1] / "README.md"


def _code_blocks(text: str, lang: str) -> list[str]:
    return re.findall(rf"```{lang}\n(.*?)```", text, flags=re.DOTALL)


def test_readme_names_classes_not_modules():
    # `igv()` and `gosling()` name modules in Python; calling one raises
    # TypeError. The README names the classes.
    text = README.read_text(encoding="utf-8")
    for name in sorted(set(re.findall(r"`([A-Za-z_]\w*)(?:\(\))?`", text))):
        obj = getattr(plotomics, name, None)
        assert not isinstance(obj, types.ModuleType), (
            f"the README names `{name}`, which is a module of plotomics"
        )


def test_readme_installs_what_its_code_imports():
    text = README.read_text(encoding="utf-8")
    shipped = {"plotomics"}
    for req in requires("plotomics") or []:
        if "extra ==" not in req:
            shipped.add(re.split(r"[\s;<>=!~\[]", req, maxsplit=1)[0].lower())
    installed = set()
    for line in re.findall(r"pip install ([^\n`]+)", text):
        installed |= {w.lower() for w in line.split() if not w.startswith("-")}
    imported = set()
    for block in _code_blocks(text, "python"):
        for node in ast.walk(ast.parse(block)):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
    missing = sorted(
        m
        for m in imported - set(sys.stdlib_module_names)
        if m.lower() not in shipped | installed
    )
    assert missing == [], f"the README imports {missing} but never installs them"


def test_spatial_example_builds_its_own_image():
    # The example used to point at tissue.png, which no one has, so the
    # browser fetched a missing file and drew a blank background.
    finder = doctest.DocTestFinder(recurse=False)
    (test,) = finder.find(
        plotomics.Spatial, "Spatial", globs={"Spatial": plotomics.Spatial}
    )
    result = doctest.DocTestRunner().run(test, clear_globs=False)
    assert result.failed == 0
    widget = test.globs.get("w")
    assert isinstance(widget, plotomics.Spatial), "the example builds no widget"
    assert widget.data["meta"]["image"].startswith("data:image/svg+xml,")


def test_reference_links_resolve():
    # Every link inside the pdoc page goes to an anchor on the page: a link
    # to an inherited member, or to a name in an inherited docstring, has
    # none.
    pytest.importorskip("pdoc")
    import pdoc
    import pdoc.render

    pdoc.render.configure(docformat="numpy")
    html = pdoc.pdoc("plotomics")
    anchors = set(re.findall(r'\bid="([^"]+)"', html))
    links = set(re.findall(r'href="#([^"]+)"', html))
    assert sorted(links - anchors) == []
