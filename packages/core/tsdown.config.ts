import { defineConfig, type UserConfig } from "tsdown";

const shared: UserConfig = {
  format: ["esm"],
  sourcemap: true,
  fixedExtension: false,
};

// Keep source module boundaries so unrelated initializers can be tree-shaken.
export const sourceEntries: string[] = ["src/**/*.ts"];

export default defineConfig([
  {
    ...shared,
    entry: sourceEntries,
    unbundle: true,
    dts: false,
    clean: true,
  },
  {
    ...shared,
    // Declarations only for the public entrypoints listed in package.json exports.
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
      "src/decision/index.ts",
      "src/extractor/index.ts",
      "src/guardrails/index.ts",
      "src/mcp/index.ts",
      "src/memory/index.ts",
      "src/model-listing/index.ts",
      "src/observability/index.ts",
      "src/pipeline/index.ts",
      "src/redaction/index.ts",
      "src/skills/index.ts",
      "src/streaming/index.ts",
      "src/tool/index.ts",
      "src/transcription/index.ts",
      "src/vector-store/index.ts",
    ],
    dts: { emitDtsOnly: true },
    clean: false,
  },
]);
