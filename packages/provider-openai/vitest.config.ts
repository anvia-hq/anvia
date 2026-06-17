import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/audio-generation": new URL(
        "../core/src/audio-generation/index.ts",
        import.meta.url,
      ).pathname,
      "@anvia/core/completion": new URL("../core/src/completion/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/embeddings": new URL("../core/src/embeddings/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/image-generation": new URL(
        "../core/src/image-generation/index.ts",
        import.meta.url,
      ).pathname,
      "@anvia/core/model-listing": new URL("../core/src/model-listing/index.ts", import.meta.url)
        .pathname,
      "@anvia/core/transcription": new URL("../core/src/transcription/index.ts", import.meta.url)
        .pathname,
      "@anvia/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
