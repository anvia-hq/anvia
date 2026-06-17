import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/embeddings": new URL("../core/src/embeddings/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/tool": new URL("../core/src/tool/index.ts", import.meta.url).pathname,
      "@anvia/core/vector-store": new URL("../core/src/vector-store/index.ts", import.meta.url)
        .pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
