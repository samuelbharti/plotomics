import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { defaultTheme } from "../src/core/theme.js";
import {
  isValidSpec,
  embedOptions,
  mergeGoslingOptions,
  defaultGoslingOptions,
} from "../src/components/gosling-spec.js";

describe("gosling helpers", () => {
  it("accepts specs with a recognised composition key", () => {
    expect(isValidSpec({ tracks: [] })).toBe(true);
    expect(isValidSpec({ views: [] })).toBe(true);
    expect(isValidSpec({ alignment: "stack", tracks: [] })).toBe(true);
  });

  it("rejects non-spec values", () => {
    expect(isValidSpec(null)).toBe(false);
    expect(isValidSpec(undefined)).toBe(false);
    expect(isValidSpec("tracks")).toBe(false);
    expect(isValidSpec([{ tracks: [] }])).toBe(false);
    expect(isValidSpec({})).toBe(false);
    expect(isValidSpec({ title: "no tracks here" })).toBe(false);
  });

  it("builds embed options dropping undefined values", () => {
    expect(embedOptions({ padding: undefined, theme: undefined })).toEqual({});
    expect(embedOptions({ padding: 30, theme: undefined })).toEqual({
      padding: 30,
    });
    expect(embedOptions({ padding: 0, theme: "dark" })).toEqual({
      padding: 0,
      theme: "dark",
    });
  });

  it("merges options, replacing spec wholesale", () => {
    const base = { ...defaultGoslingOptions, spec: { tracks: [1] } };
    const merged = mergeGoslingOptions(base, {
      spec: { tracks: [2] },
    });
    expect(merged.spec).toEqual({ tracks: [2] });
    // absent keys are preserved
    expect(mergeGoslingOptions(base, { padding: 5 }).spec).toBe(base.spec);
    // no patch -> shallow copy
    expect(mergeGoslingOptions(base)).toEqual(base);
    expect(mergeGoslingOptions(base)).not.toBe(base);
  });
});

/** The doc comment of one member of the GoslingOptions interface. */
function goslingOptionDoc(member: string): string {
  const file = fileURLToPath(
    new URL("../src/components/gosling-spec.ts", import.meta.url),
  );
  const program = ts.createProgram([file], { noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const options = source?.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === "GoslingOptions",
  );
  const node = options?.members.find(
    (m) => m.name !== undefined && m.name.getText(source) === member,
  );
  const symbol = node?.name ? checker.getSymbolAtLocation(node.name) : null;
  if (!symbol) return "";
  return ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .replace(/\s+/g, " ");
}

describe("GoslingOptions.theme", () => {
  it("says it is a Gosling theme and that no plotomics theme field applies", () => {
    const doc = goslingOptionDoc("theme");
    expect(doc).toContain("Gosling's own theme");
    expect(doc).toContain("It is not a plotomics theme");
    for (const field of Object.keys(defaultTheme)) {
      expect(doc).toContain(`\`${field}\``);
    }
  });
});
