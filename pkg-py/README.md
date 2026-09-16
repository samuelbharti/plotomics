# plotomics (Python)

<!-- badges: start -->
[![Lifecycle: stable](https://img.shields.io/badge/lifecycle-stable-brightgreen.svg)](https://lifecycle.r-lib.org/articles/stages.html#stable)
[![PyPI](https://img.shields.io/pypi/v/plotomics)](https://pypi.org/project/plotomics/)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.21926306-1682D4)](https://doi.org/10.5281/zenodo.21926306)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/samuelbharti/plotomics/blob/main/LICENSE)
<!-- badges: end -->

<img src="https://raw.githubusercontent.com/samuelbharti/plotomics/main/assets/logo.png" align="right" width="140" alt="" />


High-performance bioinformatics visualization widgets backed by a shared
JavaScript core, exposed to Python through [anywidget](https://anywidget.dev).

Works in Jupyter, JupyterLab, marimo, Google Colab, VS Code, Shiny for Python
and Streamlit. Large numeric columns are shipped to the browser as a single
binary buffer rather than JSON, so several hundred thousand points stay
interactive.

Seventeen components ship, including the two genome browsers, `igv()` and
`gosling()`, which the R package does not carry.

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

## Documentation

- [Reference](https://www.samuelbharti.com/plotomics/py/) for every component
- [Project overview](https://www.samuelbharti.com/plotomics/): why the package
  exists, the R and JavaScript packages, and when an established package such as
  `scanpy` or `plotly` is the better choice

## Contributing

See [CONTRIBUTING.md](https://github.com/samuelbharti/plotomics/blob/main/CONTRIBUTING.md).

## License

MIT. See [LICENSE](https://github.com/samuelbharti/plotomics/blob/main/LICENSE).

## Acknowledgements

Barret Schloerke and Carson Sievert advise this work as thesis advisors.
Posit Software, PBC funded early work on this package and holds copyright
together with the author.
