import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core": new URL("../../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
