import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/memory": fileURLToPath(new URL("../core/src/memory/index.ts", import.meta.url)),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
