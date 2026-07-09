import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/memory": new URL("../core/src/memory/index.ts", import.meta.url).pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
