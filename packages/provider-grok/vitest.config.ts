import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/image-generation": fileURLToPath(
        new URL("../core/src/image-generation/index.ts", import.meta.url),
      ),
      "@anvia/core/model-listing": fileURLToPath(
        new URL("../core/src/model-listing/index.ts", import.meta.url),
      ),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@anvia/openai": fileURLToPath(new URL("../provider-openai/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
