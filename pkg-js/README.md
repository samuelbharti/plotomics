# plotomics

<img src="https://raw.githubusercontent.com/samuelbharti/plotomics/main/assets/logo.png" align="right" width="140" alt="" />

Headless, framework-agnostic bioinformatics visualization components. Each
component is a factory: `createX(element, { data, options })` returns an
instance with `setData` / `setOptions` / `resize` / `destroy` (and `exportSVG` /
`exportPNG` where supported). The same factories power the R (htmlwidgets) and
Python (anywidget) wrappers, so a figure looks and behaves the same in all three
languages.

## Install

```sh
npm install plotomics
```

The same name on every registry: `npm install plotomics`,
`pip install plotomics`, `install.packages("plotomics")`.

## Tree-shakeable subpath imports

Import a single component from its subpath so your bundle only pulls in that
component and its engine, not every visualization:

```js
import { createEmbedding } from "plotomics/embedding";

const inst = createEmbedding(el, {
  data: { columns: { x, y, color } },
  options: { pointSize: 4, mouseMode: "lasso", onSelect: (idx) => …},
});
```

The package sets `"sideEffects": false`, so a bundler also tree-shakes the
barrel import (`plotomics`) down to what you use.

## The shared core

`plotomics/core` exposes the pieces every component is built on — the component
contract (`PlotomicsFactory`, `PlotomicsInstance`), theming (`defaultTheme`,
`darkTheme`, `OKABE_ITO`), colour ramps (`viridis`, `rdbu`, `ltc`, `ltcdiv`,
`categoricalScale`), the binary column transport (`decodeColumns`) and the
export helpers (`serializeSVG`, `canvasToPNG`).

```js
import { defaultTheme, categoricalScale } from "plotomics/core";
```

Import it directly if you are building a component that should speak the same
contract, or just to reuse the colour scales.

## Optional engine peer dependencies

The heavy rendering engines are declared as **optional `peerDependencies`**, so
`npm install plotomics` does not drag all of them in. Fourteen of the seventeen
components render on `regl`, the canvas 2-D context, or `d3`, all bundled as
regular dependencies, so nothing extra is needed. Three do need an engine
alongside them:

| Import | Install alongside |
| --- | --- |
| `/volcano`, `/embedding`, `/heatmap`, `/clustermap`, `/hic`, `/treemap`, `/dotplot`, `/violin`, `/spatial`, `/oncoplot`, `/lollipop`, `/km`, `/profile`, `/upset` | *(nothing extra)* |
| `plotomics/gosling` | `gosling.js pixi.js react react-dom` |
| `plotomics/igv` | `igv` |
| `plotomics/network` | `sigma graphology graphology-layout-forceatlas2` |

If you import a component without its engine, your bundler reports the missing
module at build time. Install only the engine(s) your app actually uses:

```sh
# e.g. an app that uses the network graph
npm install plotomics sigma graphology graphology-layout-forceatlas2
```

`react` and `react-dom` are optional peers required only by `plotomics/gosling`
— Gosling.js is a React component internally. No plotomics component imports
React itself. Gosling.js 1.0.7 supports React 16 through 18 and pixi.js 6, which
is why those peer ranges stop short of the current majors.
