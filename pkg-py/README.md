# plotomics (Python)

High-performance bioinformatics visualization widgets backed by a shared
JavaScript core, exposed to Python through [anywidget](https://anywidget.dev).

Works in Jupyter, JupyterLab, marimo, Google Colab, VS Code, Shiny for Python
and Streamlit. Large numeric columns are shipped to the browser as a single
binary buffer (not JSON), so millions of points stay interactive.

```python
import numpy as np, pandas as pd
from plotomics import Volcano

n = 200_000
df = pd.DataFrame({
    "x": np.random.randn(n),                 # log2 fold change
    "y": np.abs(np.random.randn(n)) * 3,     # -log10 p-value
    "label": [f"GENE{i}" for i in range(n)],
})
Volcano(df, fc_threshold=1.0, p_threshold=0.05)
```

## Install

```bash
pip install plotomics
```

### Shiny for Python

The widgets are anywidgets, so they render in Shiny for Python through
[`shinywidgets`](https://github.com/posit-dev/py-shinywidgets): `output_widget`
in the UI, `@render_widget` on the server:

```python
from shiny import App, ui
from shinywidgets import output_widget, render_widget
from plotomics import Volcano
import numpy as np, pandas as pd

app_ui = ui.page_fluid(output_widget("plot"))

def server(input, output, session):
    @render_widget
    def plot():
        n = 100_000
        df = pd.DataFrame({"x": np.random.randn(n), "y": np.abs(np.random.randn(n)) * 3})
        return Volcano(df)

app = App(app_ui, server)
```

## Development

The widget JS is built from the monorepo root and copied into
`src/plotomics/static/`:

```bash
pnpm dist          # build JS + sync bundles into this package
pip install -e ".[dev]"
pytest
```
