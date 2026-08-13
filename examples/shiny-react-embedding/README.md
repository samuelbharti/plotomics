# plotomics embedding in a Posit `shiny-react` app

A minimal [shiny-react](https://github.com/wch/shiny-react) app that renders the
plotomics **embedding** (UMAP/t-SNE) viewer with a React frontend talking to an R
Shiny backend. It demonstrates the full round trip:

- **data down**: the R server sends a synthetic embedding as column-major JSON
  (`render_json` → `useShinyOutput("embedding_data")`),
- **selection up**: the lasso sends selected point indices back
  (`onSelect` → `useShinyInput("embedding_selected")`),
- **derived value down**: the server echoes the selected count
  (`useShinyOutput("n_selected")`).

## What comes from plotomics

Exactly one thing: the npm package. There is **no htmlwidgets and no anywidget**
on this path. You import the headless factory and drive it imperatively.

```tsx
import { createEmbedding } from "@plotomics/components/embedding";
```

The `/embedding` subpath (plus `sideEffects:false`) means your esbuild bundle
pulls only the embedding + `regl-scatterplot` (~255 KB), not the other sixteen
components' engines (gosling/igv/pixi/sigma). The ~60-line
[`srcts/Embedding.tsx`](srcts/Embedding.tsx) wrapper, a `useRef` container plus
`useEffect`s calling `setData`/`setOptions`/`destroy`, is the entire
integration, and it is not Shiny-aware. Everything else here
([`EmbeddingApp.tsx`](srcts/EmbeddingApp.tsx), [`r/app.R`](r/app.R)) is ordinary
shiny-react glue you own.

## Run it

Prerequisites: Node, R with the `shiny` package, and (for `npm run app`)
`Rscript` on your PATH.

```bash
npm install
npm run build      # esbuild srcts/main.tsx -> r/www/main.{js,css}
npm run app        # Rscript shiny::runApp('r/app.R', port = 8000)
# or: npm run dev  # rebuild-on-change + live Shiny in one command
```

Then open http://localhost:8000 and drag a lasso across the points.

### Using the local (unpublished) plotomics build

`package.json` pins `@plotomics/components: ^0.1.0` for when it is on npm. Until the
v0.1 release is published, link the workspace build instead, from the repo
root:

```bash
pnpm dist                                   # build @plotomics/components
cd examples/shiny-react-embedding
pnpm link ../../pkg-js/components         # or: npm install ../../pkg-js/components
```

(This example is intentionally **outside** the pnpm workspace so its React 19 /
shiny-react deps don't mix into the library's own React 18 build.)

## The large-data caveat

Data here rides Shiny's websocket as JSON. That's fine for tens of thousands of
points, but it forgoes plotomics's binary (anywidget) transport, so for very large
embeddings, downsample server-side or serve a binary blob the client `fetch`es
and decodes (you can reuse `decodeColumns` from `@plotomics/core`). This is the one
trade-off of the React-in-Shiny path versus the Python anywidget wrapper.

## Files

| File | Role |
|---|---|
| [`srcts/Embedding.tsx`](srcts/Embedding.tsx) | Reusable React wrapper around the plotomics factory (the transferable bit) |
| [`srcts/EmbeddingApp.tsx`](srcts/EmbeddingApp.tsx) | Wires `useShinyOutput`/`useShinyInput` to the wrapper |
| [`srcts/main.tsx`](srcts/main.tsx) | Mounts React into `#root` |
| [`r/app.R`](r/app.R) | Shiny server: generates data, reads selection, echoes count |
| [`r/shinyreact.R`](r/shinyreact.R) | `page_react()` + `render_json()` helpers (vendored from wch/shiny-react, MIT) |
