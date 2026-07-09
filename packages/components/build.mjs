// Bundles each component into two self-contained artifacts:
//   dist/anywidget/<name>.js  — ESM with `export default { render }` for anywidget (Python)
//   dist/umd/<name>.js        — IIFE registering window.bioviz.<name> for htmlwidgets (R)
//
// Entries are discovered by glob, so adding a component never requires editing
// this file or any central registry — that is what keeps parallel PRs
// conflict-free.

import { build } from "esbuild";
import { glob } from "node:fs/promises";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

async function collect(pattern) {
  const out = [];
  for await (const f of glob(pattern, { cwd: root })) out.push(f);
  return out.sort();
}

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  logLevel: "info",
  // Bundle everything (regl, sigma, igv, ...) so wrappers load a single file.
  external: [],
};

async function run() {
  await rm(path.join(root, "dist"), { recursive: true, force: true });

  const anywidget = await collect("src/entries/anywidget/*.ts");
  const umd = await collect("src/entries/umd/*.ts");

  if (anywidget.length === 0 && umd.length === 0) {
    console.warn("No component entries found — nothing to build.");
  }

  // anywidget: one ESM module per component.
  if (anywidget.length) {
    await build({
      ...shared,
      entryPoints: anywidget,
      outdir: "dist/anywidget",
      format: "esm",
      entryNames: "[name]",
    });
  }

  // htmlwidgets: one IIFE per component.
  if (umd.length) {
    await build({
      ...shared,
      entryPoints: umd,
      outdir: "dist/umd",
      format: "iife",
      entryNames: "[name]",
    });
  }

  // Programmatic ESM entry for direct npm consumers (factories only).
  await build({
    ...shared,
    minify: false,
    entryPoints: ["src/lib/index.ts"],
    outdir: "dist/lib",
    format: "esm",
  });

  console.log(
    `Built ${anywidget.length} anywidget + ${umd.length} umd component bundles.`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
