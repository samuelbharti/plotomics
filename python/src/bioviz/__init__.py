"""bioviz: high-performance bioinformatics visualization widgets.

Each component is an anywidget backed by a shared JavaScript core, designed to
render large biological datasets smoothly in Jupyter, JupyterLab, marimo,
Colab, VS Code, Shiny for Python and Streamlit.

Add new components here, keeping the list sorted so parallel PRs append cleanly.
"""

from __future__ import annotations

from ._base import BiovizWidget, pack_columns
from .volcano import Volcano

__all__ = [
    "BiovizWidget",
    "pack_columns",
    "Volcano",
]

__version__ = "0.0.0"
