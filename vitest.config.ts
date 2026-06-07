import path from "path";
import { defineConfig } from "vitest/config";

// Pure-logic unit tests run in the Node environment (no jsdom needed).
// The "@" alias mirrors tsconfig.json paths ("@/*" -> "src/*").
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Disable PostCSS so Vite doesn't try to load the project's Tailwind config
  // (whose native oxide binding is unavailable on Node 18). Pure-logic tests
  // import no CSS, so this has no effect on coverage.
  css: {
    postcss: {},
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
