# bioviz

**Lightweight, GPU-accelerated bioinformatics visualization components with R and Python wrappers.**

One high-performance TypeScript core, wrapped for R (via
[htmlwidgets](https://www.htmlwidgets.org/)) and Python (via
[anywidget](https://anywidget.dev/)). Built for **large datasets** — the
rendering layer is WebGL/canvas throughout (regl, sigma, HiGlass, igv.js), and
numeric data reaches the browser as a binary buffer rather than JSON, so
hundreds of thousands to millions of features stay interactive. Components are
designed to be **publication-ready**, not toy demos.

## Components

| Component | Status | Engine | Purpose |
|---|---|---|---|
| Volcano plot | ✅ reference | regl-scatterplot | Differential expression (effect vs. significance) |
| Embedding (UMAP/t-SNE) | ✅ | regl-scatterplot | 2-D single-cell / dimensionality-reduction maps |
| Expression heatmap | ✅ | WebGL | Large sample × gene matrices |
| Gene treemap | ✅ | D3 + canvas | Hierarchical gene-set / pathway composition |
| Clustered heatmap | ✅ | WebGL + dendrograms | Hierarchically-clustered expression |
| Hi-C contact matrix | ✅ | WebGL tiling / LOD | Chromatin contact maps |
| Genome viewer (igv.js) | ✅ | igv.js | Track-based genome browser |
| Genome viewer (Gosling) | ✅ | Gosling.js | Declarative genomics figures |
| Network graph | ✅ | sigma v3 | Large biological networks |

## Repository layout

```
packages/
  core/         @bioviz/core       — contract, theme, color, binary transport, export
  components/   @bioviz/components  — the headless viz factories + adapters + dev harness
r/bioviz/       R package (htmlwidgets)
python/         Python package (anywidget)
scripts/        sync built bundles into the wrappers
```

## Quick start (dev)

```bash
pnpm install
pnpm dist        # build all JS + copy bundles into r/ and python/

# Visual dev harness (WebGL, synthetic data at scale)
pnpm --filter @bioviz/components dev   # http://localhost:5180
```

### R

```r
pnpm dist  # ensure bundles are synced (run once in the shell)
devtools::load_all("r/bioviz")
df <- data.frame(x = rnorm(1e5), y = abs(rnorm(1e5)) * 3, label = paste0("GENE", 1:1e5))
volcano(df, fc_threshold = 1, p_threshold = 0.05)
```

### Python

```python
import numpy as np, pandas as pd
from bioviz import Volcano

n = 200_000
df = pd.DataFrame({"x": np.random.randn(n), "y": np.abs(np.random.randn(n))*3,
                   "label": [f"GENE{i}" for i in range(n)]})
Volcano(df)
```

Large single-cell embedding (UMAP/t-SNE) colored by cluster, with lasso selection:

```python
import numpy as np, pandas as pd
from bioviz import Embedding

n = 500_000
k = np.random.randint(0, 8, n)                        # cluster per cell
df = pd.DataFrame({"x": np.random.randn(n) + k*4, "y": np.random.randn(n) + k*4,
                   "color": [f"cluster {i}" for i in k]})
Embedding(df, color_mode="categorical")
```

## Contributing

New components follow one recipe — see [CONTRIBUTING.md](CONTRIBUTING.md). The
Volcano plot is the reference implementation. Architecture details are in
[docs/architecture.md](docs/architecture.md).

## License

MIT
