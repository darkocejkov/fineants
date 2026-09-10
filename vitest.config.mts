import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // `.mts` so Vite loads the config as ESM without a CJS deprecation warning, which is why
    // this is import.meta.dirname rather than __dirname.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
