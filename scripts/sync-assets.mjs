// Copies built component bundles into the language wrappers:
//   dist/umd/*.js       -> r/plotomics/inst/htmlwidgets/lib/plotomics/   (htmlwidgets)
//   dist/anywidget/*.js -> python/src/plotomics/static/               (anywidget)
//
// These targets are generated but git-tracked (committed into the wrappers so
// source installs ship the JS); run `pnpm dist` (build + sync) to refresh them
// before checking R/Python or packaging a release. CI's drift guard fails if a
// committed bundle is stale.

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUmd = path.join(repo, "packages/components/dist/umd");
const distAny = path.join(repo, "packages/components/dist/anywidget");
const rLib = path.join(repo, "r/plotomics/inst/htmlwidgets/lib/plotomics");
const pyStatic = path.join(repo, "python/src/plotomics/static");

async function syncDir(from, to) {
  let files;
  try {
    files = (await readdir(from)).filter((f) => f.endsWith(".js"));
  } catch {
    console.warn(`! ${from} missing — run \`pnpm build\` first.`);
    return 0;
  }
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const f of files) await cp(path.join(from, f), path.join(to, f));
  return files.length;
}

const r = await syncDir(distUmd, rLib);
const py = await syncDir(distAny, pyStatic);
console.log(`Synced ${r} bundle(s) -> R, ${py} bundle(s) -> Python.`);
