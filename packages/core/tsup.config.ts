import type { Options } from "tsup";

export default {
  // Keep source module boundaries so unrelated initializers can be tree-shaken.
  entry: ["src/**/*.ts"],
  format: ["esm"],
  splitting: true,
  dts: {
    entry: [
      "src/index.ts",
      "src/agent/index.ts",
      "src/agent/interactions/index.ts",
      "src/internal/agent.ts",
      "src/speech-generation/index.ts",
      "src/completion/index.ts",
      "src/embeddings/index.ts",
      "src/evals/index.ts",
      "src/image-generation/index.ts",
      "src/documents/index.ts",
      "src/extractor/index.ts",
      "src/guardrails/index.ts",
      "src/mcp/index.ts",
      "src/memory/index.ts",
      "src/model-listing/index.ts",
      "src/observability/index.ts",
      "src/pipeline/index.ts",
      "src/skills/index.ts",
      "src/streaming/index.ts",
      "src/tool/index.ts",
      "src/transcription/index.ts",
      "src/vector-store/index.ts",
    ],
  },
  sourcemap: true,
  clean: true,
} satisfies Options;
