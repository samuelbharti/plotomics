# @plotomics/core

The shared foundation behind every [plotomics](https://github.com/samuelbharti/plotomics)
visualization: the component contract, theming, colour scales, binary column
transport and export helpers.

You usually do not install this directly. It is a runtime dependency of
[`@plotomics/components`](https://www.npmjs.com/package/@plotomics/components),
and of the R and Python wrappers. Install it on its own only if you are building
a component that has to speak the same contract.

```bash
pnpm add @plotomics/core
```

## What is in here

**The contract.** `PlotomicsFactory` takes a host element plus `{ data, options }`
and returns a `PlotomicsInstance` — `setData`, `setOptions`, `resize`, `destroy`.
Every component in the library implements exactly this, which is what lets one
source bundle drive three languages.

**Theming.** `defaultTheme`, `darkTheme` and `resolveTheme` produce a
`PlotomicsTheme`; `OKABE_ITO` is the colour-blind-safe categorical default.

**Colour.** `viridis` and `rdbu` ramps, plus `ramp`, `RAMPS`, `sampleRamp`,
`categoricalScale` and `rgbToHex`.

**Transport.** `decodeColumns` reads the binary column format the wrappers use to
move numeric data to the browser without going through JSON — the reason a
half-million-point embedding stays interactive. See `Dtype`, `ColumnSpec` and
`BufferSchema`.

**Export.** `serializeSVG`, `canvasToPNG`, `canvasToSVGImage` and `downloadBlob`
back the figure-export path.

**DOM.** `createTooltip`, `clearElement`, `measure` and `dpr` — small helpers for
high-DPI-correct sizing and shared tooltip behaviour.

## Documentation

Architecture and the full component contract:
[docs/architecture.md](https://github.com/samuelbharti/plotomics/blob/main/docs/architecture.md).

## License

MIT
