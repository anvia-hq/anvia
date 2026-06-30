import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/image-generation": new URL(
        "../core/src/image-generation/index.ts",
        import.meta.url,
      ).pathname,
      "@anvia/core/model-listing": new URL("../core/src/model-listing/index.ts", import.meta.url)
        .pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@anvia/openai": new URL("../provider-openai/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
