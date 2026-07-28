"""plotomics: high-performance bioinformatics visualization widgets.

Each component is an anywidget backed by a shared JavaScript core, designed to
render large biological datasets smoothly in Jupyter, JupyterLab, marimo,
Colab, VS Code, Shiny for Python and Streamlit.

Add new components here, keeping the list sorted so parallel PRs append cleanly.
"""

from __future__ import annotations

from ._base import PlotomicsWidget, pack_columns
from .heatmap import Heatmap
from .gosling import Gosling
from .network import Network
from .clustermap import Clustermap
from .dotplot import Dotplot
from .hic import HiC
from .igv import IGV
from .km import Km
from .lollipop import Lollipop
from .oncoplot import Oncoplot
from .profile import Profile
from .spatial import Spatial
from .treemap import Treemap
from .upset import Upset
from .violin import Violin
from .volcano import Volcano
from .embedding import Embedding

__all__ = [
    "PlotomicsWidget",
    "pack_columns",
    "Heatmap",
    "Gosling",
    "Network",
    "Clustermap",
    "Dotplot",
    "HiC",
    "IGV",
    "Km",
    "Lollipop",
    "Oncoplot",
    "Profile",
    "Spatial",
    "Treemap",
    "Upset",
    "Violin",
    "Volcano",
    "Embedding",
]

__version__ = "0.1.0"
