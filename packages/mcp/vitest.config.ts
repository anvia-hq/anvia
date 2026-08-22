import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/mcp": new URL("../core/src/mcp/index.ts", import.meta.url).pathname,
      "@anvia/core/tool": new URL("../core/src/tool/index.ts", import.meta.url).pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
