import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// npm checks an optional peer whenever a project has that package, so the
// examples that install plotomics with npm must ask for versions inside its
// peer ranges, or `npm install` stops with ERESOLVE.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const pkg = readJson(resolve(root, "package.json"));

/** The lowest version of a caret range such as "^18.3.1". */
function caret(range: string): number[] {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new Error(`not a caret range: ${range}`);
  return m.slice(1).map(Number);
}

/** Whether every version of caret range `inner` is inside caret range `outer`. */
function within(inner: string, outer: string): boolean {
  const [a, b] = [caret(inner), caret(outer)];
  if (a[0] !== b[0]) return false;
  for (let i = 1; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return true;
}

describe("example peer ranges", () => {
  const example = readJson(
    resolve(root, "../examples/shiny-react-embedding/package.json"),
  );

  for (const name of ["react", "react-dom"]) {
    it(`the shiny-react example asks for a ${name} inside the peer range`, () => {
      const peer = pkg.peerDependencies[name] as string;
      const wanted = example.dependencies[name] as string;
      expect(within(wanted, peer), `${wanted} in ${peer}`).toBe(true);
    });
  }
});
