import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/embeddings": fileURLToPath(
        new URL("../core/src/embeddings/index.ts", import.meta.url),
      ),
      "@anvia/core/tool": fileURLToPath(new URL("../core/src/tool/index.ts", import.meta.url)),
      "@anvia/core/vector-store": fileURLToPath(
        new URL("../core/src/vector-store/index.ts", import.meta.url),
      ),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
