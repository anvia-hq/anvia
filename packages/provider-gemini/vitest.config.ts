import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anvia/core/speech-generation": fileURLToPath(
        new URL("../core/src/speech-generation/index.ts", import.meta.url),
      ),
      "@anvia/core/completion": fileURLToPath(
        new URL("../core/src/completion/index.ts", import.meta.url),
      ),
      "@anvia/core/embeddings": fileURLToPath(
        new URL("../core/src/embeddings/index.ts", import.meta.url),
      ),
      "@anvia/core/image-generation": fileURLToPath(
        new URL("../core/src/image-generation/index.ts", import.meta.url),
      ),
      "@anvia/core/model-listing": fileURLToPath(
        new URL("../core/src/model-listing/index.ts", import.meta.url),
      ),
      "@anvia/core/transcription": fileURLToPath(
        new URL("../core/src/transcription/index.ts", import.meta.url),
      ),
      "@anvia/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
