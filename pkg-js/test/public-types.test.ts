import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Type-checks a small file that imports, by name and from the public package
// entries, each type that an exported signature uses. A type that a signature
// uses but no entry exports shows in an editor and cannot be imported, and the
// TypeDoc reference has no page for it.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The source file behind each entry of the package `exports` map. */
function entryPaths(): Record<string, string[]> {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const exportsMap = pkg.exports as Record<string, { types: string }>;
  const paths: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(exportsMap)) {
    const name = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
    // ./dist/lib/components/clustermap.d.ts is built from
    // src/components/clustermap.ts.
    const src = entry.types
      .replace(/^\.\/dist\/lib\//, "src/")
      .replace(/\.d\.ts$/, ".ts");
    paths[name] = [resolve(root, src)];
  }
  return paths;
}

const consumer = `
import type {
  AnyFactory,
  AnyModel,
  ClustermapOptions,
  EmbeddingColorMode,
  EmbeddingInstance,
  EmbeddingOptions,
  HeatmapInstance,
  HicInstance,
  Linkage,
  Metric,
  NetworkInstance,
  NetworkLayout,
  NetworkOptions,
  VolcanoInstance,
  createEmbedding,
  createHeatmap,
  createHic,
  createNetwork,
  createVolcano,
  makeAnywidget,
  registerComponent,
} from "plotomics";
import type { EmbeddingInstance as EmbeddingHandle } from "plotomics/embedding";
import type { HeatmapInstance as HeatmapHandle } from "plotomics/heatmap";
import type { HicInstance as HicHandle } from "plotomics/hic";
import type { NetworkInstance as NetworkHandle } from "plotomics/network";
import type { VolcanoInstance as VolcanoHandle } from "plotomics/volcano";
import type {
  DomainScale,
  TypedArray,
  decodeColumns,
  fitView,
  ltc,
  ltcdiv,
  viridis,
} from "plotomics/core";
import type {
  Linkage as ClustermapLinkage,
  Metric as ClustermapMetric,
} from "plotomics/clustermap";
import type { EmbeddingColorMode as EmbeddingMode } from "plotomics/embedding";
import type { NetworkLayout as NetworkLayoutMode } from "plotomics/network";

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

export type Checks = [
  Assert<Same<Linkage, ClustermapOptions["linkage"]>>,
  Assert<Same<Metric, ClustermapOptions["metric"]>>,
  Assert<Same<ClustermapLinkage, Linkage>>,
  Assert<Same<ClustermapMetric, Metric>>,
  Assert<Same<EmbeddingColorMode, EmbeddingOptions["colorMode"]>>,
  Assert<Same<EmbeddingMode, EmbeddingColorMode>>,
  Assert<Same<NetworkLayout, NetworkOptions["layout"]>>,
  Assert<Same<NetworkLayoutMode, NetworkLayout>>,
  Assert<Same<AnyFactory, Parameters<typeof registerComponent>[1]>>,
  Assert<
    Same<
      AnyModel,
      Parameters<ReturnType<typeof makeAnywidget>["render"]>[0]["model"]
    >
  >,
  Assert<Same<TypedArray, ReturnType<typeof decodeColumns>[string]>>,
  Assert<Same<DomainScale, Parameters<typeof fitView>[1]>>,
  Assert<Same<typeof ltc, typeof viridis>>,
  Assert<Same<typeof ltcdiv, typeof viridis>>,
  // The plots that zoom return a handle with resetView().
  Assert<Same<ReturnType<typeof createVolcano>, VolcanoInstance>>,
  Assert<Same<ReturnType<typeof createEmbedding>, EmbeddingInstance>>,
  Assert<Same<ReturnType<typeof createNetwork>, NetworkInstance>>,
  Assert<Same<ReturnType<typeof createHeatmap>, HeatmapInstance>>,
  Assert<Same<ReturnType<typeof createHic>, HicInstance>>,
  Assert<Same<VolcanoHandle, VolcanoInstance>>,
  Assert<Same<EmbeddingHandle, EmbeddingInstance>>,
  Assert<Same<NetworkHandle, NetworkInstance>>,
  Assert<Same<HeatmapHandle, HeatmapInstance>>,
  Assert<Same<HicHandle, HicInstance>>,
  Assert<Same<VolcanoInstance["resetView"], () => void>>,
  Assert<Same<EmbeddingInstance["resetView"], () => void>>,
  Assert<Same<NetworkInstance["resetView"], () => void>>,
  Assert<Same<HeatmapInstance["resetView"], () => void>>,
  Assert<Same<HicInstance["resetView"], () => void>>,
];
`;

/** Compiler messages for `consumer`, checked against the package sources. */
function typeErrors(): string[] {
  const configPath = resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    // The consumer file sits outside src.
    rootDir: undefined,
    noEmit: true,
    paths: entryPaths(),
  };
  const file = resolve(root, "test", "public-types-consumer.ts");
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    resolve(name) === file
      ? ts.createSourceFile(name, consumer, language)
      : getSourceFile(name, language, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => resolve(name) === file || fileExists(name);
  // The ambient declarations (module shims) that the sources rely on.
  const ambient = parsed.fileNames.filter((f) => f.endsWith(".d.ts"));
  const program = ts.createProgram([file, ...ambient], options, host);
  const source = program.getSourceFile(file);
  if (!source) throw new Error("the consumer file did not load");
  return [
    ...program.getOptionsDiagnostics(),
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("public types", () => {
  it("exports every type a public signature uses from the package entries", () => {
    expect(typeErrors()).toEqual([]);
  }, 60_000);
});
