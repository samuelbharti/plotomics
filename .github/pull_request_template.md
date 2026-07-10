<!-- Thanks for contributing to plotomics! Keep the sections that apply; delete the rest. -->

## Summary

<!-- What does this PR do and why? Link related issues, e.g. "Closes #123". -->

## Type of change

- [ ] New component
- [ ] Fix / improvement to an existing component
- [ ] Core (`@plotomics/core`) change
- [ ] Tooling / CI / docs

## New component checklist

<!-- Mirrors CONTRIBUTING.md. Delete this section for non-component PRs. -->

- [ ] **Factory** — `packages/components/src/components/<name>.ts` exports `create<Name>` + `default<Name>Options`, with pure logic (scales/layout/classification) extracted as testable functions
- [ ] **Entries** — `src/entries/anywidget/<name>.ts` and `src/entries/umd/<name>.ts` (one line each)
- [ ] **Programmatic export** — appended to `packages/components/src/lib/index.ts` (kept sorted)
- [ ] **Unit test** — `packages/components/test/<name>.test.ts` covers the pure helpers
- [ ] **Dev demo** — `demos.<name>` in `packages/components/dev/main.ts` with synthetic data at scale (>=100k where meaningful)
- [ ] **R wrapper** — `r/plotomics/R/<name>.R` (+ `<name>Output()` / `render<Name>()` Shiny bindings), `inst/htmlwidgets/<name>.js` + `<name>.yaml`, `tests/testthat/test-<name>.R`; NAMESPACE + man/ regenerated via roxygen
- [ ] **Python wrapper** — `python/src/plotomics/<name>.py`, class appended to `__init__.py` (`__all__`, sorted), `python/tests/test_<name>.py`
- [ ] **Trait parity** — option keys are camelCase and identical across JS options, the R `options` list, and the Python `options` dict

## Verification

- [ ] `pnpm dist` (build + sync bundles into `r/` and `python/`) passes
- [ ] `pnpm -r test` passes
- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm lint` passes (or surfaces only pre-existing findings)
- [ ] R touched → `devtools::test("r/plotomics")` passes
- [ ] Python touched → `pytest` passes

## Notes

<!-- Screenshots / GIFs for visual changes, perf numbers for large-data paths, and any breaking-change callouts. -->
