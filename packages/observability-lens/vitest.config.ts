import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/evals": new URL("../core/src/evals/index.ts", import.meta.url).pathname,
      "@anvia/core/observability": new URL("../core/src/observability/index.ts", import.meta.url)
        .pathname,
      "@anvia/otel": new URL("../observability-otel/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
