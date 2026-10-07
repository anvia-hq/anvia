import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/decision": fileURLToPath(
        new URL("../core/src/decision/index.ts", import.meta.url),
      ),
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/model-listing": fileURLToPath(
        new URL("../core/src/model-listing/index.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "node" },
});
