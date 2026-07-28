# Contributing — adding a component

This is the canonical recipe. **The Volcano plot is the reference
implementation** — mirror its structure exactly. Following this pattern is what
keeps parallel work conflict-free: adding a component almost never edits a
shared file.

## Architecture in one paragraph

Every component is a **headless, imperative factory** in
`packages/components/src/components/<name>.ts` that knows nothing about R or
Python. It implements the `PlotomicsFactory` / `PlotomicsInstance` contract from
`@plotomics/core`. Two tiny generated adapters expose it: an **anywidget** ESM
entry (Python) and a **UMD/IIFE** entry (R/htmlwidgets). Build artifacts are
synced into the `pkg-r/` and `pkg-py/` packages, which are thin wrappers.

```
JS factory (createX)  ──► entries/anywidget/x.ts ──► dist/anywidget/x.js ──► pkg-py/src/plotomics/static/x.js
                      └─► entries/umd/x.ts       ──► dist/umd/x.js       ──► pkg-r/inst/htmlwidgets/lib/plotomics/x.js
```

## Performance rules (non-negotiable)

These components target **large datasets**. Use GPU/canvas rendering, never
per-datum SVG/DOM for the data layer:

- Points/large scatter → `regl-scatterplot` or a `regl`/WebGL layer.
- Matrices/heatmaps → WebGL or `canvas` with tiling; never one `<rect>` per cell.
- Networks → `sigma` v3 + `graphology` (WebGL).
- Genome tracks → `igv.js` / `gosling.js` (they stream + tile internally).
- SVG is for **axes, legends, labels, guides only** (the low-cardinality overlay).
- Prefer typed arrays end to end; read numeric data from `data.columns` as
  `ArrayLike<number>` (may be a `TypedArray` or plain array — support both).

## Step-by-step

1. **Factory** — `packages/components/src/components/<name>.ts`
   - Export `create<Name>: PlotomicsFactory<<Name>Options>` and a
     `default<Name>Options`.
   - Extract pure logic (scales, classification, layout math) into exported
     functions so they can be unit-tested without a GPU.
   - Implement `setData`, `setOptions`, `resize`, `destroy`, and where feasible
     `exportSVG` / `exportPNG` (publication output).

2. **Entries** (one line each)
   - `src/entries/anywidget/<name>.ts`: `export default makeAnywidget(create<Name>);`
   - `src/entries/umd/<name>.ts`: `registerComponent("<name>", create<Name>);`

3. **Programmatic export** — append to `src/lib/index.ts` (sorted).

4. **Unit test** — `packages/components/test/<name>.test.ts` for the pure helpers.

5. **Dev demo** — add a `demos.<name>` entry in `packages/components/dev/main.ts`
   with synthetic data at scale (≥100k where meaningful) so it can be eyeballed
   via `pnpm --filter @plotomics/components dev`.

6. **R wrapper**
   - `pkg-r/R/<name>.R`: exported `<name>()` constructor calling
     `plotomics_widget("<name>", columns, options=..., ...)`, plus
     `<name>Output()` / `render<Name>()` Shiny bindings. Use roxygen comments.
   - `pkg-r/inst/htmlwidgets/<name>.js`:
     `HTMLWidgets.widget(window.plotomics.htmlwidget("<name>"));`
   - `pkg-r/inst/htmlwidgets/<name>.yaml`: dependency on
     `htmlwidgets/lib/plotomics/<name>.js`.
   - `pkg-r/tests/testthat/test-<name>.R`.

7. **Python wrapper**
   - `pkg-py/src/plotomics/<name>.py`: a `class <Name>(PlotomicsWidget)` with
     `_esm = STATIC / "<name>.js"`; pack numeric columns via `pack_columns`,
     put string columns in `data["columns"]`, scalars in `data["meta"]`.
   - Append the class to `pkg-py/src/plotomics/__init__.py` (`__all__`, sorted).
   - `pkg-py/tests/test_<name>.py`.

8. **Trait/payload contract** — keep option keys **camelCase** and identical
   across JS options, the R `options` list, and the Python `options` dict.

## Verify locally before opening a PR

```bash
pnpm install
pnpm dist            # build all JS + sync bundles into pkg-r/ and pkg-py/
pnpm -r test         # JS unit tests
pnpm -r typecheck

Rscript -e 'roxygen2::roxygenise("pkg-r")'   # regenerate NAMESPACE + man/
Rscript -e 'devtools::test("pkg-r")'

cd pkg-py && pip install -e ".[dev]" && pytest && cd ..
```

## The only shared files (append, don't rewrite — keep sorted)

- `packages/components/src/lib/index.ts`
- `pkg-py/src/plotomics/__init__.py`
- `packages/components/dev/main.ts`

Everything else your component adds is brand-new files. If you find yourself
editing `@plotomics/core`, prefer adding a new util over changing an existing
signature.
