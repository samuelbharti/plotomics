// Draws the gallery thumbnails of the landing page into docs/gallery/, one
// WebP per component. Each component is rendered with seeded demo data in
// headless Chromium and exported with its own exportPNG, so a thumbnail
// shows what the component draws, axes and legends included. igv.js exports
// SVG only, so its thumbnail is its exportSVG drawn to a canvas. The data
// and the per-component setup are in docs/landing/gallery.ts.
//
//   node scripts/landing-thumbnails.mjs [name ...]
//
// With no names it draws all 17. Nothing here needs the network: the IGV
// demo reads the files in pkg-js/dev/fixtures, and the Gosling spec holds
// its values inline.
//
// Playwright and esbuild come from pkg-js. The browser comes from
// Playwright's usual folder, or from PLAYWRIGHT_BROWSERS_PATH. Install it
// once with:
//   pnpm --filter plotomics exec playwright install --only-shell chromium

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromPkgJs = createRequire(path.join(repo, "pkg-js/package.json"));
const load = (name) => import(pathToFileURL(fromPkgJs.resolve(name)).href);
const { build } = await load("esbuild");
// Playwright is CommonJS: its exports arrive as the default export.
const { chromium } = (await load("playwright")).default;

/** The size of a thumbnail in CSS px. At 2x it stays sharp in a card. */
const WIDTH = 400;
const HEIGHT = 300;
const SCALE = 2;
/** The largest file to write. The encoder lowers the quality to fit. */
const MAX_BYTES = 58_000;

const outDir = path.join(repo, "docs/gallery");
const work = await mkdtemp(path.join(os.tmpdir(), "plotomics-thumbs-"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

try {
  // The page: the gallery entry, and the IGV fixtures next to it, where
  // demo-data.ts looks for them.
  await build({
    entryPoints: [path.join(repo, "docs/landing/gallery.ts")],
    outfile: path.join(work, "gallery.js"),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    // React, inside Gosling, logs development warnings without this.
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  await cp(
    path.join(repo, "pkg-js/dev/fixtures"),
    path.join(work, "fixtures"),
    {
      recursive: true,
    },
  );
  await writeFile(
    path.join(work, "index.html"),
    '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">' +
      '<script type="module" src="gallery.js"></script>',
  );

  const server = createServer(async (req, res) => {
    const name = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = path.join(work, name === "/" ? "index.html" : name);
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1024 },
      deviceScaleFactor: SCALE,
    });
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(
      () => typeof window.renderThumbnail === "function",
    );
    const all = await page.evaluate(() => window.thumbnailNames);
    const wanted = process.argv.slice(2);
    const unknown = wanted.filter((n) => !all.includes(n));
    if (unknown.length > 0)
      throw new Error(`no thumbnail named ${unknown.join(", ")}`);

    await mkdir(outDir, { recursive: true });
    for (const name of wanted.length > 0 ? wanted : all) {
      const out = await page.evaluate(
        ([n, w, h, max]) => window.renderThumbnail(n, w, h, max),
        [name, WIDTH, HEIGHT, MAX_BYTES],
      );
      await writeFile(
        path.join(outDir, `${name}.webp`),
        Buffer.from(out.base64, "base64"),
      );
      console.log(
        `${name.padEnd(11)} ${out.width}x${out.height}  ` +
          `${(out.bytes / 1024).toFixed(1)} KB  quality ${out.quality}`,
      );
    }
    if (errors.length > 0) {
      console.warn(`The page logged ${errors.length} error(s):`);
      for (const e of errors) console.warn(`  ${e}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
