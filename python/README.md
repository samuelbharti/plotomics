# bioviz (Python)

High-performance bioinformatics visualization widgets backed by a shared
JavaScript core, exposed to Python through [anywidget](https://anywidget.dev).

Works in Jupyter, JupyterLab, marimo, Google Colab, VS Code, Shiny for Python
and Streamlit. Large numeric columns are shipped to the browser as a single
binary buffer (not JSON), so millions of points stay interactive.

```python
import numpy as np, pandas as pd
from bioviz import Volcano

n = 200_000
df = pd.DataFrame({
    "x": np.random.randn(n),                 # log2 fold change
    "y": np.abs(np.random.randn(n)) * 3,     # -log10 p-value
    "label": [f"GENE{i}" for i in range(n)],
})
Volcano(df, fc_threshold=1.0, p_threshold=0.05)
```

## Development

The widget JS is built from the monorepo root and copied into
`src/bioviz/static/`:

```bash
pnpm dist          # build JS + sync bundles into this package
pip install -e ".[dev]"
pytest
```
