import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which roots at ./dev for the harness) so tests
// resolve from the package root.
export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
