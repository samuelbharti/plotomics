import { defineConfig } from "vite";

// Dev harness only — `pnpm dev` opens a page that
// renders components against synthetic data for visual verification.
export default defineConfig({
  root: "dev",
  server: { open: true, port: 5180 },
});
