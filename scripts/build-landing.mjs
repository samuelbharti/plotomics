// Builds the script of the landing page, docs/index.html: docs/landing/main.ts
// and the live demo it loads, each demo tab in a chunk of its own, so a plot's
// code loads only when its tab opens.
//
//   node scripts/build-landing.mjs <outdir>
//       Bundle into <outdir>. docs.yml runs this into site/landing/.
//
//   node scripts/build-landing.mjs --site <dir> [--serve [port]]
//       Assemble the landing page the way docs.yml does (the page, its
//       images, the gallery thumbnails and the bundle) into <dir>, and with
//       --serve, serve <dir> at http://127.0.0.1:<port>/ (8000 by default)
//       until Ctrl+C. This is the local preview. It listens on this machine
//       only, and serves nothing outside <dir>.
//
// esbuild comes from pkg-js, which lists it as a dev dependency, so the
// repository root needs no dependency of its own for this script.

import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromPkgJs = createRequire(path.join(repo, "pkg-js/package.json"));
const { build } = await import(
  pathToFileURL(fromPkgJs.resolve("esbuild")).href
);

/** Bundle docs/landing/main.ts into `outdir` and print the file sizes. */
async function buildLanding(outdir) {
  await rm(outdir, { recursive: true, force: true });
  const result = await build({
    entryPoints: [path.join(repo, "docs/landing/main.ts")],
    outdir,
    bundle: true,
    format: "esm",
    splitting: true,
    minify: true,
    target: ["es2020"],
    entryNames: "[name]",
    chunkNames: "[name]-[hash]",
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
  });
  const rows = [];
  for (const file of Object.keys(result.metafile.outputs).sort()) {
    const bytes = await readFile(path.resolve(file));
    rows.push([
      path.relative(outdir, path.resolve(file)).replaceAll("\\", "/"),
      bytes.length,
      gzipSync(bytes).length,
    ]);
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(10);
  console.log(`Landing bundle in ${outdir}:`);
  for (const [name, raw, gz] of rows) {
    console.log(`  ${name.padEnd(34)} ${kb(raw)} ${kb(gz)} gzip`);
  }
}

/**
 * Copy what docs.yml deploys for the landing page into `dir`, then bundle
 * into `dir`/landing. Keep this in step with the "Assemble landing page"
 * step of .github/workflows/docs.yml. Files under `dir` that the site does
 * not hold, such as screenshots, are left alone.
 */
async function assembleSite(dir) {
  const docs = path.join(repo, "docs");
  await mkdir(dir, { recursive: true });
  await cp(path.join(docs, "index.html"), path.join(dir, "index.html"));
  await cp(path.join(docs, ".nojekyll"), path.join(dir, ".nojekyll"));
  // readdir, not fs.glob: glob is not in node:fs/promises on Node 20.
  for (const f of await readdir(docs)) {
    if (f.endsWith(".svg")) await cp(path.join(docs, f), path.join(dir, f));
  }
  const gallery = path.join(docs, "gallery");
  await rm(path.join(dir, "gallery"), { recursive: true, force: true });
  await mkdir(path.join(dir, "gallery"), { recursive: true });
  for (const f of await readdir(gallery)) {
    if (f.endsWith(".webp")) {
      await cp(path.join(gallery, f), path.join(dir, "gallery", f));
    }
  }
  await buildLanding(path.join(dir, "landing"));
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * Serve `dir` on `port` of 127.0.0.1 until the process stops. A path that
 * does not decode gets 400, and one that resolves outside `dir` gets 403.
 */
function serve(dir, port) {
  const root = path.resolve(dir);
  const server = createServer(async (req, res) => {
    let file;
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    // root plus the separator, so a sibling folder whose name starts with
    // the name of root does not pass.
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  server.on("error", (err) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `Port ${port} is in use. Stop what serves there, or pass another port: --serve <port>.`
        : `The preview server stopped: ${err.message}`,
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${root} at http://127.0.0.1:${port}/ (Ctrl+C stops)`);
  });
}

const args = process.argv.slice(2);
const site = args.indexOf("--site");
if (site !== -1) {
  const dir = args[site + 1];
  if (!dir) throw new Error("--site needs a folder");
  await assembleSite(path.resolve(dir));
  const at = args.indexOf("--serve");
  if (at !== -1) {
    const port = Number(args[at + 1]);
    serve(dir, Number.isInteger(port) && port > 0 ? port : 8000);
  }
} else if (args[0]) {
  await buildLanding(path.resolve(args[0]));
} else {
  console.error(
    "usage: node scripts/build-landing.mjs <outdir>\n" +
      "       node scripts/build-landing.mjs --site <dir> [--serve [port]]",
  );
  process.exit(1);
}
