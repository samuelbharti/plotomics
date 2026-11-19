import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The JavaScript blocks of the README are code a reader copies, so each one
// has to parse: a placeholder such as "…" stops esbuild and every other
// bundler.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const blocks = [...readme.matchAll(/```js\n([\s\S]*?)```/g)].map(
  (m) => m[1] as string,
);

describe("README", () => {
  it("has JavaScript blocks", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((code, i) => [i + 1, code]))(
    "JavaScript block %i parses",
    (_, code) => {
      const out = ts.transpileModule(code as string, {
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.ESNext, allowJs: true },
        fileName: "block.js",
      });
      const errors = (out.diagnostics ?? []).map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      expect(errors).toEqual([]);
    },
  );
});
