import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/evals": fileURLToPath(new URL("../core/src/evals/index.ts", import.meta.url)),
      "@anvia/core/observability": fileURLToPath(
        new URL("../core/src/observability/index.ts", import.meta.url),
      ),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
