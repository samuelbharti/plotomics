"""bioviz: high-performance bioinformatics visualization widgets.

Each component is an anywidget backed by a shared JavaScript core, designed to
render large biological datasets smoothly in Jupyter, JupyterLab, marimo,
Colab, VS Code, Shiny for Python and Streamlit.

Add new components here, keeping the list sorted so parallel PRs append cleanly.
"""

from __future__ import annotations

from ._base import BiovizWidget, pack_columns
from .heatmap import Heatmap
from .gosling import Gosling
from .network import Network
from .clustermap import Clustermap
from .hic import HiC
from .igv import IGV
from .treemap import Treemap
from .volcano import Volcano
from .embedding import Embedding

__all__ = [
    "BiovizWidget",
    "pack_columns",
    "Heatmap",
    "Gosling",
    "Network",
    "Clustermap",
    "HiC",
    "IGV",
    "Treemap",
    "Volcano",
    "Embedding",
]

__version__ = "0.0.0"
