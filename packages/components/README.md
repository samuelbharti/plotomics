# @plotomics/components

Headless, framework-agnostic bioinformatics visualization components. Each
component is a factory — `createX(element, { data, options })` → an instance with
`setData` / `setOptions` / `resize` / `destroy` (and `exportSVG` / `exportPNG`
where supported). The same factories power the R (htmlwidgets) and Python
(anywidget) wrappers.

## Install

```sh
npm install @plotomics/components
```

## Tree-shakeable subpath imports

Import a single component from its subpath so your bundle only pulls in that
component and its engine — not every visualization:

```js
import { createEmbedding } from "@plotomics/components/embedding";

const inst = createEmbedding(el, {
  data: { columns: { x, y, color } },
  options: { pointSize: 4, mouseMode: "lasso", onSelect: (idx) => …},
});
```

The package sets `"sideEffects": false`, so a bundler also tree-shakes the
barrel import (`@plotomics/components`) down to what you use.

## Optional engine peer dependencies

The heavy rendering engines are declared as **optional `peerDependencies`**, so
`npm install @plotomics/components` does not drag all of them in. Most components
render on `regl` / `d3` (bundled as regular dependencies — nothing extra to
install). Three components need an engine installed alongside them:

| Import | Install alongside |
| --- | --- |
| `@plotomics/components/embedding`, `/volcano`, `/heatmap`, `/hic`, `/treemap`, `/clustermap` | *(nothing extra)* |
| `@plotomics/components/gosling` | `gosling.js pixi.js` |
| `@plotomics/components/igv` | `igv` |
| `@plotomics/components/network` | `sigma graphology graphology-layout-forceatlas2` |

If you import a component without its engine, your bundler reports the missing
module at build time. Install only the engine(s) your app actually uses:

```sh
# e.g. an app that uses the network graph
npm install @plotomics/components sigma graphology graphology-layout-forceatlas2
```

`react` / `react-dom` are also optional peers, only needed if you use the React
bindings.
