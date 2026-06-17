import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/agent": new URL("../core/src/agent/index.ts", import.meta.url).pathname,
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/model-listing": new URL("../core/src/model-listing/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/tool": new URL("../core/src/tool/index.ts", import.meta.url).pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
