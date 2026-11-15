import { configDefaults, defineConfig } from "vitest/config";

// Separate from vite.config.ts (which roots at ./dev for the harness) so tests
// resolve from the package root.
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    // test/browser needs a real browser. vitest.browser.config.ts runs it.
    exclude: [...configDefaults.exclude, "test/browser/**"],
    environment: "node",
  },
});
