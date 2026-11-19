import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Type-checks the published declarations (dist/lib/**/*.d.ts) the way a
// TypeScript project that installs plotomics sees them: with skipLibCheck
// false, under bundler and node16 module resolution. The declarations are
// emitted in memory from the build config and served from a package folder
// that exists only in memory. A consumer installs the dependencies and the
// peers of the package, never its devDependencies, so the @types packages
// that are only devDependencies are hidden from it.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(
  /\\/g,
  "/",
);
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const consumerDir = `${root}/test/.consumer`;
const pkgDir = `${consumerDir}/node_modules/plotomics`;

/** The declarations of the package, keyed by their path in `pkgDir`. */
function emitDeclarations(): Map<string, string> {
  const configPath = `${root}/tsconfig.build.json`;
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
  };
  const outDir = (options.outDir as string).replace(/\\/g, "/");
  const out = new Map<string, string>();
  const program = ts.createProgram(parsed.fileNames, options);
  const result = program.emit(undefined, (name, text) => {
    const file = name.replace(/\\/g, "/");
    if (!file.endsWith(".d.ts")) return;
    out.set(`${pkgDir}/dist/lib${file.slice(outDir.length)}`, text);
  });
  if (result.emitSkipped) throw new Error("the declarations were not emitted");
  return out;
}

/** A file that imports every entry of the package `exports` map. */
function consumerSource(): string {
  const entries = Object.keys(pkg.exports as Record<string, unknown>).map(
    (key) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`),
  );
  const lines = entries.map((e, i) => `import * as m${i} from "${e}";`);
  lines.push(`export const all = [${entries.map((_, i) => `m${i}`)}];`);
  return lines.join("\n");
}

/** @types packages a consumer does not get: devDependencies only. */
function devOnlyTypes(): string[] {
  const shipped = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  return Object.keys(pkg.devDependencies ?? {}).filter(
    (name) => name.startsWith("@types/") && !shipped.has(name),
  );
}

const declarations = emitDeclarations();

/** Compiler messages for the consumer file under one module resolution. */
function consumerErrors(resolution: "bundler" | "node16"): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module:
      resolution === "node16" ? ts.ModuleKind.Node16 : ts.ModuleKind.ESNext,
    moduleResolution:
      resolution === "node16"
        ? ts.ModuleResolutionKind.Node16
        : ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
  };
  const files = new Map(declarations);
  const entry = `${consumerDir}/index.ts`;
  files.set(entry, consumerSource());
  files.set(`${consumerDir}/package.json`, '{ "type": "module" }');
  files.set(`${pkgDir}/package.json`, JSON.stringify(pkg));
  const dirs = new Set<string>();
  for (const file of files.keys()) {
    for (let d = dirname(file); d.startsWith(consumerDir); d = dirname(d)) {
      dirs.add(d.replace(/\\/g, "/"));
    }
  }
  const hidden = devOnlyTypes().map((name) => `/node_modules/${name}`);
  const isHidden = (path: string) => {
    const p = path.replace(/\\/g, "/");
    return hidden.some((h) => p.endsWith(h) || p.includes(`${h}/`));
  };
  const norm = (path: string) => resolve(path).replace(/\\/g, "/");

  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const realpath = host.realpath?.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    const text = files.get(norm(name));
    return text === undefined
      ? getSourceFile(name, language, ...rest)
      : ts.createSourceFile(name, text, language);
  };
  host.fileExists = (name) =>
    files.has(norm(name)) || (!isHidden(name) && fileExists(name));
  host.readFile = (name) =>
    files.get(norm(name)) ?? (isHidden(name) ? undefined : readFile(name));
  host.directoryExists = (name) =>
    dirs.has(norm(name)) ||
    (!isHidden(name) && (directoryExists ? directoryExists(name) : true));
  host.realpath = (name) =>
    files.has(norm(name)) || dirs.has(norm(name))
      ? name
      : realpath
        ? realpath(name)
        : name;

  const program = ts.createProgram([entry], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file ? `${d.file.fileName.replace(consumerDir, "")}: ` : "";
    return `${where}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
  });
}

describe("published declarations", () => {
  it("hides the @types devDependencies from the consumer", () => {
    // A check on the test itself: without hiding them, the check below
    // passes on a machine that has the devDependencies installed.
    expect(devOnlyTypes().length).toBeGreaterThan(0);
  });

  it("type-check under bundler resolution with skipLibCheck false", () => {
    expect(consumerErrors("bundler")).toEqual([]);
  }, 120_000);

  it("type-check under node16 resolution with skipLibCheck false", () => {
    expect(consumerErrors("node16")).toEqual([]);
  }, 120_000);
});
