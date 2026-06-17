import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/evals": new URL("../core/src/evals/index.ts", import.meta.url).pathname,
      "@anvia/core/observability": new URL("../core/src/observability/index.ts", import.meta.url)
        .pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
