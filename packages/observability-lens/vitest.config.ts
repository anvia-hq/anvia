import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/evals": fileURLToPath(new URL("../core/src/evals/index.ts", import.meta.url)),
      "@anvia/core/observability": fileURLToPath(
        new URL("../core/src/observability/index.ts", import.meta.url),
      ),
      "@anvia/otel": fileURLToPath(new URL("../observability-otel/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
