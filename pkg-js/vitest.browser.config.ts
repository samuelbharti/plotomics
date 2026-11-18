import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Smoke tests for the two genome browser components. gosling.js and igv.js
// need a real DOM and WebGL, so these tests run in headless Chromium and the
// Node run in vitest.config.ts skips them.
//
// Run with `pnpm test:browser`. The first run needs the browser:
//   pnpm exec playwright install chromium
export default defineConfig({
  test: {
    root: ".",
    include: ["test/browser/**/*.test.ts"],
    // Each test waits up to 30 s for a component to come up. The default
    // limit for a browser test is 15 s, which would cut that wait short.
    testTimeout: 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      // A desktop-sized page. The default is 414 px wide, and regl-scatterplot
      // draws through one shared canvas sized to the window, so a plot wider
      // than the page is clipped at the page edge.
      viewport: { width: 1280, height: 1024 },
    },
  },
});
