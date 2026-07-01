import { defineConfig } from "vite";

// Dev harness only — `pnpm --filter @bioviz/components dev` opens a page that
// renders components against synthetic data for visual verification.
export default defineConfig({
  root: "dev",
  server: { open: true, port: 5180 },
});
