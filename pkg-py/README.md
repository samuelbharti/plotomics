# plotomics (Python)

<img src="https://raw.githubusercontent.com/samuelbharti/plotomics/main/assets/logo.png" align="right" width="140" alt="" />

[![PyPI](https://img.shields.io/pypi/v/plotomics.svg)](https://pypi.org/project/plotomics/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

High-performance bioinformatics visualization widgets backed by a shared
JavaScript core, exposed to Python through [anywidget](https://anywidget.dev).

Works in Jupyter, JupyterLab, marimo, Google Colab, VS Code, Shiny for Python
and Streamlit. Large numeric columns are shipped to the browser as a single
binary buffer (not JSON), so millions of points stay interactive.

## Installation

```bash
pip install plotomics
```

## Quick start

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

## Motivation

I built plotomics because I kept hitting the same wall in my own work. A
single-cell embedding with 500,000 cells or a volcano plot with 20,000
genes is common today. Most Python plotting tools were built for a few
thousand points. Past that count, a plot stops being useful before the
data stops being interesting.

I also work in both Python and R, and I got tired of writing the same
figure twice and watching the two versions drift apart. I write each
widget here once, in TypeScript, and wrap it thinly for Python. The
Python version and the R version cannot disagree, because they share one
implementation.

See the [project overview](https://www.samuelbharti.com/plotomics/) for
the full story, including when an established Python package like
`scanpy` or `plotly` is still the better choice.

## Development

The widget JS is built from the monorepo root and copied into
`src/plotomics/static/`:

```bash
pnpm dist          # build JS + sync bundles into this package
pip install -e ".[dev]"
pytest
```

## Acknowledgements

Barret Schloerke and Carson Sievert advise this work as thesis advisors.
Posit Software, PBC funded early work on this package and holds copyright
together with the author.
